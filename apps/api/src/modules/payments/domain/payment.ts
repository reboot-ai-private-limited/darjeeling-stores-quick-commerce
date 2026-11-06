import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentMethod = "razorpay" | "cod" | "razorpay_link";
export type PaymentStatus = "created" | "authorized" | "captured" | "failed" | "cod_pending" | "cod_collected";

export interface Payment {
  id: string; groupId: string; userId: string; method: PaymentMethod; amount: number; status: PaymentStatus; attempt: number;
  razorpayOrderId: string | null; razorpayPaymentId: string | null; razorpayLinkId: string | null; linkUrl: string | null; signatureVerified: boolean;
  failureReason: string | null; flag: "amount_mismatch" | "late_payment" | "overpaid" | null; expiresAt: Date | null; capturedAt: Date | null; createdAt: Date; updatedAt: Date;
}
export interface PaymentEvent {
  id: string; eventId: string; type: string; razorpayOrderId: string | null; razorpayPaymentId: string | null; amount: number | null; result: string; at: Date;
}
export interface Mismatch { type: "missing_in_db" | "missing_in_provider" | "amount_mismatch" | "status_mismatch"; razorpayPaymentId?: string; paymentId?: string; amount?: number; expected?: number; actual?: number }
export interface Reconciliation { id: string; date: string; matched: number; mismatches: Mismatch[]; createdAt: Date }
export interface ProviderCapture { paymentId: string; orderId: string | null; amount: number; status: string }

export const paymentView = (p: Payment) => ({
  id: p.id, groupId: p.groupId, method: p.method, amount: p.amount, status: p.status, razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId,
  signatureVerified: p.signatureVerified, failureReason: p.failureReason, capturedAt: p.capturedAt?.toISOString() ?? null,
  ...(p.flag && { flag: p.flag }),
});

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** Razorpay's checkout signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export const checkoutSignature = (orderId: string, paymentId: string, secret: string) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
export const verifyCheckout = (orderId: string, paymentId: string, signature: string, secret: string) => safeEqual(checkoutSignature(orderId, paymentId, secret), signature);
/** Razorpay's webhook signature: HMAC-SHA256 of the raw body with the webhook secret. */
export const verifyWebhook = (rawBody: Buffer | undefined, signature: string | undefined, secret: string) =>
  Boolean(rawBody && signature && safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), signature));

/** What the app shows while it waits: where the group stands, from the customer's side. */
export type PaymentState = "awaiting_payment" | "confirming" | "confirmed" | "failed" | "expired";
