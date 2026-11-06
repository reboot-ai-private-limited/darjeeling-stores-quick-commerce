export type RefundReason = "cancelled" | "item_unavailable" | "late_payment" | "damaged_item" | "missing_item" | "overpaid" | "other";
export type RefundSource = "auto" | "customer_request" | "admin";
export type RefundStatus = "requested" | "approved" | "done" | "rejected";
export type RefundMethod = "razorpay_dashboard" | "upi" | "cash";

export interface Refund {
  id: string; groupId: string; orderId: string; orderNo: string; userId: string; warehouseId: string; paymentMethod: "cod" | "online";
  amount: number; reason: RefundReason; source: RefundSource; status: RefundStatus; customerNote: string | null; photos: { mediaId: string }[];
  items: { orderItemIndex: number; qty: number }[]; rejectReason: string | null; method: RefundMethod | null; reference: string | null; note: string | null;
  /** Makes an automatic refund for the same event a single refund. */
  dedupeKey: string | null; createdBy: string | null; decidedBy: string | null; createdAt: Date; decidedAt: Date | null; markedDoneAt: Date | null;
}

export const OPEN: readonly RefundStatus[] = ["requested", "approved"];

export const refundView = (r: Refund) => ({
  id: r.id, groupId: r.groupId, orderId: r.orderId, orderNo: r.orderNo, amount: r.amount, reason: r.reason, source: r.source, status: r.status,
  customerNote: r.customerNote, photos: r.photos, items: r.items, rejectReason: r.rejectReason, method: r.method, reference: r.reference, note: r.note,
  createdAt: r.createdAt.toISOString(), markedDoneAt: r.markedDoneAt?.toISOString() ?? null,
});

/** The line value taken off a refund because of the discount that was spread over the order. */
export const discountShare = (allocatedDiscount: number, itemsSubtotal: number, lineValue: number) =>
  itemsSubtotal > 0 ? Math.floor((allocatedDiscount * lineValue) / itemsSubtotal) : 0;

/** What an order cost the customer in total: items less discount, plus its share of the fees. */
export const orderTotal = (o: { itemsSubtotal: number; allocatedDiscount: number; allocatedCharges: { amount: number }[] }) =>
  o.itemsSubtotal - o.allocatedDiscount + o.allocatedCharges.reduce((sum, c) => sum + c.amount, 0);
