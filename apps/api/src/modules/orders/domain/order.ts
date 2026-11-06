import type { DeliveryOrder, OrderStatus } from "../../../platform/orders.js";

export type { OrderStatus } from "../../../platform/orders.js";

/** The legal moves of the one state machine every child order follows (F14). */
export const LEGAL: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ["PLACED", "CANCELLED"], PLACED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["PACKING", "CANCELLED"], PACKING: ["READY", "CANCELLED"],
  READY: ["ASSIGNED", "CANCELLED"], ASSIGNED: ["READY", "PICKED_UP", "CANCELLED"], PICKED_UP: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["ARRIVED", "FAILED_DELIVERY"], ARRIVED: ["DELIVERED", "FAILED_DELIVERY"], DELIVERED: [], FAILED_DELIVERY: ["READY", "CANCELLED"], CANCELLED: [],
};
export const TERMINAL: readonly OrderStatus[] = ["DELIVERED", "CANCELLED"];
/** Before pickup: the admin may still cancel, and goods are still in the warehouse. */
export const CANCELLABLE: readonly OrderStatus[] = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED"];
/** The customer may cancel up to here (the `customerCancelUntil` setting). */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ["PENDING_PAYMENT", "PLACED", "CONFIRMED"];
export const ACTIVE_BEFORE_PICKUP: readonly OrderStatus[] = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED"];

export type PaymentStatus = "pending" | "paid" | "failed" | "cod_pending" | "cod_collected" | "upi_unverified" | "upi_verified";
export type RefundStatus = "none" | "pending" | "done";

export interface OrderItem {
  productId: string; variantId: string; name: string; variantLabel: string; weightGrams: number; unitPrice: number; qty: number; originalQty: number; lineTotal: number;
  gstRate: number; hsnCode: string | null; status: "ok" | "unavailable" | "reduced"; unavailableReason: string | null;
}
export interface Stamps {
  placedAt: Date | null; confirmedAt: Date | null; packingAt: Date | null; readyAt: Date | null; assignedAt: Date | null; pickedUpAt: Date | null;
  outForDeliveryAt: Date | null; arrivedAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null; failedAt: Date | null;
}
export const STAMP_OF: Partial<Record<OrderStatus, keyof Stamps>> = {
  PLACED: "placedAt", CONFIRMED: "confirmedAt", PACKING: "packingAt", READY: "readyAt", ASSIGNED: "assignedAt", PICKED_UP: "pickedUpAt",
  OUT_FOR_DELIVERY: "outForDeliveryAt", ARRIVED: "arrivedAt", DELIVERED: "deliveredAt", CANCELLED: "cancelledAt", FAILED_DELIVERY: "failedAt",
};
export const emptyStamps = (): Stamps => ({
  placedAt: null, confirmedAt: null, packingAt: null, readyAt: null, assignedAt: null, pickedUpAt: null, outForDeliveryAt: null, arrivedAt: null, deliveredAt: null, cancelledAt: null, failedAt: null,
});

export interface Order {
  id: string; orderNo: string; groupId: string; userId: string; zoneId: string; warehouseId: string; status: OrderStatus;
  paymentMethod: "cod" | "online"; paymentStatus: PaymentStatus; refundStatus: RefundStatus;
  customerName: string; customerPhone: string; locality: string;
  items: OrderItem[]; itemsSubtotal: number; allocatedDiscount: number; allocatedCharges: { type: string; label: string; amount: number }[];
  /** What the customer owes in cash for this order; 0 when prepaid. */
  amountDue: number;
  /** What the customer has paid online toward this order (items, its share of fees, less discount). */
  paidAmount: number;
  scheduledWindow: { start: Date; end: Date } | null;
  eta: { packMinutes: number; riderArrivalMinutes: number; travelMinutes: number; extraMinutes: number }; promisedAt: Date;
  stamps: Stamps; voiceMediaId: string | null; voiceDurationSec: number | null; housePhotoMediaId: string | null; bagCount: number | null;
  collection: { method: "cash" | "upi_unverified" | "upi_verified"; amount: number; at: Date } | null;
  delivery: { offline: boolean; deviceTime: Date | null; location: { lat: number; lng: number } | null; accuracyM: number | null; syncedAt: Date | null } | null;
  failedDelivery: { reason: string; note: string | null; photoMediaId: string | null; at: Date } | null;
  cancel: { by: string; role: string; reason: string; at: Date } | null;
  notes: { text: string; by: string; at: Date }[]; rev: number; createdAt: Date; updatedAt: Date;
}

