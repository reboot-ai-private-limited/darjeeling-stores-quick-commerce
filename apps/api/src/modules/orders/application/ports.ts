import type { Geography } from "../../../platform/geography.js";
import type { AuditEvent } from "../../audit/audit.public.js";
import type { Order, OrderEvent, OrderGroup, OrderStatus } from "../domain/order.js";

/** The order group already exists for this customer and idempotency key. */
export class DuplicateGroupError extends Error {}
/** The order was no longer in the status the change expected (someone else changed it first). */
export class StaleOrderError extends Error {}

export interface OrderFilter {
  warehouseIds?: readonly string[]; statuses?: readonly OrderStatus[]; paymentStatus?: string; riderIds?: readonly string[]; q?: string; from?: Date; to?: Date;
  preOrder?: boolean; flagged?: boolean; userId?: string; ids?: readonly string[]; windowFrom?: Date; windowTo?: Date; windowStart?: Date;
}
export interface Change { seq: number; orderId: string; warehouseId: string; event: "created" | "status_changed" | "assigned" | "ack_changed" | "updated"; at: Date }

export interface OrderStore {
  ensureIndexes(): Promise<void>;
  nextGroupNumber(): Promise<number>;
  /** Creates a group, its children and their first events, and the change feed entries, in one transaction. */
  insertGroup(group: OrderGroup, children: Order[], events: OrderEvent[]): Promise<void>;
  findGroupByKey(userId: string, key: string): Promise<OrderGroup | null>;
  getGroup(id: string): Promise<OrderGroup | null>;
  countGroupsOf(userId: string): Promise<number>;
  updateGroup(id: string, patch: Partial<OrderGroup>): Promise<void>;
  /** `live` true: groups with an order still in progress; false: groups where every order has ended. */
  listGroupsOf(userId: string, filter: { live?: boolean }, limit: number, beforeId?: string): Promise<OrderGroup[]>;
  getOrder(id: string): Promise<Order | null>;
  getOrders(ids: readonly string[]): Promise<Order[]>;
  childrenOf(groupId: string): Promise<Order[]>;
  listOrders(filter: OrderFilter, limit: number, beforeId?: string): Promise<Order[]>;
  listByStatus(status: OrderStatus, limit: number): Promise<Order[]>;
  /** Moves the order on only if it is still in `from`; the event and change entry go in the same transaction. Throws StaleOrderError if not. */
  transition(orderId: string, from: OrderStatus, patch: Partial<Order>, event: OrderEvent, audit?: AuditEvent): Promise<Order>;
  /** Changes fields of an order that does not change its status. `where` makes it conditional on the order's current values. */
  patch(orderId: string, patch: Partial<Order>, event?: OrderEvent, where?: Partial<Pick<Order, "status" | "rev">>, audit?: AuditEvent): Promise<Order | null>;
  addEvent(event: OrderEvent): Promise<void>;
  eventsOf(orderId: string): Promise<OrderEvent[]>;
  addNote(orderId: string, note: Order["notes"][number], event: OrderEvent): Promise<void>;
  changesSince(seq: number, filter: { warehouseIds?: readonly string[]; statuses?: readonly OrderStatus[] }, limit: number): Promise<Change[]>;
  latestChange(): Promise<number>;
  recordChange(change: Omit<Change, "seq">): Promise<void>;
  /** Counts a wrong delivery code for the group. Returns the number of wrong tries so far. */
  countWrongOtp(groupId: string): Promise<number>;
  recordAudit(entry: AuditEvent): Promise<void>;
}

