import { api } from "./http";

export type NotifPrefs = { promoPush: boolean; promoWhatsApp: boolean; cartReminders: boolean };
export const getPrefs = () => api<NotifPrefs>("GET", "/me/notification-prefs").then(r => r.data);
export const savePrefs = (p: Partial<NotifPrefs>) => api<NotifPrefs>("PUT", "/me/notification-prefs", p).then(r => r.data);

export const requestPhoneChange = (phone: string) => api("POST", "/me/phone/request-otp", { phone });
export const verifyPhoneChange = (phone: string, otp: string) => api("POST", "/me/phone/verify", { phone, otp });
export const requestDeletion = (reason?: string) => api("POST", "/me/delete-request", reason ? { reason } : {});

export type NotifySub = { id: string; productId: string; variantId: string | null; name: string; variantLabel: string | null; channels: string[]; createdAt: string };
export const listNotifyMe = () => api<NotifySub[]>("GET", "/notify-me").then(r => r.data);
export const cancelNotifyMe = (id: string) => api("DELETE", `/notify-me/${id}`);

export type CouponRow = { code: string; type: "flat" | "percent" | "free_delivery"; description: string; value: number; minOrder: number; applicable: boolean; reason: string | null };
export const listCoupons = (zoneId: string, subtotal?: number) =>
  api<CouponRow[]>("GET", `/coupons/available?zoneId=${zoneId}${subtotal ? `&subtotal=${subtotal}` : ""}`).then(r => r.data);
export const applyCoupon = (code: string) => api("POST", "/cart/coupon", { code: code.trim().toUpperCase() });
export const removeCoupon = () => api("DELETE", "/cart/coupon");
export const COUPON_WHY: Record<string, string> = {
  min_order: "Add more items to use this", first_order_only: "For first orders only", limit_reached: "Offer limit reached", expired: "This offer has expired", not_applicable: "Not valid for this cart",
};

export type Refund = {
  id: string; orderNo: string; amount: number; reason: string; status: "requested" | "approved" | "done" | "rejected";
  customerNote: string | null; rejectReason: string | null; method: string | null; createdAt: string; markedDoneAt: string | null;
};
export const listRefunds = () => api<Refund[]>("GET", "/refunds").then(r => r.data);
export const REFUND_REASON: Record<string, string> = {
  cancelled: "Order cancelled", item_unavailable: "Item unavailable", late_payment: "Late payment", damaged_item: "Damaged item", missing_item: "Missing item", overpaid: "Overpaid", other: "Other",
};

export const cancelOrder = (orderId: string, reason: string) =>
  api<{ order: { status: string }; refund: { amount: number } | null; deliveryFeeRefunded: boolean }>("POST", `/orders/${orderId}/cancel`, { reason }).then(r => r.data);
export const requestRefund = (orderId: string, body: { reason: string; items: { orderItemIndex: number; qty: number }[]; customerNote?: string; photoMediaIds?: string[] }) =>
  api<Refund>("POST", `/orders/${orderId}/refund-request`, body).then(r => r.data);

/** Friendly text for cancel and refund-request errors; empty when the code isn't one we know. */
export const refundMessage = (code?: string, reason?: unknown): string => {
  if (code === "ORDER_NOT_CANCELLABLE") return "This order is already being packed, so it can't be cancelled now.";
  if (code === "REFUND_NOT_ALLOWED") {
    const m: Record<string, string> = {
      window_expired: "The refund window for this order has passed.", category_not_eligible: "These items aren't eligible for a refund.",
      photo_required: "A photo is required for this refund. Please contact support.", not_delivered: "You can ask for a refund after the order is delivered.",
    };
    return m[String(reason)] ?? "A refund can't be requested for this order.";
  }
  if (code === "CONFLICT") return "You've already asked for a refund on this item.";
  return "";
};
