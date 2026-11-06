import type { DeliveryOrder, OrdersPort } from "../../../platform/orders.js";
import { AppError, forbidden, notFound } from "../../catalog/catalog.public.js";
import type { Rider } from "../../riders/riders.public.js";
import { RIDER_VISIBLE, type EtaProvider, type TrackingSettings } from "../domain/tracking.js";
import type { StoredPoint, TrackingStore } from "./ports.js";
import type { TokenSigner } from "./token.js";

export interface TrackingDeps {
  store: TrackingStore; orders: OrdersPort; settings: TrackingSettings; eta: EtaProvider; signer: TokenSigner; now: () => Date;
  riders: { byId(id: string): Promise<Rider | null>; recordLocation(riderId: string, location: { lat: number; lng: number }, at: Date): Promise<boolean> };
  relations: { riderOfOrder(orderId: string): Promise<string | null>; liveOrderIds(riderId: string): Promise<string[]> };
}
export interface PingInput { location: { lat: number; lng: number }; accuracyM?: number | null | undefined; speedKmh?: number | null | undefined; at: Date }

const FUTURE_SLACK_MS = 5 * 60_000;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const isVisible = (status: string) => (RIDER_VISIBLE as readonly string[]).includes(status);

/** Rider positions, the live ETA, and what customers and tracking links see (F20). */
export function createTrackingService(deps: TrackingDeps) {
  const { store, orders, settings, eta, signer, now, riders, relations } = deps;

  /** Works out the ETA again for the orders a rider is out with, at most once per refresh interval for each. */
  async function refreshEtas(riderId: string): Promise<void> {
    const rider = await riders.byId(riderId);
    if (!rider?.lastLocation) return;
    const t = now();
    const live = await orders.getMany(await relations.liveOrderIds(riderId));
    for (const order of live.filter(o => o.status === "OUT_FOR_DELIVERY")) {
      const current = await store.getEta(order.id);
      if (current && t.getTime() - current.updatedAt.getTime() < settings.etaRefreshSeconds * 1000) continue;
      const minutes = await eta.minutes(rider.lastLocation, order.address.location);
      if (minutes !== null) await store.saveEta({ orderId: order.id, riderId, minutes, etaAt: new Date(t.getTime() + minutes * 60_000), updatedAt: t });
    }
  }

  /** The ETA block both views show. Before the ride there is only the promised time. */
  async function etaOf(order: DeliveryOrder) {
    const stored = order.status === "OUT_FOR_DELIVERY" || order.status === "ARRIVED" ? await store.getEta(order.id) : null;
    const arrived = order.status === "ARRIVED";
    return {
      promisedAt: order.promisedAt.toISOString(),
      liveEtaMinutes: arrived ? 0 : stored?.minutes ?? null,
      liveEtaAt: arrived ? iso(stored?.updatedAt ?? now()) : iso(stored?.etaAt),
      updatedAt: iso(stored?.updatedAt),
    };
  }

  /** The rider of an order, only while the order is on the road. */
  async function riderOn(order: DeliveryOrder): Promise<Rider | null> {
    if (!isVisible(order.status)) return null;
    const riderId = await relations.riderOfOrder(order.id);
    return riderId ? riders.byId(riderId) : null;
  }

  return {
    /** The rider sends one position or a buffered batch. Old points never replace a newer position. */
    async ingest(rider: Rider, points: readonly PingInput[]) {
      if (!rider.isActive || !rider.currentShiftId) throw forbidden("Start your shift before sending your location");
      const t = now();
      const oldest = t.getTime() - settings.maxPointAgeDays * 86_400_000;
      const kept: StoredPoint[] = points
        .filter(p => p.at.getTime() >= oldest)
        .map(p => ({ riderId: rider.id, at: p.at.getTime() > t.getTime() + FUTURE_SLACK_MS ? t : p.at, location: p.location, accuracyM: p.accuracyM ?? null, speedKmh: p.speedKmh ?? null }));
      if (kept.length > 0) {
        await store.insertPoints(kept);
        const latest = kept.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
        await riders.recordLocation(rider.id, latest.location, latest.at);
        await refreshEtas(rider.id);
      }
      const fresh = (await riders.byId(rider.id)) ?? rider;
      return {
        accepted: kept.length,
        nextPingSeconds: fresh.activeOrderCount > 0 ? settings.pingOnOrderSeconds : settings.pingIdleSeconds,
        serverTime: t.toISOString(),
      };
    },

    /** One order of the customer's, with the rider's position once it is on the road. */
    async forCustomer(userId: string, orderId: string) {
      const order = await orders.get(orderId);
      if (!order || order.customerUserId !== userId) throw notFound("Order");
      const [timeline, children, rider] = await Promise.all([orders.timeline(orderId), orders.childrenOf(order.groupId), riderOn(order)]);
      const open = order.status !== "DELIVERED" && order.status !== "CANCELLED" && order.status !== "FAILED_DELIVERY";
      return {
        orderId: order.id, orderNo: order.orderNo, status: order.status, eta: await etaOf(order),
        rider: rider ? {
          name: rider.name, phone: rider.phone, location: rider.lastLocation, lastLocationAt: iso(rider.lastLocationAt),
        } : null,
        timeline: timeline.map(t => ({ status: t.status, at: t.at.toISOString() })),
        group: { groupNo: order.groupNo, children: children.map(c => ({ id: c.id, orderNo: c.orderNo, status: c.status, promisedAt: c.promisedAt.toISOString() })) },
        deliveryOtp: open && order.otpRequired ? await orders.deliveryCode(orderId) : null,
      };
    },

    /** The page behind a tracking link: no address, no phone, nothing about other customers. */
    async forToken(token: string) {
      const verified = signer.verify(token, now());
      if (!verified || (await store.isRevoked(verified.orderId))) throw notFound("Tracking link");
      const order = await orders.get(verified.orderId);
      if (!order) throw notFound("Tracking link");
      const rider = await riderOn(order);
      const e = await etaOf(order);
      return {
        orderNo: order.orderNo, status: order.status,
        eta: { promisedAt: e.promisedAt, liveEtaMinutes: e.liveEtaMinutes, updatedAt: e.updatedAt },
        rider: rider ? { firstName: rider.name.split(/\s+/)[0] ?? rider.name, location: rider.lastLocation, lastLocationAt: iso(rider.lastLocationAt) } : null,
        destination: { location: order.address.location },
        expiresAt: verified.expiresAt.toISOString(),
      };
    },

    /** For the orders module: the link to put in the WhatsApp message. */
    link(orderId: string, ttlHours = settings.tokenTtlHours) {
      if (!signer.available) throw new AppError("SERVICE_UNAVAILABLE", "Tracking links are not set up");
      const expiresAt = new Date(now().getTime() + ttlHours * 3_600_000);
      return { token: signer.create(orderId, expiresAt), expiresAt };
    },
    async revoke(orderId: string) { await store.revoke(orderId, now()); },
    /** Worked out again, whatever its age; used when the order goes out for delivery. */
    async forgetEta(orderId: string) { await store.clearEta(orderId); },
    refreshEtas,
  };
}

export type TrackingService = ReturnType<typeof createTrackingService>;