export interface GroupAddress {
  line1: string; landmark: string; locality: string; city: string; pincode: string; contactName: string; contactPhone: string;
  location: { lat: number; lng: number }; locationAccuracyM: number | null; deliveryNotes: string | null;
}
export interface OrderGroup {
  id: string; groupNo: string; userId: string; zoneId: string; address: GroupAddress; paymentMethod: "cod" | "online"; paymentStatus: PaymentStatus;
  pricing: { subtotal: number; discount: number; charges: { type: string; label: string; amount: number; ruleId: string }[]; tax: number; total: number; taxInclusive: boolean };
  couponCode: string | null; couponId: string | null; quoteId: string; deliveryOtpEnc: string; otpWrong: number; expiresAt: Date | null;
  idempotencyKey: string; requestHash: string; childOrderIds: string[]; source: "app" | "web"; createdAt: Date; updatedAt: Date;
}
export interface OrderEvent {
  id: string; orderId: string; groupId: string; type: string; from: OrderStatus | null; to: OrderStatus | null;
  actor: { userId: string | null; role: string; name?: string | null }; meta: Record<string, unknown>; at: Date;
}

export type GroupStatus = "PENDING_PAYMENT" | "ACTIVE" | "DELIVERED" | "PARTIAL" | "CANCELLED";
/** The group's status, worked out from its children. */
export function groupStatusOf(statuses: readonly OrderStatus[]): GroupStatus {
  if (statuses.length === 0) return "CANCELLED";
  if (statuses.every(s => s === "PENDING_PAYMENT")) return "PENDING_PAYMENT";
  const live = statuses.filter(s => s !== "CANCELLED");
  if (live.length === 0) return "CANCELLED";
  if (live.every(s => s === "DELIVERED")) return statuses.some(s => s === "CANCELLED") ? "PARTIAL" : "DELIVERED";
  return "ACTIVE";
}

export const paymentStatusAfterCollection = (method: "cash" | "upi_unverified" | "upi_verified"): PaymentStatus =>
  method === "cash" ? "cod_collected" : method === "upi_unverified" ? "upi_unverified" : "upi_verified";

export const allowedFrom = (status: OrderStatus): readonly OrderStatus[] => LEGAL[status];

