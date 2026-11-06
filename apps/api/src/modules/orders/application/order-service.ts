import { createHash } from "node:crypto";
import type { DeliveryOrder, OrderActor, OrdersPort } from "../../../platform/orders.js";
import { AppError, conflict, notFound, validation } from "../../catalog/catalog.public.js";
import {
  customerGroupView, customerOrderView, groupStatusOf, paymentStatusAfterCollection, toDeliveryOrder,
  type Order, type OrderGroup, type OrderStatus, type PaymentStatus,
} from "../domain/order.js";
import { newCode, sameCode, type Actor, type OrderCore } from "./order-core.js";
import { DuplicateGroupError, type OrderDeps } from "./ports.js";

export interface PlaceInput { quoteId: string; paymentMethod: "cod" | "online"; deliveryNotes?: string | null | undefined; voiceMediaId?: string | null | undefined; housePhotoMediaId?: string | null | undefined }

const LETTERS = "ABCDEFGH";
const actorOf = (by: OrderActor): Actor => ({ userId: by.kind === "system" ? null : by.id, role: by.kind === "rider" ? "rider" : by.kind === "admin" ? "admin" : "system" });
const hashOf = (input: PlaceInput) => createHash("sha256").update(JSON.stringify([input.quoteId, input.paymentMethod, input.deliveryNotes ?? null, input.voiceMediaId ?? null, input.housePhotoMediaId ?? null])).digest("hex");

