import { AppError, assertWarehouseScope, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { adminOrderView, groupStatusOf, type Order, type OrderGroup, type OrderStatus } from "../domain/order.js";
import { CANCELLABLE } from "../domain/order.js";
import { type OrderCore } from "./order-core.js";
import type { OrderDeps } from "./ports.js";

export interface AdminOrderQuery {
  warehouseId?: string | undefined; statuses?: OrderStatus[] | undefined; paymentStatus?: string | undefined; riderId?: string | undefined; q?: string | undefined;
  from?: Date | undefined; to?: Date | undefined; isPreOrder?: boolean | undefined; flagged?: boolean | undefined; limit: number; cursor?: string | undefined;
}

const actorOf = (ctx: Ctx) => ({ userId: ctx.actor.userId, role: ctx.actor.role });
const audit = (ctx: Ctx, action: string, orderId: string, warehouseId: string) =>
  ({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, requestId: ctx.requestId, action, entityType: "order", entityId: orderId, warehouseId });
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const EDITABLE: readonly OrderStatus[] = ["PLACED", "CONFIRMED", "PACKING", "READY"];

/** What warehouse staff and owners do with orders (F14). */
export function createAdminOrderService(deps: OrderDeps, core: OrderCore) {
  const { store, stock, money, notifier, geography, riders, settings, now } = deps;

  async function load(ctx: Ctx, id: string): Promise<{ order: Order; group: OrderGroup }> {
    const order = await store.getOrder(id);
    if (!order) throw notFound("Order");
    assertWarehouseScope(ctx.actor, order.warehouseId);
    return { order, group: (await store.getGroup(order.groupId))! };
  }
  async function view(order: Order, group?: OrderGroup) {
    const [g, warehouse, rider, events] = await Promise.all([
      group ?? store.getGroup(order.groupId), geography.warehouse(order.warehouseId), riders.riderOf(order.id), store.eventsOf(order.id),
    ]);
    return adminOrderView(order, g!, { id: order.warehouseId, name: warehouse?.name ?? "" }, rider ? { id: rider.id, name: rider.name } : null, events);
  }
  const scopeIds = (ctx: Ctx, warehouseId?: string): readonly string[] | undefined => {
    if (warehouseId) { assertWarehouseScope(ctx.actor, warehouseId); return [warehouseId]; }
    return ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds;
  };

  /** Minutes the order has been in its current state beyond what that state should take. */
  function delayed(order: Order): boolean {
    const t = now().getTime();
    const since = (d: Date | null) => (d ? (t - d.getTime()) / 60_000 : 0);
    if (order.status === "PLACED") return since(order.stamps.placedAt) > settings.slaMinutes.confirm;
    if (order.status === "CONFIRMED" || order.status === "PACKING") return since(order.stamps.confirmedAt) > settings.slaMinutes.pack + settings.slaMinutes.confirm;
    if (order.status === "READY") return since(order.stamps.readyAt) > settings.slaMinutes.assign;
    return false;
  }
  const summary = async (order: Order, event: string, at: Date) => {
    const rider = ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"].includes(order.status) ? await riders.riderOf(order.id) : null;
    return {
      event, order: {
        id: order.id, orderNo: order.orderNo, groupId: order.groupId, warehouseId: order.warehouseId, status: order.status, itemCount: order.items.filter(i => i.status !== "unavailable").reduce((s, i) => s + i.qty, 0),
        amountDue: order.amountDue, paymentMethod: order.paymentMethod, customerName: order.customerName, locality: order.locality, riderId: rider?.id ?? null, riderName: rider?.name ?? null,
        ackStatus: null as string | null, promisedAt: order.promisedAt.toISOString(), delayed: delayed(order), updatedAt: at.toISOString(),
      },
    };
  };

  /** Takes quantity off one line: stock goes back, the bill drops, a prepaid customer is refunded. The delivery fee never goes up. */
  async function removeQuantity(ctx: Ctx, orderId: string, index: number, newQty: number, reason: string) {
    const { order, group } = await load(ctx, orderId);
    if (!EDITABLE.includes(order.status)) throw core.invalid(order.status);
    const item = order.items[index];
    if (!item) throw notFound("Order line");
    if (item.status === "unavailable") throw validation("That line is already removed", { field: "itemIndex" });
    if (newQty < 0 || newQty >= item.qty) throw validation("The new quantity must be lower than the current one", { field: "qty", current: item.qty });
    const removedQty = item.qty - newQty;
    const removedValue = item.unitPrice * removedQty;
    const discountShare = order.itemsSubtotal > 0 ? Math.floor((order.allocatedDiscount * removedValue) / order.itemsSubtotal) : 0;
    const customerDelta = removedValue - discountShare;
    const items = order.items.map((i, n) => (n === index ? { ...i, qty: newQty, lineTotal: i.unitPrice * newQty, status: newQty === 0 ? "unavailable" as const : "reduced" as const, unavailableReason: reason } : i));
    const prepaid = order.paymentMethod === "online" && order.paymentStatus === "paid";
    const next: Partial<Order> = {
      items, itemsSubtotal: order.itemsSubtotal - removedValue, allocatedDiscount: order.allocatedDiscount - discountShare,
      amountDue: prepaid ? 0 : Math.max(0, order.amountDue - customerDelta), paidAmount: prepaid ? Math.max(0, order.paidAmount - customerDelta) : order.paidAmount,
    };
    const updated = await store.patch(order.id, next, core.eventOf(order, "item_unavailable", actorOf(ctx), { meta: { index, name: item.name, removedQty, newQty, reason, refund: prepaid ? customerDelta : 0 } }), { rev: order.rev }, audit(ctx, "orders.item_unavailable", order.id, order.warehouseId));
    if (!updated) throw core.conflictStale();
    await stock.restore({ key: group.id, restoreKey: `item:${order.id}:${index}:${order.rev}`, reason: "cancel", lines: [{ warehouseId: order.warehouseId, productId: item.productId, variantId: item.variantId, qty: removedQty }] }).catch(() => undefined);
    await store.updateGroup(group.id, { pricing: { ...group.pricing, subtotal: group.pricing.subtotal - removedValue, discount: group.pricing.discount - discountShare, total: group.pricing.total - customerDelta } });
    let refund: { id: string; amount: number } | null = null;
    if (prepaid && customerDelta > 0) {
      refund = await money.refund({ order: updated, group, amount: customerDelta, reason: `${item.name}: ${reason}`, kind: "item_removed", key: `item:${order.id}:${index}:${order.rev}`, by: actorOf(ctx) });
      if (refund) await store.patch(order.id, { refundStatus: "pending" });
    }
    await notifier.itemUnavailable(order.userId, updated, item.name).catch(() => undefined);
    // Nothing left to deliver: the order is cancelled.
    if (updated.items.every(i => i.status === "unavailable")) {
      const cancelled = await core.move(order.id, "CANCELLED", actorOf(ctx), { reason: "All items were unavailable" });
      if (!cancelled.ok) throw core.invalid(updated.status, "CANCELLED");
      return { order: await view(cancelled.order, group), refund: refund && { id: refund.id, amount: refund.amount, status: "requested" as const }, notifiedCustomer: true };
    }
    return { order: await view((await store.getOrder(order.id))!, group), refund: refund && { id: refund.id, amount: refund.amount, status: "requested" as const }, notifiedCustomer: true };
  }

  async function step(ctx: Ctx, id: string, to: OrderStatus, audited = false) {
    const { order, group } = await load(ctx, id);
    const result = await core.move(id, to, actorOf(ctx));
    if (audited) await store.recordAudit(audit(ctx, `orders.${to.toLowerCase()}`, id, order.warehouseId));
    return view(core.orThrow(result, to), group);
  }

  return {
    async list(ctx: Ctx, query: AdminOrderQuery) {
      const warehouseIds = scopeIds(ctx, query.warehouseId);
      const ids = query.riderId ? await riders.ordersOf(query.riderId) : undefined;
      const rows = await store.listOrders({
        ...(warehouseIds && { warehouseIds }), ...(query.statuses && { statuses: query.statuses }), ...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
        ...(query.q && { q: query.q }), ...(query.from && { from: query.from }), ...(query.to && { to: query.to }), ...(query.isPreOrder !== undefined && { preOrder: query.isPreOrder }),
        ...(query.flagged && { flagged: true }), ...(ids && { ids }),
      }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      return { data: await Promise.all(page.map(o => view(o))), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },

    /** New and changed orders since a cursor. The first call (no cursor) just returns where the feed is now. */
    async changes(ctx: Ctx, query: { since?: string | undefined; warehouseId?: string | undefined; statuses?: OrderStatus[] | undefined }) {
      const warehouseIds = scopeIds(ctx, query.warehouseId);
      if (query.since === undefined) return { data: [], cursor: `c_${await store.latestChange()}`, newCount: 0 };
      const match = /^c_(\d{1,12})$/.exec(query.since);
      if (!match) throw validation("Invalid cursor", { field: "since" });
      const since = Number(match[1]);
      const entries = await store.changesSince(since, { ...(warehouseIds && { warehouseIds }) }, 200);
      const last = new Map<string, { event: string; at: Date; created: boolean }>();
      for (const e of entries) {
        const before = last.get(e.orderId);
        last.set(e.orderId, { event: e.event, at: e.at, created: (before?.created ?? false) || e.event === "created" });
      }
      const orders = new Map((await store.getOrders([...last.keys()])).map(o => [o.id, o]));
      const data = (await Promise.all([...last].map(async ([orderId, info]) => {
        const order = orders.get(orderId);
        if (!order || (query.statuses && !query.statuses.includes(order.status))) return [];
        return [await summary(order, info.created ? "created" : info.event, info.at)];
      }))).flat();
      return { data, cursor: `c_${entries.length > 0 ? entries[entries.length - 1]!.seq : since}`, newCount: data.filter(d => d.event === "created").length };
    },

    async get(ctx: Ctx, id: string) { const { order, group } = await load(ctx, id); return view(order, group); },

    async getGroup(ctx: Ctx, id: string) {
      const group = await store.getGroup(id);
      if (!group) throw notFound("Order group");
      const kids = await store.childrenOf(id);
      for (const kid of kids) assertWarehouseScope(ctx.actor, kid.warehouseId);
      return {
        id: group.id, groupNo: group.groupNo, status: groupStatusOf(kids.map(k => k.status)), paymentMethod: group.paymentMethod, paymentStatus: group.paymentStatus,
        pricing: { subtotal: group.pricing.subtotal, discount: group.pricing.discount, charges: group.pricing.charges.map(c => ({ type: c.type, label: c.label, amount: c.amount })), tax: group.pricing.tax, total: group.pricing.total },
        couponCode: group.couponCode, customerId: group.userId, createdAt: group.createdAt.toISOString(), children: await Promise.all(kids.map(k => view(k, group))),
      };
    },

    confirm: (ctx: Ctx, id: string) => step(ctx, id, "CONFIRMED"),
    startPacking: (ctx: Ctx, id: string) => step(ctx, id, "PACKING"),
    completePacking: (ctx: Ctx, id: string) => step(ctx, id, "READY"),

    unavailable: (ctx: Ctx, id: string, index: number, input: { reason: string; availableQty?: number | undefined }) => removeQuantity(ctx, id, index, input.availableQty ?? 0, input.reason),
    async editQuantity(ctx: Ctx, id: string, index: number, qty: number) {
      if (qty < 1) throw validation("Use the unavailable call to remove a line", { field: "qty" });
      return (await removeQuantity(ctx, id, index, qty, "quantity_reduced")).order;
    },

    async cancel(ctx: Ctx, id: string, reason: string) {
      const { order, group } = await load(ctx, id);
      if (!CANCELLABLE.includes(order.status)) throw new AppError("ORDER_NOT_CANCELLABLE", "The order has been picked up. Use failed delivery or a hand-over instead.", { status: order.status });
      const result = await core.move(id, "CANCELLED", actorOf(ctx), { reason });
      await store.recordAudit(audit(ctx, "orders.cancel", id, order.warehouseId));
      return view(core.orThrow(result, "CANCELLED"), group);
    },

    async forceStatus(ctx: Ctx, id: string, to: OrderStatus, reason: string) {
      const { order, group } = await load(ctx, id);
      const result = await core.move(id, to, actorOf(ctx), { reason, forced: true }, { force: true });
      await store.recordAudit(audit(ctx, "orders.force_status", id, order.warehouseId));
      return view(core.orThrow(result, to), group);
    },

    async addNote(ctx: Ctx, id: string, text: string) {
      const { order } = await load(ctx, id);
      const note = { text, by: ctx.actor.userId, at: now() };
      await store.addNote(id, note, core.eventOf(order, "note", actorOf(ctx), { meta: { text } }));
      return { text: note.text, by: note.by, at: note.at.toISOString() };
    },

    /** A printable 80 mm bill, or a packing slip with a tick box for each item. */
    async print(ctx: Ctx, id: string, type: "bill" | "slip"): Promise<string> {
      const { order, group } = await load(ctx, id);
      const warehouse = await geography.warehouse(order.warehouseId);
      const lines = order.items.filter(i => i.status !== "unavailable");
      const rows = lines.map(i => type === "slip"
        ? `<tr><td>&#9744;</td><td>${escapeHtml(i.name)} (${escapeHtml(i.variantLabel)})</td><td class="r">${i.qty}</td></tr>`
        : `<tr><td>${escapeHtml(i.name)} (${escapeHtml(i.variantLabel)}) x ${i.qty}</td><td class="r">${rupees(i.lineTotal)}</td></tr>`).join("");
      const money_ = type === "bill"
        ? `<hr><p>Items ${rupees(order.itemsSubtotal)}${order.allocatedDiscount ? `<br>Discount -${rupees(order.allocatedDiscount)}` : ""}${order.allocatedCharges.map(c => `<br>${escapeHtml(c.label)} ${rupees(c.amount)}`).join("")}<br><strong>${order.paymentMethod === "cod" ? `Pay on delivery ${rupees(order.amountDue)}` : "Paid online"}</strong></p>`
        : "";
      return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.orderNo)}</title><style>
body{font:12px monospace;width:72mm;margin:0 auto;padding:4mm}h1{font-size:14px;margin:0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.r{text-align:right}hr{border:0;border-top:1px dashed #000}@media print{body{width:auto}}
</style></head><body><h1>${escapeHtml(warehouse?.name ?? "Darjeeling Stores")}</h1><p>${type === "bill" ? "Bill" : "Packing slip"} ${escapeHtml(order.orderNo)}<br>${escapeHtml(group.address.contactName)}, ${escapeHtml(group.address.locality)}<br>${new Date(order.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p><hr><table>${rows}</table>${money_}${type === "slip" && group.address.deliveryNotes ? `<hr><p>Note: ${escapeHtml(group.address.deliveryNotes)}</p>` : ""}</body></html>`;
    },
  };
}

export type AdminOrderService = ReturnType<typeof createAdminOrderService>;
