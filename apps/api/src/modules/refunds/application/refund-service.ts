import { AppError, assertWarehouseScope, conflict, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { OPEN, discountShare, orderTotal, refundView, type Refund, type RefundMethod, type RefundReason, type RefundStatus } from "../domain/refund.js";
import { DuplicateRefundError, type RefundDeps } from "./ports.js";

export interface AutoRefundInput {
  order: { id: string; orderNo: string; groupId: string; userId: string; warehouseId: string; paymentMethod: "cod" | "online" };
  amount: number; reason: string; kind: "cancel" | "item_removed" | "failed_delivery" | "overpaid" | "late_payment"; key: string; by: { userId: string | null; role: string };
}
export interface RequestInput { reason: "damaged_item" | "missing_item" | "other"; items: { orderItemIndex: number; qty: number }[]; customerNote: string | null; photoMediaIds: string[] }

const REASON_OF: Record<AutoRefundInput["kind"], RefundReason> = {
  cancel: "cancelled", item_removed: "item_unavailable", failed_delivery: "cancelled", overpaid: "overpaid", late_payment: "late_payment",
};

/** Refunds are manual in version one: the admin pays outside the system and records it here (F16). */
export function createRefundService(deps: RefundDeps) {
  const { store, orders, media, eligibility, notifier, settings, now, newId } = deps;

  /** Money already promised back for an order, rejected ones left out. */
  async function committed(orderId: string): Promise<number> {
    return (await store.forOrder(orderId)).filter(r => r.status !== "rejected").reduce((sum, r) => sum + r.amount, 0);
  }
  /** Keeps the order's own refund status in step with its refunds. */
  async function syncOrder(orderId: string): Promise<void> {
    const all = await store.forOrder(orderId);
    const status = all.some(r => OPEN.includes(r.status)) ? "pending" : all.some(r => r.status === "done") ? "done" : "none";
    await orders.setRefundStatus(orderId, status);
  }
  async function load(ctx: Ctx, id: string): Promise<Refund> {
    const refund = await store.get(id);
    if (!refund) throw notFound("Refund");
    assertWarehouseScope(ctx.actor, refund.warehouseId);
    return refund;
  }

  return {
    /** Used by the orders module when it cancels an order or removes a line from a paid one. Repeating the same event changes nothing. */
    async createAuto(input: AutoRefundInput): Promise<{ id: string; amount: number }> {
      const refund: Refund = {
        id: newId(), groupId: input.order.groupId, orderId: input.order.id, orderNo: input.order.orderNo, userId: input.order.userId, warehouseId: input.order.warehouseId,
        paymentMethod: input.order.paymentMethod, amount: input.amount, reason: REASON_OF[input.kind], source: "auto", status: "requested", customerNote: input.reason, photos: [], items: [],
        rejectReason: null, method: null, reference: null, note: null, dedupeKey: input.key, createdBy: input.by.userId, decidedBy: null, createdAt: now(), decidedAt: null, markedDoneAt: null,
      };
      try { await store.insert(refund); }
      catch (error) { if (error instanceof DuplicateRefundError && error.existing) return { id: error.existing.id, amount: error.existing.amount }; throw error; }
      return { id: refund.id, amount: refund.amount };
    },

    // ---------------------------------------------------------------- the customer

    async myRefunds(userId: string, query: { limit: number; cursor?: string | undefined }) {
      const rows = await store.listForUser(userId, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      return { data: page.map(refundView), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },
    async myRefund(userId: string, id: string) {
      const refund = await store.get(id);
      if (!refund || refund.userId !== userId) throw notFound("Refund");
      return refundView(refund);
    },

    /** After delivery, within the window, for missing or damaged items, with photos when required. */
    async request(userId: string, orderId: string, input: RequestInput) {
      const order = await orders.get(orderId);
      if (!order || order.userId !== userId) throw notFound("Order");
      const refuse = (reason: string, message: string) => new AppError("REFUND_NOT_ALLOWED", message, { reason });
      if (order.status !== "DELIVERED" || !order.deliveredAt) throw refuse("not_delivered", "A refund can be asked for once the order is delivered");
      if (now().getTime() - order.deliveredAt.getTime() > settings.refundWindowHours * 3_600_000) throw refuse("window_expired", "The time to ask for a refund on this order has passed");
      if (settings.refundPhotoRequired && input.photoMediaIds.length === 0) throw refuse("photo_required", "Add a photo of the item");
      if (input.photoMediaIds.length > settings.maxPhotos) throw validation(`Add at most ${settings.maxPhotos} photos`, { field: "photoMediaIds" });

      const taken = new Set((await store.forOrder(orderId)).filter(r => r.status !== "rejected" && r.source === "customer_request").flatMap(r => r.items.map(i => i.orderItemIndex)));
      let value = 0;
      for (const wanted of input.items) {
        const item = order.items[wanted.orderItemIndex];
        if (!item || item.status === "unavailable") throw validation("That item is not in the order", { field: "items", orderItemIndex: wanted.orderItemIndex });
        if (wanted.qty < 1 || wanted.qty > item.qty) throw validation("The quantity is more than was delivered", { field: "items", orderItemIndex: wanted.orderItemIndex });
        if (taken.has(wanted.orderItemIndex)) throw conflict("A refund was already asked for this item", { orderItemIndex: wanted.orderItemIndex });
        if (!(await eligibility.eligible(item.productId, input.reason))) throw refuse("category_not_eligible", `${item.name} cannot be returned. A refund is possible only if it arrived damaged or missing`);
        value += item.unitPrice * wanted.qty;
      }
      if (new Set(input.items.map(i => i.orderItemIndex)).size !== input.items.length) throw validation("Each item can be listed once", { field: "items" });
      const amount = value - discountShare(order.allocatedDiscount, order.itemsSubtotal, value);
      if (amount > orderTotal(order) - (await committed(orderId))) throw new AppError("REFUND_EXCEEDS_AMOUNT", "That is more than can be refunded for this order", { refundable: orderTotal(order) - (await committed(orderId)) });

      const id = newId();
      for (const mediaId of input.photoMediaIds) await media.claim({ mediaId, userId, orderId });
      const refund: Refund = {
        id, groupId: order.groupId, orderId, orderNo: order.orderNo, userId, warehouseId: order.warehouseId, paymentMethod: order.paymentMethod, amount, reason: input.reason, source: "customer_request",
        status: "requested", customerNote: input.customerNote, photos: input.photoMediaIds.map(mediaId => ({ mediaId })), items: input.items, rejectReason: null, method: null, reference: null, note: null,
        dedupeKey: null, createdBy: userId, decidedBy: null, createdAt: now(), decidedAt: null, markedDoneAt: null,
      };
      await store.insert(refund);
      await orders.setRefundStatus(orderId, "pending");
      return refundView(refund);
    },

    // ---------------------------------------------------------------- the admin

    async list(ctx: Ctx, query: { status?: RefundStatus | undefined; source?: string | undefined; warehouseId?: string | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined }) {
      let warehouseIds: readonly string[] | undefined = ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds;
      if (query.warehouseId) { assertWarehouseScope(ctx.actor, query.warehouseId); warehouseIds = [query.warehouseId]; }
      const rows = await store.list({ ...(query.status && { status: query.status }), ...(query.source && { source: query.source }), ...(warehouseIds && { warehouseIds }), ...(query.from && { from: query.from }), ...(query.to && { to: query.to }) }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      const data = await Promise.all(page.map(async r => {
        const order = await orders.get(r.orderId);
        return { ...refundView(r), customer: { name: order?.customerName ?? "", phone: order?.customerPhone ?? "" }, paymentMethod: r.paymentMethod };
      }));
      return { data, pendingCount: await store.pendingCount(ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },
    async get(ctx: Ctx, id: string) {
      const refund = await load(ctx, id);
      const order = await orders.get(refund.orderId);
      return { ...refundView(refund), customer: { name: order?.customerName ?? "", phone: order?.customerPhone ?? "" }, paymentMethod: refund.paymentMethod };
    },

    /** A refund the admin makes by hand, for example goodwill. */
    async create(ctx: Ctx, input: { orderId: string; amount: number; reason: RefundReason; note: string | null }) {
      const order = await orders.get(input.orderId);
      if (!order) throw notFound("Order");
      assertWarehouseScope(ctx.actor, order.warehouseId);
      const room = orderTotal(order) - (await committed(order.id));
      if (input.amount > room) throw new AppError("REFUND_EXCEEDS_AMOUNT", "That is more than can be refunded for this order", { refundable: room });
      const refund: Refund = {
        id: newId(), groupId: order.groupId, orderId: order.id, orderNo: order.orderNo, userId: order.userId, warehouseId: order.warehouseId, paymentMethod: order.paymentMethod,
        amount: input.amount, reason: input.reason, source: "admin", status: "requested", customerNote: null, photos: [], items: [], rejectReason: null, method: null, reference: null, note: input.note,
        dedupeKey: null, createdBy: ctx.actor.userId, decidedBy: null, createdAt: now(), decidedAt: null, markedDoneAt: null,
      };
      await store.insert(refund);
      await orders.setRefundStatus(order.id, "pending");
      return refundView(refund);
    },

    async approve(ctx: Ctx, id: string) {
      const refund = await load(ctx, id);
      const next = { status: "approved" as const, decidedBy: ctx.actor.userId, decidedAt: now() };
      if (!(await store.decide(id, ["requested"], next))) throw conflict("This refund is not waiting for a decision", { status: (await store.get(id))?.status });
      const updated = { ...refund, ...next };
      await notifier.approved(refund.userId, updated).catch(() => undefined);
      return refundView(updated);
    },

    async reject(ctx: Ctx, id: string, reason: string) {
      const refund = await load(ctx, id);
      const next = { status: "rejected" as const, rejectReason: reason, decidedBy: ctx.actor.userId, decidedAt: now() };
      if (!(await store.decide(id, ["requested"], next))) throw conflict("This refund is not waiting for a decision", { status: (await store.get(id))?.status });
      await syncOrder(refund.orderId);
      const updated = { ...refund, ...next };
      await notifier.rejected(refund.userId, updated).catch(() => undefined);
      return refundView(updated);
    },

    /** The admin has paid it outside the system. A second click changes nothing. */
    async markDone(ctx: Ctx, id: string, input: { method: RefundMethod; reference: string | null; note: string | null }) {
      const refund = await load(ctx, id);
      const order = await orders.get(refund.orderId);
      if (order) {
        const done = (await store.forOrder(refund.orderId)).filter(r => r.status === "done" && r.id !== id).reduce((sum, r) => sum + r.amount, 0);
        if (done + refund.amount > orderTotal(order)) throw new AppError("REFUND_EXCEEDS_AMOUNT", "Paying this would refund more than the order cost", { refundable: orderTotal(order) - done });
      }
      const next = { status: "done" as const, method: input.method, reference: input.reference, note: input.note ?? refund.note, decidedBy: refund.decidedBy ?? ctx.actor.userId, markedDoneAt: now() };
      if (!(await store.decide(id, ["requested", "approved"], next))) {
        throw conflict("This refund is already closed", { status: (await store.get(id))?.status });
      }
      await syncOrder(refund.orderId);
      const updated = { ...refund, ...next };
      await notifier.done(refund.userId, updated).catch(() => undefined);
      return refundView(updated);
    },
  };
}

export type RefundService = ReturnType<typeof createRefundService>;