/** Placing orders, what customers see of them, and the orders port used by delivery (F13, F14). */
export function createOrderService(deps: OrderDeps, core: OrderCore) {
  const { store, quotes, carts, addresses, stock, coupons, media, riders, money, notifier, link, settings, now, newId } = deps;

  async function trackingUrl(orderId: string): Promise<string | null> {
    const made = settings.trackingBaseUrl ? link(orderId) : null;
    return made ? `${settings.trackingBaseUrl}/track/${made.token}` : null;
  }

  /** The status changes of an order with their times, starting from when it was placed. */
  async function timelineOf(order: Order): Promise<{ status: OrderStatus; at: Date }[]> {
    const changes = (await store.eventsOf(order.id)).filter(e => e.type === "status_change" && e.to).map(e => ({ status: e.to as OrderStatus, at: e.at }));
    const first = { status: (order.paymentMethod === "online" && !order.stamps.placedAt ? "PENDING_PAYMENT" : "PLACED") as OrderStatus, at: order.stamps.placedAt ?? order.createdAt };
    return [first, ...changes.filter(c => c.status !== "PLACED")];
  }

  async function childView(order: Order) {
    const hasRider = !["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY"].includes(order.status);
    const [timeline, rider, expired] = await Promise.all([
      timelineOf(order), hasRider ? riders.riderOf(order.id) : Promise.resolve(null), order.voiceMediaId ? media.isExpired(order.voiceMediaId) : Promise.resolve(false),
    ]);
    return customerOrderView(order, rider ? { name: rider.name, phone: rider.phone } : null, timeline, expired);
  }

  async function groupView(g: OrderGroup, showCode = true) {
    const kids = await store.childrenOf(g.id);
    const status = groupStatusOf(kids.map(k => k.status));
    const open = status === "ACTIVE" || status === "PENDING_PAYMENT";
    return customerGroupView(g, await Promise.all(kids.map(childView)), status, await trackingUrl(kids[0]!.id), showCode && open ? core.box.open(g.deliveryOtpEnc) : null);
  }

  /** Undoes the holds taken for an order that could not be saved. */
  async function rollback(groupId: string, couponHeld: boolean): Promise<void> {
    await stock.release(groupId, "cancel").catch(() => undefined);
    if (couponHeld) await coupons.release(groupId).catch(() => undefined);
  }

  const service = {
    groupView, childView,
    /** How many orders a customer has placed (for first-order coupons). */
    orderCount: (userId: string) => store.countGroupsOf(userId),

    async place(userId: string, input: PlaceInput, key: string) {
      if (!key || key.length > 120) throw validation("An Idempotency-Key header is required", { field: "Idempotency-Key" });
      const requestHash = hashOf(input);
      const existing = await store.findGroupByKey(userId, key);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used with a different request");
        return { group: await groupView(existing), payment: existing.paymentMethod === "online" ? await money.startPayment(existing).catch(() => null) : null };
      }
      const quote = await quotes.get(userId, input.quoteId);
      if (quote.usedByGroupId) throw conflict("This quote was already used for an order", { reason: "quote_used" });
      if (input.paymentMethod === "cod" && !quote.payment.codAllowed) throw new AppError("COD_NOT_ALLOWED", "Cash on delivery is not available for this order");
      const fresh = await quotes.revalidate(userId, input.quoteId);
      if (fresh.changed) throw new AppError("QUOTE_CHANGED", "Prices or delivery details changed. Please check the new total.", { quote: fresh.quote });
      const address = await addresses.forOrder(userId, quote.addressId);
      if (!address) throw notFound("Address");

      const groupId = newId();
      const at = now();
      const online = input.paymentMethod === "online";
      const groupNo = `DS-${await store.nextGroupNumber()}`;
      let couponHeld = false;
      if (quote.couponId) couponHeld = await coupons.hold(userId, quote.couponId, groupId, quote.pricing.discount);
      try {
        const reserved = await stock.reserve({
          key: groupId, holdSeconds: online ? settings.paymentWindowMinutes * 60 : 120,
          lines: quote.allocation.flatMap(d => d.lines.map(l => ({ warehouseId: d.warehouseId, productId: l.productId, variantId: l.variantId, qty: l.qty }))),
        });
        if (!reserved.ok) {
          const lines = reserved.shortages.map(s => ({ productId: s.productId, variantId: s.variantId, requested: s.requested, available: s.available, reason: s.reason }));
          await coupons.release(groupId).catch(() => undefined);
          throw new AppError(reserved.shortages.some(s => s.reason === "insufficient") ? "INSUFFICIENT_STOCK" : "ITEM_UNAVAILABLE", "Some items are no longer available", { lines });
        }
        const holder = await quotes.claim(input.quoteId, groupId);
        if (holder !== groupId) { await rollback(groupId, couponHeld); throw conflict("This quote was already used for an order", { reason: "quote_used" }); }

        const split = quote.allocation.length > 1;
        const children: Order[] = quote.allocation.map((d, i) => {
          const charges = d.allocatedCharges.reduce((sum, c) => sum + c.amount, 0);
          const owed = d.itemsSubtotal - d.allocatedDiscount + charges;
          return {
            id: newId(), orderNo: split ? `${groupNo}-${LETTERS[i]}` : groupNo, groupId, userId, zoneId: quote.zoneId, warehouseId: d.warehouseId,
            status: online ? "PENDING_PAYMENT" : "PLACED", paymentMethod: input.paymentMethod, paymentStatus: online ? "pending" : "cod_pending", refundStatus: "none",
            customerName: address.contactName, customerPhone: address.contactPhone, locality: address.localityName,
            items: d.lines.map(l => ({
              productId: l.productId, variantId: l.variantId, name: l.name, variantLabel: l.variantLabel, weightGrams: l.weightGrams, unitPrice: l.unitPrice, qty: l.qty, originalQty: l.qty,
              lineTotal: l.lineTotal, gstRate: 0, hsnCode: null, status: "ok" as const, unavailableReason: null,
            })),
            itemsSubtotal: d.itemsSubtotal, allocatedDiscount: d.allocatedDiscount, allocatedCharges: d.allocatedCharges, amountDue: online ? 0 : owed, paidAmount: 0,
            scheduledWindow: quote.scheduledWindow, eta: { packMinutes: d.eta.packMinutes, riderArrivalMinutes: d.eta.riderArrivalMinutes, travelMinutes: d.eta.travelMinutes, extraMinutes: d.eta.extraMinutes },
            promisedAt: d.eta.promisedAt, stamps: { ...emptyStampsAt(online ? null : at) }, voiceMediaId: null, voiceDurationSec: null, housePhotoMediaId: null, bagCount: null,
            collection: null, delivery: null, failedDelivery: null, cancel: null, notes: [], rev: 0, createdAt: at, updatedAt: at,
          };
        });
        const group: OrderGroup = {
          id: groupId, groupNo, userId, zoneId: quote.zoneId,
          address: {
            line1: address.line1, landmark: address.landmark, locality: address.localityName, city: address.cityId, pincode: address.pincode, contactName: address.contactName,
            contactPhone: address.contactPhone, location: address.location, locationAccuracyM: address.locationAccuracyM, deliveryNotes: input.deliveryNotes ?? address.deliveryNotes,
          },
          paymentMethod: input.paymentMethod, paymentStatus: online ? "pending" : "cod_pending", pricing: quote.pricing, couponCode: quote.couponCode, couponId: quote.couponId, quoteId: quote.id,
          deliveryOtpEnc: core.box.seal(newCode()), otpWrong: 0, expiresAt: online ? new Date(at.getTime() + settings.paymentWindowMinutes * 60_000) : null,
          idempotencyKey: key, requestHash, childOrderIds: children.map(c => c.id), source: "app", createdAt: at, updatedAt: at,
        };
        // A pre-order takes a place in its slot, atomically against the slot's capacity.
        if (quote.scheduledWindow) {
          const held: string[] = [];
          try { for (const child of children) { await deps.slots.hold(child.id, child.warehouseId, quote.scheduledWindow); held.push(child.id); } }
          catch (error) { for (const id of held) await deps.slots.release(id).catch(() => undefined); await rollback(groupId, couponHeld); throw error; }
        }
        const events = children.map(c => core.eventOf(c, "placed", { userId, role: "customer" }, { to: c.status, meta: { groupNo }, at }));
        try { await store.insertGroup(group, children, events); }
        catch (error) {
          await rollback(groupId, couponHeld);
          if (error instanceof DuplicateGroupError) {
            const winner = await store.findGroupByKey(userId, key);
            if (winner && winner.requestHash === requestHash) return { group: await groupView(winner), payment: online ? await money.startPayment(winner).catch(() => null) : null };
            throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used with a different request");
          }
          throw error;
        }

        if (!online) await stock.confirm(groupId).catch(() => undefined);
        // Files the customer attached to the address become the order's own copies.
        for (const child of children) {
          const voice = input.voiceMediaId ?? address.voiceMediaId;
          const photo = input.housePhotoMediaId ?? address.housePhotoMediaId;
          const patch: Partial<Order> = {};
          if (voice) { const copy = await media.copyToOrder({ sourceMediaId: voice, orderId: child.id }).catch(() => null); if (copy) { patch.voiceMediaId = copy.mediaId; patch.voiceDurationSec = address.voiceDurationSec; } }
          if (photo) { const copy = await media.copyToOrder({ sourceMediaId: photo, orderId: child.id }).catch(() => null); if (copy) patch.housePhotoMediaId = copy.mediaId; }
          if (Object.keys(patch).length > 0) await store.patch(child.id, patch);
        }
        await quotes.clearCart(userId);
        if (!online && settings.confirmMode === "auto") for (const child of children) await core.move(child.id, "CONFIRMED", { userId: null, role: "system" });
        await notifier.placed(userId, group, children.map(c => c.orderNo)).catch(() => undefined);
        for (const child of children) await notifier.newOrder(child.warehouseId, child).catch(() => undefined);
        const saved = (await store.getGroup(groupId))!;
        return { group: await groupView(saved), payment: online ? await money.startPayment(saved).catch(() => null) : null };
      } catch (error) {
        throw error;
      }
    },

    async myOrders(userId: string, query: { status?: "active" | "past" | undefined; limit: number; cursor?: string | undefined }) {
      const groups = await store.listGroupsOf(userId, query.status === "active" ? { live: true } : query.status === "past" ? { live: false } : {}, query.limit + 1, query.cursor);
      const page = groups.slice(0, query.limit);
      const data = await Promise.all(page.map(async g => {
        const kids = await store.childrenOf(g.id);
        return {
          groupId: g.id, groupNo: g.groupNo, status: groupStatusOf(kids.map(k => k.status)), total: g.pricing.total, createdAt: g.createdAt.toISOString(),
          children: kids.map(k => ({ id: k.id, orderNo: k.orderNo, status: k.status, itemCount: k.items.filter(i => i.status !== "unavailable").reduce((s, i) => s + i.qty, 0), promisedAt: k.promisedAt.toISOString() })),
        };
      }));
      return { data, nextCursor: groups.length > query.limit ? page[page.length - 1]!.id : null };
    },

    async myGroup(userId: string, id: string) {
      const group = await store.getGroup(id);
      if (!group || group.userId !== userId) throw notFound("Order group");
      return groupView(group);
    },
    async myOrder(userId: string, id: string) {
      const order = await store.getOrder(id);
      if (!order || order.userId !== userId) throw notFound("Order");
      return childView(order);
    },
    async reorder(userId: string, id: string) {
      const order = await store.getOrder(id);
      if (!order || order.userId !== userId) throw notFound("Order");
      return carts.reorder(userId, order.items.filter(i => i.status !== "unavailable").map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.originalQty })));
    },

    /** Pre-orders whose slot starts in a time range, for the packing list. */
    async preorders(query: { from: Date; to: Date; warehouseIds?: readonly string[] | undefined; slotStart?: Date | undefined }) {
      const rows = await store.listOrders({ preOrder: true, windowFrom: query.from, windowTo: query.to, ...(query.warehouseIds && { warehouseIds: query.warehouseIds }), ...(query.slotStart && { windowStart: query.slotStart }) }, 500);
      return rows.filter(o => o.status !== "CANCELLED").map(o => ({
        orderId: o.id, orderNo: o.orderNo, warehouseId: o.warehouseId, status: o.status, itemCount: o.items.filter(i => i.status !== "unavailable").reduce((s, i) => s + i.qty, 0), scheduledWindow: o.scheduledWindow!,
      }));
    },

    /** The customer cancels their own order, while it is still early enough. Returns the refund asked for, if it was paid for. */
    async customerCancel(userId: string, orderId: string, reason: string) {
      const order = await store.getOrder(orderId);
      if (!order || order.userId !== userId) throw notFound("Order");
      const allowed = settings.customerCancelUntil === "PLACED" ? ["PENDING_PAYMENT", "PLACED"] : ["PENDING_PAYMENT", "PLACED", "CONFIRMED"];
      if (!allowed.includes(order.status)) throw new AppError("ORDER_NOT_CANCELLABLE", "This order can no longer be cancelled", { currentStatus: order.status });
      // A pre-order can be cancelled until its slot cutoff only; the slot is released with the order.
      const moved = await core.move(orderId, "CANCELLED", { userId, role: "customer" }, { reason });
      if (!moved.ok) {
        if (moved.reason === "not_found") throw notFound("Order");
        throw new AppError("ORDER_NOT_CANCELLABLE", "This order can no longer be cancelled", { currentStatus: moved.from });
      }
      return { order: { id: moved.order.id, status: moved.order.status }, refund: moved.refund ? { id: moved.refund.id, amount: moved.refund.amount, status: "requested" as const } : null, deliveryFeeRefunded: moved.feesRefunded ?? false };
    },

    /**
     * The online payment for a group arrived (F15): every order waiting for payment is placed (and confirmed when that is automatic),
     * and the stock hold becomes permanent. Safe to repeat.
     */
    async markGroupPaid(groupId: string, info: { paymentId: string }): Promise<{ changed: boolean }> {
      const group = await store.getGroup(groupId);
      if (!group) throw notFound("Order group");
      const kids = (await store.childrenOf(groupId)).filter(k => k.status === "PENDING_PAYMENT");
      if (kids.length === 0) return { changed: false };
      for (const kid of kids) {
        const owed = kid.itemsSubtotal - kid.allocatedDiscount + kid.allocatedCharges.reduce((sum, c) => sum + c.amount, 0);
        await store.patch(kid.id, { paymentStatus: "paid", paidAmount: owed }, core.eventOf(kid, "payment_captured", { userId: null, role: "system" }, { meta: { paymentId: info.paymentId, amount: owed } }));
        const placed = await core.move(kid.id, "PLACED", { userId: null, role: "system" }, { paymentId: info.paymentId });
        if (placed.ok && settings.confirmMode === "auto") await core.move(kid.id, "CONFIRMED", { userId: null, role: "system" });
      }
      await store.updateGroup(groupId, { paymentStatus: "paid", expiresAt: null });
      await stock.confirm(groupId).catch(() => undefined);
      const fresh = await store.childrenOf(groupId);
      await notifier.placed(group.userId, group, fresh.map(k => k.orderNo)).catch(() => undefined);
      for (const kid of fresh) await notifier.newOrder(kid.warehouseId, kid).catch(() => undefined);
      return { changed: true };
    },

    /** A cash-on-delivery group was paid online before the cash was taken: nothing is due at the door any more. */
    async markCodGroupPaid(groupId: string, info: { paymentId: string }): Promise<{ changed: boolean }> {
      const group = await store.getGroup(groupId);
      if (!group) throw notFound("Order group");
      let changed = false;
      for (const kid of (await store.childrenOf(groupId)).filter(k => !["CANCELLED", "DELIVERED"].includes(k.status) && k.collection === null && k.paymentStatus !== "paid")) {
        const owed = kid.amountDue;
        await store.patch(kid.id, { paymentStatus: "paid", paidAmount: owed, amountDue: 0 }, core.eventOf(kid, "paid_online", { userId: null, role: "system" }, { meta: { paymentId: info.paymentId, amount: owed } }));
        await deps.dispatch.paid(kid.id).catch(() => undefined);
        changed = true;
      }
      if (changed) await store.updateGroup(groupId, { paymentStatus: "paid" });
      return { changed };
    },

    /** Online orders whose payment time ran out are cancelled and their stock released. Returns how many groups. */
    async expireOverdue(limit = 50): Promise<number> {
      const due = await store.expiredGroupIds(now(), limit);
      let count = 0;
      for (const groupId of due) {
        const kids = (await store.childrenOf(groupId)).filter(k => k.status === "PENDING_PAYMENT");
        for (const kid of kids) await core.move(kid.id, "CANCELLED", { userId: null, role: "system" }, { reason: "payment_expired" });
        await stock.release(groupId, "expired").catch(() => undefined);
        await store.updateGroup(groupId, { expiresAt: null });
        if (kids.length > 0) count++;
      }
      return count;
    },

    /** The orders of a group that have not ended, for payment confirmation and expiry. */
    async groupForPayment(groupId: string) {
      const group = await store.getGroup(groupId);
      return group && { group, children: await store.childrenOf(groupId) };
    },
    setRefundStatus: async (orderId: string, refundStatus: "none" | "pending" | "done") => { await store.patch(orderId, { refundStatus }); },

    // ---------------------------------------------------------------- the port used by delivery

    port: ((): OrdersPort => {
      async function toDelivery(order: Order): Promise<DeliveryOrder> {
        const [group, kids, expired] = await Promise.all([store.getGroup(order.groupId), store.childrenOf(order.groupId), order.voiceMediaId ? media.isExpired(order.voiceMediaId) : Promise.resolve(false)]);
        return toDeliveryOrder(order, group!, kids.map(k => k.status), expired);
      }
      const asDelivery = async (orders: Order[]) => Promise.all(orders.map(toDelivery));
      const failure = (result: Exclude<Awaited<ReturnType<OrderCore["move"]>>, { ok: true }>) => result;
      return {
        get: async id => { const o = await store.getOrder(id); return o ? toDelivery(o) : null; },
        getMany: async ids => asDelivery(await store.getOrders(ids)),
        childrenOf: async groupId => asDelivery(await store.childrenOf(groupId)),
        listByStatus: async (status, limit) => asDelivery(await store.listByStatus(status, limit)),
        async transition(orderId, to, by, details) {
          const result = await core.move(orderId, to, actorOf(by), details ?? {});
          return result.ok ? { ok: true, order: await toDelivery(result.order) } : failure(result) as never;
        },
        async recordEvent(orderId, type, by, details) {
          const order = await store.getOrder(orderId);
          if (order) await store.addEvent(core.eventOf(order, type, actorOf(by), { meta: details ?? {} }));
        },
        async verifyDeliveryOtp(orderId, otp) {
          const order = await store.getOrder(orderId);
          const group = order ? await store.getGroup(order.groupId) : null;
          if (!group) return { valid: false, attemptsLeft: null, locked: false };
          if (group.otpWrong >= settings.otpMaxTries) return { valid: false, attemptsLeft: 0, locked: true };
          const code = core.box.open(group.deliveryOtpEnc);
          if (code && sameCode(code, otp)) return { valid: true };
          const wrong = await store.countWrongOtp(group.id);
          return { valid: false, attemptsLeft: Math.max(0, settings.otpMaxTries - wrong), locked: wrong >= settings.otpMaxTries };
        },
        async cancelFailedAndReturn(orderId, input, by) {
          const order = await store.getOrder(orderId);
          if (!order) return { ok: false, reason: "not_found" };
          if (order.status !== "FAILED_DELIVERY") return { ok: false, reason: "invalid_transition", from: order.status };
          // Good goods go back on the shelf; spoiled goods are written off and do not.
          const moved = await core.move(orderId, "CANCELLED", actorOf(by), { reason: "failed_delivery", goodsCondition: input.goodsCondition, note: input.note }, { skipEffects: true });
          if (!moved.ok) return moved.reason === "not_found" ? { ok: false, reason: "not_found" } : { ok: false, reason: "invalid_transition", ...(moved.from && { from: moved.from }) };
          const restock = input.goodsCondition === "good";
          const refund = await core.afterCancel(moved.order, actorOf(by), input.note ?? "Delivery failed", "failed_delivery", restock);
          return { ok: true, order: await toDelivery((await store.getOrder(orderId))!), refund };
        },
        async timeline(orderId) { const order = await store.getOrder(orderId); return order ? timelineOf(order) : []; },
        async deliveryCode(orderId) {
          const order = await store.getOrder(orderId);
          const group = order ? await store.getGroup(order.groupId) : null;
          return group ? core.box.open(group.deliveryOtpEnc) : null;
        },
        async setCollection(orderId, collection, by, details) {
          const order = await store.getOrder(orderId);
          if (!order) return { ok: false, reason: "not_found" };
          const at = now();
          const paymentStatus: PaymentStatus = collection ? paymentStatusAfterCollection(collection.method) : "cod_pending";
          const updated = await store.patch(orderId, { collection: collection ? { ...collection, at } : null, paymentStatus },
            core.eventOf(order, collection ? "collection" : "collection_cleared", actorOf(by), { meta: { ...details, ...(collection && { method: collection.method, amount: collection.amount }) } }));
          return updated ? { ok: true, order: await toDelivery(updated) } : { ok: false, reason: "not_found" };
        },
        async reverseDelivery(orderId, by, note) {
          const moved = await core.move(orderId, "FAILED_DELIVERY", actorOf(by), { reason: "delivery_rejected", note }, { force: true });
          return moved.ok ? { ok: true, order: await toDelivery(moved.order) } : failure(moved) as never;
        },
        async createRefund(orderId, input, by) {
          const order = await store.getOrder(orderId);
          const group = order ? await store.getGroup(order.groupId) : null;
          if (!order || !group) return null;
          return money.refund({ order, group, amount: input.amount, reason: input.reason, kind: "overpaid", key: `overpaid:${orderId}:${input.amount}`, by: { userId: by.kind === "system" ? null : by.id, role: by.kind } });
        },
      };
    })(),
  };
  return service;
}

function emptyStampsAt(placedAt: Date | null) {
  return {
    placedAt, confirmedAt: null, packingAt: null, readyAt: null, assignedAt: null, pickedUpAt: null, outForDeliveryAt: null, arrivedAt: null, deliveredAt: null, cancelledAt: null, failedAt: null,
  };
}

export type OrderService = ReturnType<typeof createOrderService>;