/** The order as the delivery modules see it (see platform/orders.ts). */
export function toDeliveryOrder(o: Order, g: OrderGroup, siblings: readonly OrderStatus[], voiceExpired: boolean): DeliveryOrder {
  return {
    id: o.id, orderNo: o.orderNo, groupId: o.groupId, groupNo: g.groupNo, customerUserId: o.userId, status: o.status, groupStatus: groupStatusOf(siblings),
    zoneId: o.zoneId, warehouseId: o.warehouseId, customer: { name: g.address.contactName, phone: g.address.contactPhone },
    items: o.items.map(i => ({ name: i.name, variantLabel: i.variantLabel, qty: i.qty, status: i.status })),
    itemCount: o.items.filter(i => i.status !== "unavailable").reduce((sum, i) => sum + i.qty, 0), bagCount: o.bagCount,
    address: { line1: g.address.line1, landmark: g.address.landmark, locality: g.address.locality, location: g.address.location, locationAccuracyM: g.address.locationAccuracyM, deliveryNotes: g.address.deliveryNotes },
    voiceNote: o.voiceMediaId ? { mediaId: o.voiceMediaId, durationSec: o.voiceDurationSec, expired: voiceExpired } : null,
    housePhoto: o.housePhotoMediaId ? { mediaId: o.housePhotoMediaId } : null,
    paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, amountDue: o.amountDue,
    alreadyPaid: o.paymentMethod === "online" && o.paymentStatus === "paid",
    collectionRecorded: o.collection !== null, collectionMethod: o.collection?.method ?? null, collectionAmount: o.collection?.amount ?? null,
    deliveredOffline: o.delivery?.offline ?? false, otpRequired: true, promisedAt: o.promisedAt, readyAt: o.stamps.readyAt, deliveredAt: o.stamps.deliveredAt,
  };
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const STATUS_ORDER: OrderStatus[] = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED", "FAILED_DELIVERY", "CANCELLED"];

export const itemView = (i: OrderItem, index: number, imageUrl: string | null = null) => ({
  index, productId: i.productId, variantId: i.variantId, name: i.name, variantLabel: i.variantLabel, weightGrams: i.weightGrams, unitPrice: i.unitPrice, qty: i.qty,
  lineTotal: i.lineTotal, gstRate: i.gstRate, status: i.status, ...(i.unavailableReason && { unavailableReason: i.unavailableReason }), imageUrl,
});

/** A child order for the customer who placed it. */
export function customerOrderView(o: Order, rider: { name: string; phone: string } | null, timeline: { status: OrderStatus; at: Date }[], voiceExpired: boolean) {
  return {
    id: o.id, orderNo: o.orderNo, groupId: o.groupId, warehouseId: o.warehouseId, status: o.status, paymentStatus: o.paymentStatus, refundStatus: o.refundStatus,
    items: o.items.map(i => ({ productId: i.productId, variantId: i.variantId, name: i.name, variantLabel: i.variantLabel, unitPrice: i.unitPrice, qty: i.qty, lineTotal: i.lineTotal, status: i.status, ...(i.unavailableReason && { unavailableReason: i.unavailableReason }), imageUrl: null as string | null })),
    itemsSubtotal: o.itemsSubtotal, amountDue: o.amountDue, promisedAt: o.promisedAt.toISOString(), scheduledWindow: o.scheduledWindow ? { start: o.scheduledWindow.start.toISOString(), end: o.scheduledWindow.end.toISOString() } : null,
    rider, voiceNoteExpired: voiceExpired, timeline: timeline.map(t => ({ status: t.status, at: t.at.toISOString() })),
  };
}

export function customerGroupView(g: OrderGroup, children: unknown[], status: GroupStatus, trackingUrl: string | null, deliveryOtp: string | null) {
  return {
    id: g.id, groupNo: g.groupNo, status, paymentMethod: g.paymentMethod, paymentStatus: g.paymentStatus,
    pricing: { subtotal: g.pricing.subtotal, discount: g.pricing.discount, charges: g.pricing.charges.map(c => ({ type: c.type, label: c.label, amount: c.amount })), tax: g.pricing.tax, total: g.pricing.total, taxInclusive: g.pricing.taxInclusive },
    address: {
      line1: g.address.line1, landmark: g.address.landmark, locality: g.address.locality, city: g.address.city, pincode: g.address.pincode, contactName: g.address.contactName,
      contactPhone: g.address.contactPhone, location: g.address.location,
    },
    deliveryOtp, trackingUrl, children, createdAt: g.createdAt.toISOString(),
  };
}

export function adminOrderView(
  o: Order, g: OrderGroup, warehouse: { id: string; name: string }, rider: { id: string; name: string } | null, events: OrderEvent[],
) {
  return {
    id: o.id, orderNo: o.orderNo, groupId: o.groupId, warehouse, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, refundStatus: o.refundStatus,
    customer: { id: o.userId, name: o.customerName, phone: o.customerPhone },
    address: { line1: g.address.line1, landmark: g.address.landmark, locality: g.address.locality, contactName: g.address.contactName, contactPhone: g.address.contactPhone, location: g.address.location, deliveryNotes: g.address.deliveryNotes },
    items: o.items.map((i, n) => itemView(i, n)), itemsSubtotal: o.itemsSubtotal, allocatedDiscount: o.allocatedDiscount, allocatedCharges: o.allocatedCharges.map(c => ({ type: c.type, amount: c.amount })),
    amountDue: o.amountDue, rider, promisedAt: o.promisedAt.toISOString(), scheduledWindow: o.scheduledWindow ? { start: o.scheduledWindow.start.toISOString(), end: o.scheduledWindow.end.toISOString() } : null,
    isPreOrder: o.scheduledWindow !== null, notes: o.notes.map(n => ({ text: n.text, by: n.by, at: n.at.toISOString() })),
    timeline: events.map(e => ({ type: e.type, from: e.from, to: e.to, actor: { role: e.actor.role, name: e.actor.name ?? null }, at: e.at.toISOString(), ...(Object.keys(e.meta).length > 0 && { meta: e.meta }) })),
    delivery: o.delivery ? { offline: o.delivery.offline, deviceTime: iso(o.delivery.deviceTime), location: o.delivery.location, accuracyM: o.delivery.accuracyM, syncedAt: iso(o.delivery.syncedAt) } : null,
    collection: o.collection ? { method: o.collection.method, amount: o.collection.amount, at: o.collection.at.toISOString() } : null,
    createdAt: o.createdAt.toISOString(),
  };
}

export const statusRank = (s: OrderStatus) => STATUS_ORDER.indexOf(s);
