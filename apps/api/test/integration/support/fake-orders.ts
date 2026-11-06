import type { DeliveryOrder, OrderActor, OrderStatus, OrdersPort, TransitionResult } from "../../../src/platform/orders.js";
import type { RiderIdentity } from "../../../src/platform/identity.js";

/** The legal moves of the order state machine (F14). The real module is Dev 1's; this has the same rules. */
const LEGAL: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["PLACED", "CANCELLED"], PLACED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["PACKING", "CANCELLED"], PACKING: ["READY", "CANCELLED"],
  READY: ["ASSIGNED", "CANCELLED"], ASSIGNED: ["READY", "PICKED_UP", "CANCELLED"], PICKED_UP: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["ARRIVED", "FAILED_DELIVERY"], ARRIVED: ["DELIVERED", "FAILED_DELIVERY"], DELIVERED: [], FAILED_DELIVERY: ["READY", "CANCELLED"], CANCELLED: [],
};

export interface OrderSeed extends Partial<DeliveryOrder> { zoneId: string; warehouseId: string }
const MAX_OTP_TRIES = 5;

/**
 * Orders held in memory with the real status rules, a delivery code per checkout, and a record of every change asked for, so a
 * test can check exactly what dispatch did to an order.
 */
export function createFakeOrders() {
  const all = new Map<string, DeliveryOrder>();
  const codes = new Map<string, { code: string; wrong: number }>();
  const log: { orderId: string; to: OrderStatus; by: OrderActor; details?: Record<string, unknown> }[] = [];
  const events: { orderId: string; type: string; by: OrderActor; details?: Record<string, unknown> }[] = [];
  const returns: { orderId: string; goodsCondition: string; note: string | null }[] = [];
  const timelines = new Map<string, { status: OrderStatus; at: Date }[]>();
  const collections: { orderId: string; collection: unknown; by: OrderActor; details?: Record<string, unknown> }[] = [];
  const refunds: { orderId: string; amount: number; reason: string }[] = [];
  let counter = 0;
  let clock = () => new Date();

  const copy = (o: DeliveryOrder): DeliveryOrder => structuredClone(o);
  function withGroupStatus(o: DeliveryOrder): DeliveryOrder {
    const kids = [...all.values()].filter(k => k.groupId === o.groupId && k.status !== "CANCELLED");
    const groupStatus = kids.length > 0 && kids.every(k => k.status === "DELIVERED") ? "DELIVERED" : kids.length === 0 ? "CANCELLED" : "ACTIVE";
    return { ...copy(o), groupStatus };
  }

  const port: OrdersPort = {
    get: async id => (all.has(id) ? withGroupStatus(all.get(id)!) : null),
    getMany: async ids => ids.flatMap(id => (all.has(id) ? [withGroupStatus(all.get(id)!)] : [])),
    childrenOf: async groupId => [...all.values()].filter(o => o.groupId === groupId).map(withGroupStatus),
    listByStatus: async (status, limit) => [...all.values()].filter(o => o.status === status).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map(withGroupStatus),
    async transition(orderId, to, by, details): Promise<TransitionResult> {
      const order = all.get(orderId);
      if (!order) return { ok: false, reason: "not_found" };
      if (!LEGAL[order.status].includes(to)) return { ok: false, reason: "invalid_transition", from: order.status };
      order.status = to;
      timelines.set(orderId, [...(timelines.get(orderId) ?? []), { status: to, at: clock() }]);
      if (to === "DELIVERED" && details?.offline === true) order.deliveredOffline = true;
      if (to === "READY") order.readyAt = clock();
      if (to === "DELIVERED") order.deliveredAt = typeof details?.deliveredAt === "string" ? new Date(details.deliveredAt) : clock();
      if (to === "PICKED_UP" && typeof details?.bagCount === "number") order.bagCount = details.bagCount;
      log.push({ orderId, to, by, ...(details && { details }) });
      return { ok: true, order: withGroupStatus(order) };
    },
    async recordEvent(orderId, type, by, details) { events.push({ orderId, type, by, ...(details && { details }) }); },
    async verifyDeliveryOtp(orderId, otp) {
      const order = all.get(orderId);
      const entry = order ? codes.get(order.groupId) : undefined;
      if (!entry) return { valid: false, attemptsLeft: null, locked: false };
      if (entry.wrong >= MAX_OTP_TRIES) return { valid: false, attemptsLeft: 0, locked: true };
      if (otp === entry.code) return { valid: true };
      entry.wrong++;
      return { valid: false, attemptsLeft: MAX_OTP_TRIES - entry.wrong, locked: entry.wrong >= MAX_OTP_TRIES };
    },
    async timeline(orderId) { return (timelines.get(orderId) ?? []).map(t => ({ ...t })); },
    async deliveryCode(orderId) { const order = all.get(orderId); return order?.otpRequired ? codes.get(order.groupId)?.code ?? null : null; },
    async setCollection(orderId, collection, by, details) {
      const order = all.get(orderId);
      if (!order) return { ok: false, reason: "not_found" };
      Object.assign(order, collection
        ? { collectionRecorded: true, collectionMethod: collection.method, collectionAmount: collection.amount, paymentStatus: collection.method === "cash" ? "cod_collected" : collection.method }
        : { collectionRecorded: false, collectionMethod: null, collectionAmount: null, paymentStatus: "cod_pending" });
      collections.push({ orderId, collection, by, ...(details && { details }) });
      return { ok: true, order: withGroupStatus(order) };
    },
    async reverseDelivery(orderId, by) {
      const order = all.get(orderId);
      if (!order) return { ok: false, reason: "not_found" };
      if (order.status !== "DELIVERED") return { ok: false, reason: "invalid_transition", from: order.status };
      order.status = "FAILED_DELIVERY"; order.deliveredAt = null;
      log.push({ orderId, to: "FAILED_DELIVERY", by });
      return { ok: true, order: withGroupStatus(order) };
    },
    async createRefund(orderId, input) { refunds.push({ orderId, ...input }); return { id: `refund-${orderId}`, amount: input.amount }; },
    async cancelFailedAndReturn(orderId, input, by) {
      const order = all.get(orderId);
      if (!order) return { ok: false, reason: "not_found" };
      if (order.status !== "FAILED_DELIVERY") return { ok: false, reason: "invalid_transition", from: order.status };
      order.status = "CANCELLED";
      returns.push({ orderId, goodsCondition: input.goodsCondition, note: input.note });
      log.push({ orderId, to: "CANCELLED", by });
      return { ok: true, order: withGroupStatus(order), refund: order.paymentMethod === "online" ? { id: `refund-${orderId}`, amount: order.amountDue } : null };
    },
  };

  return {
    port, log, events, returns, collections, refunds,
    /** Adds an order (ready for dispatch unless told otherwise). Orders of one checkout share a `groupId` and one delivery code. */
    add(seed: OrderSeed): DeliveryOrder {
      counter++;
      const id = seed.id ?? counter.toString(16).padStart(24, "0").replace(/^0{4}/, "b0b0");
      const groupId = seed.groupId ?? `${id.slice(0, 20)}ff${String(counter).padStart(2, "0")}`.slice(0, 24);
      const order: DeliveryOrder = {
        id, orderNo: `DS-${String(240000 + counter)}-A`, groupId, groupNo: `DS-${String(240000 + counter)}`, customerUserId: "c".repeat(24), status: "READY", groupStatus: "ACTIVE",
        customer: { name: "Asha Rai", phone: "+919876543210" }, items: [{ name: "Fresh Tomato (Local)", variantLabel: "500 g", qty: 2, status: "ok" }], itemCount: 2, bagCount: null,
        address: { line1: "Cedar Villa, 2nd floor", landmark: "Opposite Planters Club gate", locality: "Chowrasta", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18, deliveryNotes: "Ring the bell twice" },
        voiceNote: { mediaId: "a".repeat(24), durationSec: 8, expired: false }, housePhoto: { mediaId: "b".repeat(24) },
        paymentMethod: "cod", paymentStatus: "cod_pending", amountDue: 8800, alreadyPaid: false, collectionRecorded: false, collectionMethod: null, collectionAmount: null, deliveredOffline: false,
        otpRequired: true, promisedAt: new Date("2026-11-05T11:05:00Z"), readyAt: clock(), deliveredAt: null, ...seed,
      };
      all.set(id, order);
      if (!codes.has(order.groupId)) codes.set(order.groupId, { code: "4271", wrong: 0 });
      return copy(order);
    },
    get: (id: string) => all.get(id)!,
    setStatus(id: string, status: OrderStatus) { all.get(id)!.status = status; },
    patch(id: string, patch: Partial<DeliveryOrder>) { Object.assign(all.get(id)!, patch); },
    /** The cash or UPI payment for an order has been recorded (F22). */
    collect(id: string, method: "cash" | "upi" = "cash") {
      const order = all.get(id)!;
      Object.assign(order, { collectionRecorded: true, collectionMethod: method === "cash" ? "cash" : "upi_unverified", collectionAmount: order.amountDue, paymentStatus: "cod_collected" });
    },
    wrongCodeCount: (groupId: string) => codes.get(groupId)?.wrong ?? 0,
    setClock(fn: () => Date) { clock = fn; },
    reset() { all.clear(); codes.clear(); timelines.clear(); log.length = 0; events.length = 0; returns.length = 0; collections.length = 0; refunds.length = 0; counter = 0; clock = () => new Date(); },
  };
}
export type FakeOrders = ReturnType<typeof createFakeOrders>;

/** Rider login accounts held in memory. */
export function createFakeRiderIdentity() {
  const accounts = new Map<string, { userId: string; name: string; phone: string; active: boolean }>();
  const failNext = { value: false };
  let counter = 0;
  const identity: RiderIdentity = {
    async register({ name, phone }) {
      if ([...accounts.values()].some(a => a.phone === phone)) return { ok: false, reason: "phone_used" };
      counter++;
      const userId = `a${String(counter).padStart(23, "0")}`;
      accounts.set(userId, { userId, name, phone, active: true });
      return { ok: true, userId };
    },
    async rename(userId, name) { accounts.get(userId)!.name = name; },
    async setActive(userId, active) { accounts.get(userId)!.active = active; },
  };
  return { identity, accounts, failNext, reset() { accounts.clear(); counter = 0; failNext.value = false; } };
}
export type FakeRiderIdentity = ReturnType<typeof createFakeRiderIdentity>;
