import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { AppError, conflict, notFound } from "../../catalog/catalog.public.js";
import {
  ACTIVE_BEFORE_PICKUP, LEGAL, STAMP_OF, groupStatusOf, type Order, type OrderEvent, type OrderGroup, type OrderStatus,
} from "../domain/order.js";
import { StaleOrderError, type OrderDeps } from "./ports.js";

export interface Actor { userId: string | null; role: string; name?: string | null }
export type MoveResult = { ok: true; order: Order; refund?: { id: string; amount: number } | null; feesRefunded?: boolean } | { ok: false; reason: "not_found" | "invalid_transition"; from?: OrderStatus };

const DEV_KEY = createHash("sha256").update("dev-only-order-code-key").digest();

/** Delivery codes are kept encrypted: the customer and the rider bundle need the code back, so it cannot be hashed. */
export function createCodeBox(keyHex: string | null) {
  const key = keyHex ? Buffer.from(keyHex, "hex") : DEV_KEY;
  if (keyHex && key.length !== 32) throw new Error("The delivery code key must be 32 bytes (64 hex characters)");
  return {
    seal(code: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
      return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    },
    open(sealed: string): string | null {
      const [version, iv, body, tag] = sealed.split(".");
      if (version !== "v1" || !iv || !body || !tag) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
      } catch { return null; }
    },
  };
}
export const newCode = () => String(randomInt(0, 10_000)).padStart(4, "0");
export const sameCode = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** What a customer is refunded when an order is cancelled: items less their discount, plus the fees only when the whole group goes before pickup. */
export function refundOnCancel(order: Order, siblings: readonly Order[]): number {
  if (order.paymentMethod !== "online" || order.paymentStatus !== "paid") return 0;
  const net = order.items.reduce((sum, i) => sum + (i.status === "unavailable" ? 0 : i.lineTotal), 0) - order.allocatedDiscount;
  const others = siblings.filter(s => s.id !== order.id);
  const wholeGroup = others.every(s => s.status === "CANCELLED" || (ACTIVE_BEFORE_PICKUP as readonly string[]).includes(s.status));
  const fees = order.allocatedCharges.filter(c => c.type !== "tip").reduce((sum, c) => sum + c.amount, 0);
  // A tip is for the rider of this delivery, so it comes back with this order even when the other deliveries of the group still go ahead.
  const tip = order.allocatedCharges.filter(c => c.type === "tip").reduce((sum, c) => sum + c.amount, 0);
  return Math.min(order.paidAmount, Math.max(0, net) + tip + (wholeGroup && others.every(s => s.status === "CANCELLED") ? fees : 0));
}

