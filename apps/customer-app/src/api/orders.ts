import { api } from "./http";

export type Charge = { type: string; label: string; amount: number };
export type Pricing = { subtotal: number; discount: number; charges: Charge[]; tax: number; total: number; taxInclusive: boolean };
export type Eta = { packMinutes: number; riderArrivalMinutes: number; travelMinutes: number; extraMinutes: number; promisedAt: string };
export type Quote = {
  id: string; expiresAt: string; zoneId: string; split: boolean;
  allocation: { warehouseId: string; warehouseName: string; lines: { name: string; variantLabel: string; qty: number; lineTotal: number }[]; itemsSubtotal: number; eta: Eta }[];
  pricing: Pricing;
  payment: { codAllowed: boolean; codMaxAmount?: number; onlineAllowed: boolean };
};
export type PaymentMethod = "cod" | "online";

export const createQuote = (input: { addressId: string; paymentMethod: PaymentMethod; tipAmount: number; acceptZoneChange?: boolean; couponCode?: string | null; scheduledWindow?: { start: string; end: string } | null }) =>
  api<Quote>("POST", "/quotes", { ...input, scheduledWindow: input.scheduledWindow ?? null, acceptZoneChange: !!input.acceptZoneChange }).then(r => r.data);

export type TipOptions = { enabled: boolean; presets: number[]; max: number };
export const getTipOptions = (zoneId: string) => api<TipOptions>("GET", `/tips/options?zoneId=${zoneId}`, undefined, { auth: false }).then(r => r.data);

export type OrderItem = { productId: string; variantId: string; name: string; variantLabel: string; unitPrice: number; qty: number; lineTotal: number; status?: string; imageUrl?: string | null };
export type ChildOrder = {
  id: string; orderNo: string; status: string; paymentStatus?: string; refundStatus?: string; items?: OrderItem[]; itemsSubtotal?: number;
  promisedAt?: string | null; amountDue?: number; rider?: { name: string; phone: string } | null; timeline?: { status: string; at: string }[];
};
export type OrderGroup = {
  id: string; groupNo: string; status: string; paymentMethod: PaymentMethod; paymentStatus: string; pricing: Pricing;
  address: { line1: string; landmark: string; locality: string; pincode: string; contactName: string }; deliveryOtp?: string; children: ChildOrder[]; createdAt: string;
};
export type PlaceResult = { group: OrderGroup; payment: { razorpayKeyId: string; razorpayOrderId: string; amount: number; currency: string; expiresAt: string } | null };

/** Places the order from a quote. The same Idempotency-Key must be reused for retries of the same quote, so a double tap never orders twice. */
export const placeOrder = (input: { quoteId: string; paymentMethod: PaymentMethod; deliveryNotes?: string | null }, key: string): Promise<PlaceResult> =>
  api<PlaceResult | OrderGroup>("POST", "/orders", input, { headers: { "Idempotency-Key": key } })
    .then(r => ("group" in (r.data as object) ? (r.data as PlaceResult) : { group: r.data as OrderGroup, payment: null }));

export const getOrderGroup = (id: string) => api<OrderGroup>("GET", `/order-groups/${id}`).then(r => r.data);

/** A random v4-style id for Idempotency-Key. */
export const newKey = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });

/** Friendly text for the errors a quote or an order can return. */
export const checkoutMessage = (code?: string, details?: Record<string, unknown>, fallback = "Something went wrong. Please try again."): string => {
  switch (code) {
    case "OUT_OF_ZONE": return "We don't deliver to this address yet. Choose another one.";
    case "ZONE_PAUSED": return "Deliveries to your area are paused for a little while.";
    case "STORE_CLOSED": return "The store is closed right now.";
    case "MIN_ORDER_NOT_MET": return `The minimum order is ₹${Math.round(Number(details?.minOrder ?? 0) / 100)}. Add a few more items.`;
    case "ITEM_UNAVAILABLE": case "INSUFFICIENT_STOCK": return "Some items just sold out. Go back to the cart to adjust.";
    case "COD_NOT_ALLOWED": return "Cash on delivery isn't available for this order.";
    case "COUPON_INVALID": return "That coupon can't be used on this order.";
    case "QUOTE_EXPIRED": return "Your prices expired. We refreshed them, please check and place the order again.";
    default: return fallback;
  }
};