export interface QuoteSource {
  get(userId: string, quoteId: string): Promise<{
    id: string; userId: string; addressId: string; zoneId: string; paymentMethod: "cod" | "online"; couponCode: string | null; couponId: string | null;
    scheduledWindow: { start: Date; end: Date } | null; usedByGroupId: string | null;
    pricing: OrderGroup["pricing"]; payment: { codAllowed: boolean };
    allocation: {
      warehouseId: string; lines: { productId: string; variantId: string; name: string; variantLabel: string; weightGrams: number; qty: number; unitPrice: number; lineTotal: number }[];
      itemsSubtotal: number; eta: { packMinutes: number; riderArrivalMinutes: number; travelMinutes: number; extraMinutes: number; promisedAt: Date };
      allocatedDiscount: number; allocatedCharges: { type: string; label: string; amount: number }[];
    }[];
  }>;
  /** Works the quote out again as it would be now. `changed` carries the new quote when something differs. */
  revalidate(userId: string, quoteId: string): Promise<{ changed: false } | { changed: true; quote: unknown }>;
  claim(quoteId: string, groupId: string): Promise<string>;
  clearCart(userId: string): Promise<void>;
}
/** Puts a past order's items back into the customer's cart (F10). */
export interface CartPort { reorder(userId: string, items: { productId: string; variantId: string; qty: number }[]): Promise<{ cart: unknown; corrections: unknown[] }> }
export interface AddressSource {
  forOrder(userId: string, addressId: string): Promise<{
    id: string; label: string; line1: string; localityName: string; pincode: string; landmark: string; contactName: string; contactPhone: string; cityId: string;
    location: { lat: number; lng: number }; locationAccuracyM: number | null; deliveryNotes: string | null; voiceMediaId: string | null; voiceDurationSec: number | null; housePhotoMediaId: string | null;
  } | null>;
}
export interface StockPort {
  reserve(input: { key: string; lines: readonly { warehouseId: string; productId: string; variantId: string; qty: number }[]; holdSeconds?: number }): Promise<
    { ok: true; replay: boolean } | { ok: false; shortages: { warehouseId: string; productId: string; variantId: string; requested: number; available: number; reason: string }[] }>;
  confirm(key: string): Promise<unknown>;
  release(key: string, why: "cancel" | "expired" | "payment_failed"): Promise<{ released: boolean }>;
  restore(input: { key: string; restoreKey: string; reason: "cancel" | "return"; lines: readonly { warehouseId: string; productId: string; variantId: string; qty: number }[] }): Promise<{ applied: boolean }>;
}
export interface CouponPort {
  hold(userId: string, couponId: string, groupId: string, discountAmount: number): Promise<boolean>;
  release(groupId: string): Promise<boolean>;
}
export interface OrderMedia {
  /** Copies the address voice note or photo onto the order. Null when the file is gone. */
  copyToOrder(input: { sourceMediaId: string; orderId: string }): Promise<{ mediaId: string } | null>;
  /** Marks the order's media for deletion some days after the order ends. */
  scheduleDeletion(orderId: string, endedAt: Date): Promise<void>;
  /** Whether the media file has been removed. */
  isExpired(mediaId: string): Promise<boolean>;
}
export interface Riders {
  riderOf(orderId: string): Promise<{ id: string; name: string; phone: string } | null>;
  /** The orders a rider is working now. */
  ordersOf(riderId: string): Promise<string[]>;
}
/** What the orders module asks of refunds and payments (F15, F16). Until they exist nothing is refunded. */
export interface MoneyPort {
  /** An order was cancelled or lost items: refund what was paid. */
  refund(input: { order: Order; group: OrderGroup; amount: number; reason: string; kind: "cancel" | "item_removed" | "failed_delivery" | "overpaid" | "late_payment"; key: string; by: { userId: string | null; role: string } }): Promise<{ id: string; amount: number } | null>;
  /** The online payment for a new online group (F15): the data to open the checkout, or null for cash. */
  startPayment(group: OrderGroup): Promise<unknown>;
}
export interface OrderNotifier {
  placed(userId: string, group: OrderGroup, orderNos: string[]): Promise<void>;
  confirmed(userId: string, order: Order): Promise<void>;
  itemUnavailable(userId: string, order: Order, itemName: string): Promise<void>;
  cancelled(userId: string, order: Order, reason: string): Promise<void>;
  newOrder(warehouseId: string, order: Order): Promise<void>;
}
/** Dispatch is told when an order is cancelled so its rider is released. */
export interface DispatchHooks { cancelled(orderId: string): Promise<void>; paid(orderId: string): Promise<void> }
export interface HoursPolicy {
  /** The status new orders in this warehouse start in after payment (manual means an admin confirms). */
  confirmMode(warehouseId: string): Promise<"auto" | "manual">;
}
/** Places in pre-order slots (F17). */
export interface SlotPort {
  hold(orderId: string, warehouseId: string, window: { start: Date; end: Date }): Promise<void>;
  release(orderId: string): Promise<void>;
}
export interface AdminNames { nameOf(userId: string): Promise<string | null> }

export interface OrderSettings {
  /** Cash orders are confirmed at once ("auto") or wait for an admin ("manual"). */
  confirmMode: "auto" | "manual";
  /** Online orders wait this long for payment before they are cancelled. */
  paymentWindowMinutes: number;
  slaMinutes: { confirm: number; pack: number; assign: number };
  trackingBaseUrl: string | null;
  /** The key that locks delivery codes at rest (32 bytes, hex). */
  otpKeyHex: string | null;
  otpMaxTries: number;
  /** A customer may cancel up to this status. */
  customerCancelUntil: "PLACED" | "CONFIRMED";
}
export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  confirmMode: "auto", paymentWindowMinutes: 15, slaMinutes: { confirm: 5, pack: 15, assign: 5 }, trackingBaseUrl: null, otpKeyHex: null, otpMaxTries: 5, customerCancelUntil: "CONFIRMED",
};

export interface OrderDeps {
  store: OrderStore; quotes: QuoteSource; carts: CartPort; addresses: AddressSource; stock: StockPort; coupons: CouponPort; media: OrderMedia; riders: Riders; money: MoneyPort;
  notifier: OrderNotifier; dispatch: DispatchHooks; slots: SlotPort; geography: Geography; link: (orderId: string) => { token: string; expiresAt: Date } | null;
  settings: OrderSettings; now: () => Date; newId: () => string;
}
