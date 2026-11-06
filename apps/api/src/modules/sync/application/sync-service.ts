import { pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { OrderStatus, OrdersPort } from "../../../platform/orders.js";
import { AppError, assertWarehouseScope, conflict, notFound, type Ctx } from "../../catalog/catalog.public.js";
import type { CashService } from "../../cash/cash.public.js";
import type { FieldService } from "../../dispatch/dispatch.public.js";
import { haversineMeters, type Rider } from "../../riders/riders.public.js";
import type { PingInput, TrackingService } from "../../tracking/tracking.public.js";
import { MESSAGES, reviewView, type ConflictReason, type ReviewFlag, type SyncSettings } from "../domain/sync.js";
import type { SyncStore } from "./ports.js";

const derive = promisify(pbkdf2);
type FailReason = "customer_unreachable" | "wrong_address" | "refused" | "road_blocked" | "weather" | "other";

interface Base { clientEventId: string; seq: number; orderId: string | null; deviceTime: Date; gps: { lat: number; lng: number; accuracyM?: number | null | undefined } | null }
export type SyncEvent = Base & (
  | { type: "ack_assignment"; payload: { assignmentId: string } }
  | { type: "picked_up"; payload: { checklist: { itemsVerified: boolean; bagCount?: number | null | undefined } } }
  | { type: "start_ride" | "arrived"; payload: Record<string, never> }
  | { type: "deliver" | "deliver_offline"; payload: { otp?: string | null | undefined; otpCheckedLocally?: boolean | undefined } }
  | { type: "collect_cash"; payload: { amount: number } }
  | { type: "collect_upi_unverified"; payload: { amount: number; note?: string | null | undefined } }
  | { type: "failed_delivery"; payload: { reason: FailReason; note?: string | null | undefined; photoMediaId?: string | null | undefined } }
  | { type: "location_batch"; payload: { points: PingInput[] } }
);

type Outcome = { result: "applied" | "duplicate" } | { result: "conflict"; reason: ConflictReason; message: string };
export type EventResult = { clientEventId: string; result: "applied" | "duplicate" } | { clientEventId: string; result: "conflict"; reason: ConflictReason; message: string };

export interface SyncDeps {
  store: SyncStore; orders: OrdersPort; settings: SyncSettings; now: () => Date;
  field: Pick<FieldService, "ack" | "pickup" | "startRide" | "arrived" | "deliver" | "failed" | "relation" | "markDeliveryRejected">;
  cash: Pick<CashService, "collectSynced">;
  tracking: Pick<TrackingService, "ingest">;
  riders: { byId(id: string): Promise<Rider | null> };
  media: { linkFor(mediaId: string): Promise<{ url: string; expiresAt: string | null } | null> };
}

const APPLIED: Outcome = { result: "applied" };
const DUPLICATE: Outcome = { result: "duplicate" };
const refuse = (reason: ConflictReason, message?: string): Outcome => ({ result: "conflict", reason, message: message ?? MESSAGES[reason] });
const RANK: Partial<Record<OrderStatus, number>> = { ASSIGNED: 1, PICKED_UP: 2, OUT_FOR_DELIVERY: 3, ARRIVED: 4, DELIVERED: 5 };
const SKEW_PAST_MS = 7 * 86_400_000;
const b64 = (buffer: Buffer) => `b64:${buffer.toString("base64")}`;

/** The rider's pickup bundle and the offline event queue (F21). */
export function createSyncService(deps: SyncDeps) {
  const { store, orders, field, cash, tracking, riders, media, settings, now } = deps;

  /** Why a step cannot be applied when the rider has no live claim on the order. */
  async function gone(rider: Rider, orderId: string): Promise<Outcome> {
    const order = await orders.get(orderId);
    if (!order) return refuse("not_assigned_to_you");
    if (order.status === "CANCELLED") return refuse("order_cancelled");
    const relation = await field.relation(rider.id, orderId);
    if (relation === "ended") return refuse("reassigned");
    if (relation === "none") return refuse("not_assigned_to_you");
    return refuse(order.status === "DELIVERED" ? "already_delivered" : "invalid_transition");
  }

  async function translate(rider: Rider, orderId: string, error: unknown): Promise<Outcome> {
    if (!(error instanceof AppError)) throw error;
    const details = (error.details ?? {}) as { reason?: string };
    switch (error.code) {
      case "NOT_FOUND": return gone(rider, orderId);
      case "ALREADY_ACKNOWLEDGED": return DUPLICATE;
      case "OTP_MISMATCH": case "OTP_LOCKED": return refuse("otp_mismatch");
      case "FORBIDDEN": return refuse("not_assigned_to_you");
      case "INVALID_TRANSITION": return gone(rider, orderId);
      case "CONFLICT": return details.reason === "already_delivered" ? refuse("already_delivered") : refuse("invalid_transition", error.message);
      case "VALIDATION_ERROR": return refuse("invalid_transition", error.message);
      default: throw error;
    }
  }

  /** A step the order has already reached is a repeat (for example the same step done online), not a conflict. */
  async function advance(rider: Rider, orderId: string, target: OrderStatus, run: () => Promise<unknown>): Promise<Outcome> {
    const order = await orders.get(orderId);
    const reached = order && (RANK[order.status] ?? 0) >= (RANK[target] ?? 99);
    if (reached && ["live", "finished"].includes(await field.relation(rider.id, orderId))) return DUPLICATE;
    try { await run(); return APPLIED; } catch (error) { return translate(rider, orderId, error); }
  }

  async function deliver(rider: Rider, e: Extract<SyncEvent, { type: "deliver" | "deliver_offline" }>, orderId: string): Promise<Outcome> {
    const order = await orders.get(orderId);
    if (!order) return refuse("not_assigned_to_you");
    const relation = await field.relation(rider.id, orderId);
    if (order.status === "DELIVERED") return relation === "finished" ? DUPLICATE : refuse("already_delivered");
    if (order.status === "CANCELLED") return refuse("order_cancelled");
    if (relation !== "live") return gone(rider, orderId);

    const t = now();
    const flags: ReviewFlag[] = [];
    const late = e.deviceTime.getTime() > t.getTime() + settings.maxClockSkewMinutes * 60_000 || e.deviceTime.getTime() < t.getTime() - SKEW_PAST_MS
      || (order.readyAt !== null && e.deviceTime.getTime() < order.readyAt.getTime());
    if (late) flags.push("time_skew");
    const deliveredAt = late ? t : e.deviceTime;
    const distance = e.gps ? haversineMeters(e.gps, order.address.location) : null;
    if (distance !== null && distance > settings.geofenceMeters) flags.push("far_from_address");

    const review = (extra: ReviewFlag[], pending: boolean, fresh = order) => store.openReview({
      orderId, orderNo: fresh.orderNo, riderId: rider.id, riderName: rider.name, warehouseId: fresh.warehouseId, deliveredAt, syncedAt: t, flags: [...extra, ...flags],
      distanceFromAddressM: distance, amountDue: fresh.amountDue,
      collection: fresh.collectionMethod && fresh.collectionAmount !== null ? { method: fresh.collectionMethod, amount: fresh.collectionAmount } : null,
      deliveryPending: pending, otpCheckedLocally: e.payload.otpCheckedLocally === true,
    });

    const otp = typeof e.payload.otp === "string" ? e.payload.otp : null;
    if (order.otpRequired) {
      // The phone checked the code against a hash, which can be guessed offline, so the server checks it again.
      const checked = otp ? await orders.verifyDeliveryOtp(orderId, otp) : { valid: false as const };
      if (!checked.valid) {
        await review(["otp_mismatch"], true);
        return refuse("otp_mismatch");
      }
    }
    try {
      await field.deliver(rider, orderId, { otp, deliveredAt, location: e.gps ? { lat: e.gps.lat, lng: e.gps.lng } : null, accuracyM: e.gps?.accuracyM ?? null }, { offline: true });
    } catch (error) {
      if (error instanceof AppError && error.code === "CONFLICT" && (error.details as { reason?: string } | undefined)?.reason === "collection_required") {
        return refuse("invalid_transition", "Record the payment before delivering. Send the cash step first.");
      }
      return translate(rider, orderId, error);
    }
    if (flags.length > 0) await review([], false, (await orders.get(orderId)) ?? order);
    return APPLIED;
  }

  async function handle(rider: Rider, e: SyncEvent): Promise<Outcome> {
    const orderId = e.orderId ?? "";
    switch (e.type) {
      case "ack_assignment":
        try { await field.ack(rider, e.payload.assignmentId); return APPLIED; }
        catch (error) {
          if (error instanceof AppError && error.code === "NOT_FOUND") return refuse("not_assigned_to_you", "That assignment is no longer yours.");
          return translate(rider, orderId, error);
        }
      case "picked_up":
        return advance(rider, orderId, "PICKED_UP", () => field.pickup(rider, orderId, { itemsVerified: e.payload.checklist.itemsVerified, bagCount: e.payload.checklist.bagCount ?? null }));
      case "start_ride": return advance(rider, orderId, "OUT_FOR_DELIVERY", () => field.startRide(rider, orderId));
      case "arrived": return advance(rider, orderId, "ARRIVED", () => field.arrived(rider, orderId, e.gps ? { lat: e.gps.lat, lng: e.gps.lng } : null));
      case "deliver": case "deliver_offline": return deliver(rider, e, orderId);
      case "collect_cash": case "collect_upi_unverified": {
        const result = await cash.collectSynced(rider, orderId, e.type === "collect_cash" ? "cash" : "upi", {
          amount: e.payload.amount, note: e.type === "collect_upi_unverified" ? e.payload.note ?? null : null, deviceTime: e.deviceTime,
        });
        return result.kind === "conflict" ? refuse(result.reason, result.message) : { result: result.kind };
      }
      case "failed_delivery": {
        const order = await orders.get(orderId);
        if (order?.status === "FAILED_DELIVERY" && ["live", "finished"].includes(await field.relation(rider.id, orderId))) return DUPLICATE;
        try {
          await field.failed(rider, orderId, { reason: e.payload.reason, note: e.payload.note ?? null, photoMediaId: e.payload.photoMediaId ?? null });
          return APPLIED;
        } catch (error) { return translate(rider, orderId, error); }
      }
      case "location_batch":
        try { await tracking.ingest(rider, e.payload.points); return APPLIED; }
        catch (error) {
          if (error instanceof AppError && error.code === "FORBIDDEN") return refuse("invalid_transition", "You were not on shift, so your location was not recorded.");
          throw error;
        }
    }
  }

  return {
    /** Everything the phone needs to finish the delivery without signal. Call it right after pickup, at the warehouse. */
    async bundle(rider: Rider, orderId: string) {
      const order = await orders.get(orderId);
      if (!order || (await field.relation(rider.id, orderId)) !== "live") throw notFound("Order");
      if (!["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"].includes(order.status)) throw new AppError("INVALID_TRANSITION", "Pick the order up before downloading its bundle", { from: order.status });
      const link = async (media_: { mediaId: string } | null) => {
        const found = media_ ? await media.linkFor(media_.mediaId) : null;
        return media_ && found ? { mediaId: media_.mediaId, url: found.url, expiresAt: found.expiresAt } : null;
      };
      const code = order.otpRequired ? await orders.deliveryCode(orderId) : null;
      let otp = null;
      if (code) {
        const salt = randomBytes(16);
        const hash = await derive(code, salt, settings.otpIterations, 32, "sha256");
        otp = { salt: b64(salt), hash: b64(hash), algo: "pbkdf2-sha256", iterations: settings.otpIterations, attemptsMax: settings.otpAttempts };
      }
      return {
        orderId, orderNo: order.orderNo, groupId: order.groupId,
        items: order.items.map(i => ({ name: i.name, variantLabel: i.variantLabel, qty: i.qty })),
        address: { line1: order.address.line1, landmark: order.address.landmark, locality: order.address.locality, location: order.address.location, deliveryNotes: order.address.deliveryNotes },
        customer: order.customer,
        voiceNote: await link(order.voiceNote && !order.voiceNote.expired ? order.voiceNote : null),
        housePhoto: await link(order.housePhoto),
        amountDue: order.amountDue, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
        otp, upi: settings.upi, geofenceMeters: settings.geofenceMeters, serverTime: now().toISOString(),
      };
    },

    /** Applies the queue in sequence order; each event once, however often it is sent. Results come back in the order received. */
    async sync(rider: Rider, events: readonly SyncEvent[]): Promise<{ results: EventResult[]; serverTime: string }> {
      const results: EventResult[] = new Array(events.length);
      const order = events.map((e, index) => ({ e, index })).sort((a, b) => a.e.seq - b.e.seq || a.index - b.index);
      for (const { e, index } of order) {
        const fresh = await store.claim({ riderId: rider.id, clientEventId: e.clientEventId, seq: e.seq, type: e.type, orderId: e.orderId, deviceTime: e.deviceTime, receivedAt: now() });
        if (!fresh) { results[index] = { clientEventId: e.clientEventId, result: "duplicate" }; continue; }
        let outcome: Outcome;
        try { outcome = await handle(rider, e); }
        catch (error) { await store.release(rider.id, e.clientEventId); throw error; }
        await store.finish(rider.id, e.clientEventId, outcome.result === "conflict"
          ? { result: "conflict", reason: outcome.reason, message: outcome.message } : { result: outcome.result, reason: null, message: null });
        results[index] = { clientEventId: e.clientEventId, ...outcome };
      }
      return { results, serverTime: now().toISOString() };
    },

    // ---------------------------------------------------------------- the admin

    async reviews(ctx: Ctx, query: { warehouseId?: string | undefined; status?: "open" | "resolved" | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined }) {
      let warehouseIds: readonly string[] | undefined = ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds;
      if (query.warehouseId) { assertWarehouseScope(ctx.actor, query.warehouseId); warehouseIds = [query.warehouseId]; }
      const rows = await store.listReviews({ ...(query.status && { status: query.status }), ...(warehouseIds && { warehouseIds }), ...(query.from && { from: query.from }), ...(query.to && { to: query.to }) }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      return {
        data: page.map(reviewView),
        openCount: await store.openCount(ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
      };
    },

    /** Accepting an order whose code did not match completes the delivery; rejecting any review sends the order to failed delivery. */
    async resolveReview(ctx: Ctx, orderId: string, input: { outcome: "accepted" | "rejected"; note: string | null }) {
      const review = await store.getReview(orderId);
      if (!review) throw notFound("Offline delivery review");
      assertWarehouseScope(ctx.actor, review.warehouseId);
      if (review.status === "resolved") throw conflict("This review was already closed", { reason: "already_resolved" });
      if (!(await store.closeReview(orderId, { outcome: input.outcome, note: input.note, by: ctx.actor.userId, at: now() }))) throw conflict("This review was already closed", { reason: "already_resolved" });
      try {
        const rider = await riders.byId(review.riderId);
        if (!rider) throw conflict("The rider no longer exists", { reason: "no_rider" });
        const admin = { kind: "admin" as const, id: ctx.actor.userId };
        if (input.outcome === "accepted" && review.deliveryPending) {
          await field.deliver(rider, orderId, { otp: null, deliveredAt: review.deliveredAt, location: null, accuracyM: null }, { offline: true, skipOtp: true });
        } else if (input.outcome === "rejected") {
          if (review.deliveryPending) await field.failed(rider, orderId, { reason: "other", note: input.note ?? "Offline delivery rejected", photoMediaId: null });
          else {
            const reverted = await orders.reverseDelivery(orderId, admin, input.note);
            if (!reverted.ok) throw conflict("The order can no longer be taken back from delivered", { reason: "invalid_transition" });
            await field.markDeliveryRejected(orderId, input.note);
          }
        }
        await store.recordAudit({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, requestId: ctx.requestId, action: "sync.resolve_review", entityType: "order", entityId: orderId, warehouseId: review.warehouseId });
      } catch (error) {
        await store.reopenReview(orderId);
        throw error;
      }
      return reviewView((await store.getReview(orderId))!);
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