/** One row of the Orders list. */
export type OrderSummary = { groupId: string; groupNo: string; status: string; total: number; createdAt: string; children: { id: string; orderNo: string; status: string; itemCount: number; promisedAt?: string | null }[] };
export const listOrders = (status: "active" | "past", cursor?: string | null) =>
  api<OrderSummary[]>("GET", `/orders?status=${status}&limit=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
    .then(r => ({ items: r.data, nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null }));

export type ReorderResult = {
  cart: { items: { productId: string; variantId: string; qty: number; name: string; variantLabel: string; unitPrice: number; maxQty: number; available: boolean; imageUrl?: string | null }[] };
  corrections: { productId: string; variantId: string; reason: string; qty: number }[];
};
/** Puts a past order's items back in the server cart at today's prices and stock. Nothing is ordered. */
export const reorder = (childId: string) => api<ReorderResult>("POST", `/orders/${childId}/reorder`).then(r => r.data);

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "blue" | "maroon" }> = {
  PENDING_PAYMENT: { label: "Waiting for payment", tone: "amber" },
  PLACED: { label: "Order placed", tone: "blue" },
  CONFIRMED: { label: "Confirmed", tone: "blue" },
  PACKING: { label: "Packing", tone: "blue" },
  READY: { label: "Ready for pickup", tone: "blue" },
  ASSIGNED: { label: "Partner assigned", tone: "blue" },
  PICKED_UP: { label: "Picked up", tone: "blue" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", tone: "amber" },
  ARRIVED: { label: "Arrived", tone: "amber" },
  DELIVERED: { label: "Delivered", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
  FAILED_DELIVERY: { label: "Delivery failed", tone: "red" },
  ACTIVE: { label: "In progress", tone: "blue" },
  PARTIAL: { label: "Partly delivered", tone: "amber" },
};
export const statusInfo = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, " ").toLowerCase(), tone: "maroon" as const };
export const isActiveStatus = (s: string) => !["DELIVERED", "CANCELLED", "FAILED_DELIVERY", "PARTIAL"].includes(s);

/** The five steps a customer cares about; PICKED_UP and ARRIVED count towards "Out for delivery". */
export const STEPS = [
  { key: "PLACED", label: "Order placed", match: ["PLACED"] },
  { key: "CONFIRMED", label: "Confirmed", match: ["CONFIRMED"] },
  { key: "PACKING", label: "Packing your order", match: ["PACKING", "READY", "ASSIGNED"] },
  { key: "OUT_FOR_DELIVERY", label: "Out for delivery", match: ["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"] },
  { key: "DELIVERED", label: "Delivered", match: ["DELIVERED"] },
];
/** The time each step was first reached, or null. */
export const stepTimes = (timeline: { status: string; at: string }[] = []) => STEPS.map(st => timeline.find(t => st.match.includes(t.status))?.at ?? null);

export type Tracking = {
  orderId: string; orderNo: string; status: string;
  eta: { promisedAt: string | null; liveEtaMinutes: number | null; liveEtaAt: string | null; updatedAt: string | null };
  /** null until the order is picked up; `location` only from PICKED_UP to ARRIVED. */
  rider: { name: string; phone: string; location?: { lat: number; lng: number } | null; lastLocationAt?: string | null } | null;
  timeline: { status: string; at: string }[];
  group: { groupNo: string; children: { id: string; orderNo: string; status: string; promisedAt?: string | null }[] };
  deliveryOtp: string | null;
};
export const getTracking = (orderId: string) => api<Tracking>("GET", `/orders/${orderId}/tracking`).then(r => r.data);

/** What to tell the customer for each status, in plain words. */
export const trackingHeadline = (status: string): { title: string; sub: string } => {
  switch (status) {
    case "PENDING_PAYMENT": return { title: "Waiting for payment", sub: "We'll start packing once it goes through." };
    case "PLACED": case "CONFIRMED": return { title: "Order confirmed", sub: "The store has your order." };
    case "PACKING": return { title: "Packing your order", sub: "Your items are being picked and packed." };
    case "READY": case "ASSIGNED": return { title: "Ready for pickup", sub: "A delivery partner is on the way to the store." };
    case "PICKED_UP": case "OUT_FOR_DELIVERY": return { title: "On the way", sub: "Your delivery partner is heading to you." };
    case "ARRIVED": return { title: "Arrived at your door", sub: "Share your delivery code with the partner." };
    case "DELIVERED": return { title: "Delivered", sub: "Enjoy your order!" };
    case "CANCELLED": return { title: "Order cancelled", sub: "This order was cancelled." };
    case "FAILED_DELIVERY": return { title: "Delivery failed", sub: "We couldn't deliver this order." };
    default: return { title: statusInfo(status).label, sub: "" };
  }
};
/** How often to ask the server: every 10 s while the rider is out, every 30 s before that. */
export const pollMs = (status: string) => (["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"].includes(status) ? 10_000 : 30_000);
