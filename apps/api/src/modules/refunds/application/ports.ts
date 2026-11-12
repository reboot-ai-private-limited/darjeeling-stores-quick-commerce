import type { Refund, RefundStatus } from "../domain/refund.js";

export class DuplicateRefundError extends Error { constructor(readonly existing: Refund | null) { super("Duplicate refund"); } }

export interface RefundStore {
  ensureIndexes(): Promise<void>;
  insert(refund: Refund): Promise<void>;
  get(id: string): Promise<Refund | null>;
  byKey(key: string): Promise<Refund | null>;
  forOrder(orderId: string): Promise<Refund[]>;
  listForUser(userId: string, limit: number, beforeId?: string): Promise<Refund[]>;
  list(filter: { status?: RefundStatus; source?: string; warehouseIds?: readonly string[]; from?: Date; to?: Date }, limit: number, beforeId?: string): Promise<Refund[]>;
  pendingCount(warehouseIds?: readonly string[]): Promise<number>;
  /** Moves a refund on only if it is still in one of the given statuses. False when someone else got there first. */
  decide(id: string, from: readonly RefundStatus[], patch: Partial<Refund>): Promise<boolean>;
}

/** The orders module, as refunds see it. */
export interface OrderAccess {
  get(orderId: string): Promise<{
    id: string; orderNo: string; groupId: string; userId: string; warehouseId: string; status: string; paymentMethod: "cod" | "online"; paymentStatus: string;
    items: { productId: string; name: string; unitPrice: number; qty: number; status: string }[]; itemsSubtotal: number; allocatedDiscount: number;
    allocatedCharges: { amount: number }[]; deliveredAt: Date | null; customerName: string; customerPhone: string;
  } | null>;
  setRefundStatus(orderId: string, status: "none" | "pending" | "done"): Promise<void>;
  customerCancel(userId: string, orderId: string, reason: string): Promise<unknown>;
}
export interface RefundMedia { claim(input: { mediaId: string; userId: string; orderId: string }): Promise<void> }
/** Whether an item may be refunded after delivery for this reason. A non-returnable item is still refunded when it arrived damaged or missing. */
export interface Eligibility { eligible(productId: string, reason: "damaged_item" | "missing_item" | "other"): Promise<boolean> }
export interface RefundNotifier {
  approved(userId: string, refund: Refund): Promise<void>;
  rejected(userId: string, refund: Refund): Promise<void>;
  done(userId: string, refund: Refund): Promise<void>;
}

export interface RefundSettings { refundWindowHours: number; refundPhotoRequired: boolean; maxPhotos: number }
export const DEFAULT_REFUND_SETTINGS: RefundSettings = { refundWindowHours: 24, refundPhotoRequired: true, maxPhotos: 3 };

export interface RefundDeps {
  store: RefundStore; orders: OrderAccess; media: RefundMedia; eligibility: Eligibility; notifier: RefundNotifier; settings: RefundSettings; now: () => Date; newId: () => string;
}
