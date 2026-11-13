import type { Payment, PaymentEvent, ProviderCapture, Reconciliation } from "../domain/payment.js";

export class DuplicateEventError extends Error {}

export interface PaymentStore {
  ensureIndexes(): Promise<void>;
  insert(payment: Payment): Promise<void>;
  get(id: string): Promise<Payment | null>;
  byRazorpayOrder(orderId: string): Promise<Payment | null>;
  byLink(linkId: string): Promise<Payment | null>;
  forGroup(groupId: string): Promise<Payment[]>;
  list(filter: { status?: string; method?: string; groupIds?: readonly string[]; from?: Date; to?: Date }, limit: number, beforeId?: string): Promise<Payment[]>;
  update(id: string, patch: Partial<Payment>): Promise<void>;
  /** Marks a payment captured once. False when it already was. */
  capture(id: string, patch: Partial<Payment>): Promise<boolean>;
  /** Records a provider event once. Throws DuplicateEventError if it was seen before. */
  recordEvent(event: PaymentEvent): Promise<void>;
  setEventResult(eventId: string, result: string): Promise<void>;
  lastEvent(paymentOrderId: string | null, paymentId: string | null): Promise<PaymentEvent | null>;
  capturedBetween(from: Date, to: Date): Promise<Payment[]>;
  saveReconciliation(r: Reconciliation): Promise<void>;
  latestReconciliation(date: string): Promise<Reconciliation | null>;
}

/** Razorpay, or a stand-in in tests (F15). */
export interface PaymentProvider {
  keyId: string;
  createOrder(input: { amount: number; receipt: string; notes?: Record<string, string> }): Promise<{ id: string }>;
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhook(rawBody: Buffer | undefined, signature: string | undefined): boolean;
  createPaymentLink(input: { amount: number; reference: string; description: string; expiresAt: Date; customer: { name: string; phone: string } }): Promise<{ id: string; url: string; upiIntentUrl: string | null }>;
  capturesOn(from: Date, to: Date): Promise<ProviderCapture[]>;
  /** Sends money back to the customer's original payment method. `key` makes a repeated call a single refund. */
  refund(input: { paymentId: string; amount: number; key: string; notes?: Record<string, string> }): Promise<{ id: string }>;
}

export interface GroupAccess {
  get(groupId: string): Promise<{
    id: string; groupNo: string; userId: string; paymentMethod: "cod" | "online"; paymentStatus: string; total: number; expiresAt: Date | null; customerName: string; customerPhone: string;
    children: { id: string; orderNo: string; status: string; amountDue: number; collectionRecorded: boolean; warehouseId: string }[];
  } | null>;
  groupOfOrder(orderId: string): Promise<string | null>;
  idByNo(groupNo: string): Promise<string | null>;
  markPaid(groupId: string, info: { paymentId: string }): Promise<{ changed: boolean }>;
  markCodPaid(groupId: string, info: { paymentId: string }): Promise<{ changed: boolean }>;
  expireOverdue(limit?: number): Promise<number>;
}
/** A refund for money that arrived when it should not have (F16). */
export interface LateRefunds { refund(input: { groupId: string; amount: number; reason: string; kind: "late_payment" | "overpaid"; key: string }): Promise<void> }
export interface PaymentNotifier { adminAlert(message: string, data: Record<string, string>): Promise<void> }

export interface PaymentSettings { currency: string; payLinkMinutes: number; upiPayee: string | null }
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = { currency: "INR", payLinkMinutes: 120, upiPayee: null };

export interface PaymentDeps {
  store: PaymentStore; provider: PaymentProvider; groups: GroupAccess; refunds: LateRefunds; notifier: PaymentNotifier; settings: PaymentSettings; now: () => Date; newId: () => string;
}
