export type ConflictReason =
  | "otp_mismatch" | "order_cancelled" | "reassigned" | "already_delivered" | "invalid_transition" | "already_paid_online" | "not_assigned_to_you";
export type ReviewFlag = "otp_mismatch" | "far_from_address" | "time_skew";

export interface SyncSettings {
  /** An offline delivery further than this from the address is flagged (never refused). */
  geofenceMeters: number;
  otpIterations: number; otpAttempts: number;
  /** A device clock this far ahead of the server is flagged. */
  maxClockSkewMinutes: number;
  /** The doorstep QR for UPI. Without a VPA the bundle has no QR details. */
  upi: { vpa: string; payeeName: string } | null;
}
export const DEFAULT_SYNC_SETTINGS: SyncSettings = { geofenceMeters: 300, otpIterations: 100_000, otpAttempts: 5, maxClockSkewMinutes: 5, upi: null };

export const MESSAGES: Record<ConflictReason, string> = {
  otp_mismatch: "The OTP did not match. An admin will review this delivery.",
  order_cancelled: "This order was cancelled.",
  reassigned: "This order was moved to another rider.",
  already_delivered: "This order was already delivered.",
  invalid_transition: "This step could not be applied to the order as it stands.",
  already_paid_online: "The customer had already paid online. Your collection is recorded and the customer will be refunded.",
  not_assigned_to_you: "This order is not assigned to you.",
};

export interface Review {
  id: string; orderId: string; orderNo: string; riderId: string; riderName: string; warehouseId: string;
  deliveredAt: Date; syncedAt: Date; flags: ReviewFlag[]; distanceFromAddressM: number | null; amountDue: number;
  collection: { method: string; amount: number } | null;
  /** The code did not match, so the order was NOT marked delivered; accepting the review completes it. */
  deliveryPending: boolean; otpCheckedLocally: boolean;
  status: "open" | "resolved"; outcome: "accepted" | "rejected" | null; note: string | null; resolvedBy: string | null; resolvedAt: Date | null;
}

export const reviewView = (r: Review) => ({
  orderId: r.orderId, orderNo: r.orderNo, riderName: r.riderName, deliveredAt: r.deliveredAt.toISOString(), syncedAt: r.syncedAt.toISOString(),
  flags: r.flags, distanceFromAddressM: r.distanceFromAddressM, amountDue: r.amountDue, collection: r.collection, deliveryPending: r.deliveryPending,
  reviewStatus: r.status,
  ...(r.status === "resolved" && { outcome: r.outcome, note: r.note, resolvedAt: r.resolvedAt?.toISOString() ?? null }),
});
