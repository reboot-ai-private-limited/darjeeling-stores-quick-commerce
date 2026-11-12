import { apiFetch } from "./api";

// ----------------- Refunds, notify-me & notification preferences -----------------

export type Refund = {
  id: string;
  orderNo: string;
  amount: number;
  reason: string;
  status: "requested" | "approved" | "done" | "rejected";
  customerNote: string | null;
  rejectReason: string | null;
  method: string | null;
  createdAt: string;
  markedDoneAt: string | null;
};

export const REFUND_REASON: Record<string, string> = {
  cancelled: "Order cancelled",
  item_unavailable: "Item unavailable",
  late_payment: "Late payment",
  damaged_item: "Damaged item",
  missing_item: "Missing item",
  overpaid: "Overpaid",
  other: "Other",
};

export const listRefunds = () => apiFetch<Refund[]>("GET", "/refunds");

export type NotifySub = {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  channels: string[];
  createdAt: string;
};

export const listNotifyMe = () => apiFetch<NotifySub[]>("GET", "/notify-me");
export const cancelNotifyMe = async (id: string): Promise<void> => {
  await apiFetch("DELETE", `/notify-me/${encodeURIComponent(id)}`);
};

export type NotifPrefs = { promoPush: boolean; promoWhatsApp: boolean; cartReminders: boolean };
export const getNotifPrefs = () => apiFetch<NotifPrefs>("GET", "/me/notification-prefs");
export const saveNotifPrefs = (p: Partial<NotifPrefs>) => apiFetch<NotifPrefs>("PUT", "/me/notification-prefs", p);

// ----------------- Coupons (same endpoints and shapes as the app) -----------------

export type CouponOffer = {
  code: string;
  type: "flat" | "percent" | "free_delivery";
  description: string;
  value: number;
  minOrder: number;
  applicable: boolean;
  reason: string | null;
};

export const COUPON_WHY: Record<string, string> = {
  min_order: "Add more items to use this",
  first_order_only: "For first orders only",
  limit_reached: "Offer limit reached",
  expired: "This offer has expired",
  not_applicable: "Not valid for this cart",
};

export const listCouponOffers = (zoneId: string, subtotal: number) =>
  apiFetch<CouponOffer[]>("GET", `/coupons/available?zoneId=${encodeURIComponent(zoneId)}${subtotal ? `&subtotal=${subtotal}` : ""}`);

export const applyCouponRemote = (code: string) =>
  apiFetch<{ coupon: { code: string; type: string; description: string } }>("POST", "/cart/coupon", { code: code.trim().toUpperCase() }).then((r) => r.coupon);

/** The coupon on the server cart, if any. */
export const appliedCouponRemote = () => apiFetch<{ couponCode?: string | null }>("GET", "/cart").then((c) => c.couponCode ?? null);

export const removeCouponRemote = async (): Promise<void> => {
  await apiFetch("DELETE", "/cart/coupon");
};