/** The single writer of order status (F14) and the effects that follow a change. */
export function createOrderCore(deps: OrderDeps) {
  const { store, stock, coupons, media, dispatch, money, notifier, now, newId } = deps;
  const box = createCodeBox(deps.settings.otpKeyHex);

  const eventOf = (order: Order, type: string, actor: Actor, extra: Partial<OrderEvent> = {}): OrderEvent => ({
    id: newId(), orderId: order.id, groupId: order.groupId, type, from: null, to: null, actor, meta: {}, at: now(), ...extra,
  });

  /** Fields set when an order enters a status. */
  function patchFor(order: Order, to: OrderStatus, actor: Actor, details: Record<string, unknown>, at: Date): Partial<Order> {
    const stamp = STAMP_OF[to];
    const patch: Partial<Order> = { status: to, ...(stamp && { stamps: { ...order.stamps, [stamp]: at } }) };
    if (to === "PICKED_UP" && typeof details.bagCount === "number") patch.bagCount = details.bagCount;
    if (to === "DELIVERED") {
      const deliveredAt = typeof details.deliveredAt === "string" ? new Date(details.deliveredAt) : at;
      patch.stamps = { ...order.stamps, deliveredAt };
      const offline = details.offline === true;
      patch.delivery = {
        offline, deviceTime: offline ? deliveredAt : null, location: (details.location as { lat: number; lng: number } | null | undefined) ?? null,
        accuracyM: typeof details.accuracyM === "number" ? details.accuracyM : null, syncedAt: offline ? at : null,
      };
    }
    if (to === "CANCELLED") patch.cancel = { by: actor.userId ?? "system", role: actor.role, reason: String(details.reason ?? "cancelled"), at };
    if (to === "FAILED_DELIVERY") {
      patch.failedDelivery = { reason: String(details.reason ?? "other"), note: (details.note as string | null | undefined) ?? null, photoMediaId: (details.photoMediaId as string | null | undefined) ?? null, at };
    }
    if (to === "READY" && order.status === "FAILED_DELIVERY") patch.failedDelivery = null;
    return patch;
  }

  /** What must follow a cancellation: stock back, coupon back, rider released, refund asked for, customer told. */
  async function afterCancel(order: Order, actor: Actor, reason: string, refundKind: "cancel" | "failed_delivery" = "cancel", restock = true): Promise<{ id: string; amount: number } | null> {
    const result = await cancelEffects(order, actor, reason, refundKind, restock);
    return result.refund;
  }

  async function cancelEffects(order: Order, actor: Actor, reason: string, refundKind: "cancel" | "failed_delivery", restock: boolean): Promise<{ refund: { id: string; amount: number } | null; feesRefunded: boolean }> {
    const group = (await store.getGroup(order.groupId))!;
    const siblings = await store.childrenOf(order.groupId);
    if (restock) {
      const lines = order.items.filter(i => i.status !== "unavailable" && i.qty > 0).map(i => ({ warehouseId: order.warehouseId, productId: i.productId, variantId: i.variantId, qty: i.qty }));
      if (lines.length > 0) {
        try { await stock.restore({ key: group.id, restoreKey: `cancel:${order.id}`, reason: "cancel", lines }); }
        catch (error) { if (!(error instanceof AppError)) throw error; /* the hold was already released, nothing to give back */ }
      }
    }
    if (siblings.every(s => s.status === "CANCELLED")) await coupons.release(group.id).catch(() => undefined);
    await dispatch.cancelled(order.id).catch(() => undefined);
    await media.scheduleDeletion(order.id, now()).catch(() => undefined);
    await deps.slots.release(order.id).catch(() => undefined);
    const amount = refundOnCancel(order, siblings);
    let refund: { id: string; amount: number } | null = null;
    if (amount > 0) {
      refund = await money.refund({ order, group, amount, reason, kind: refundKind, key: `${refundKind}:${order.id}`, by: { userId: actor.userId, role: actor.role } });
      if (refund) await store.patch(order.id, { refundStatus: "pending" });
    }
    await notifier.cancelled(order.userId, order, reason).catch(() => undefined);
    const fees = order.allocatedCharges.filter(c => c.type !== "tip").reduce((sum, c) => sum + c.amount, 0);
    const tip = order.allocatedCharges.filter(c => c.type === "tip").reduce((sum, c) => sum + c.amount, 0);
    return { refund, feesRefunded: Boolean(refund) && fees > 0 && amount >= order.itemsSubtotal - order.allocatedDiscount + fees + tip };
  }

  /** The one function that changes `status`. Illegal moves are refused unless `force` is set. */
  async function move(orderId: string, to: OrderStatus, actor: Actor, details: Record<string, unknown> = {}, options: { force?: boolean; skipEffects?: boolean } = {}): Promise<MoveResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const order = await store.getOrder(orderId);
      if (!order) return { ok: false, reason: "not_found" };
      if (!options.force && !LEGAL[order.status].includes(to)) return { ok: false, reason: "invalid_transition", from: order.status };
      const at = now();
      const event = eventOf(order, "status_change", actor, { from: order.status, to, meta: details, at });
      try {
        const updated = await store.transition(orderId, order.status, patchFor(order, to, actor, details, at), event);
        if (!options.skipEffects) {
          if (to === "CANCELLED") {
            const effects = await cancelEffects(updated, actor, String(details.reason ?? "cancelled"), "cancel", true);
            return { ok: true, order: updated, refund: effects.refund, feesRefunded: effects.feesRefunded };
          } else if (to === "DELIVERED") await media.scheduleDeletion(orderId, updated.stamps.deliveredAt ?? at).catch(() => undefined);
          else if (to === "CONFIRMED") await notifier.confirmed(updated.userId, updated).catch(() => undefined);
        }
        return { ok: true, order: updated };
      } catch (error) {
        if (!(error instanceof StaleOrderError)) throw error;
      }
    }
    const latest = await store.getOrder(orderId);
    return { ok: false, reason: "invalid_transition", ...(latest && { from: latest.status }) };
  }

  const group = async (id: string): Promise<OrderGroup> => (await store.getGroup(id)) ?? (() => { throw notFound("Order group"); })();
  const siblingStatuses = async (groupId: string) => (await store.childrenOf(groupId)).map(o => o.status);

  return {
    box, move, afterCancel, cancelEffects, eventOf, group, siblingStatuses,
    groupStatus: async (groupId: string) => groupStatusOf(await siblingStatuses(groupId)),
    invalid(from: OrderStatus, to?: OrderStatus): AppError {
      return new AppError("INVALID_TRANSITION", `The order cannot move from ${from}${to ? ` to ${to}` : ""}`, { from, ...(to && { to }), allowed: LEGAL[from] });
    },
    orThrow(result: MoveResult, to: OrderStatus): Order {
      if (result.ok) return result.order;
      if (result.reason === "not_found") throw notFound("Order");
      throw new AppError("INVALID_TRANSITION", `The order cannot move from ${result.from} to ${to}`, { from: result.from, to, allowed: result.from ? LEGAL[result.from] : [] });
    },
    conflictStale: () => conflict("The order changed while you were working on it. Reload and try again.", { reason: "stale" }),
  };
}

export type OrderCore = ReturnType<typeof createOrderCore>;
