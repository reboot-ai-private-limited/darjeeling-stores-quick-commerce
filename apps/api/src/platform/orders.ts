/**
 * Orders as dispatch and delivery need them (F13, F14). Dev 1 owns the real orders module and its one state machine; Dev 2's
 * rider and dispatch code reads orders and asks for status changes only through this interface, so it can be built and tested
 * before the real module exists. Delivery never writes order fields itself.
 */
export type OrderStatus =
  | "PENDING_PAYMENT" | "PLACED" | "CONFIRMED" | "PACKING" | "READY" | "ASSIGNED" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "ARRIVED"
  | "DELIVERED" | "FAILED_DELIVERY" | "CANCELLED";

export interface DeliveryOrder {
  id: string; orderNo: string; groupId: string; status: OrderStatus;
  /** Of the whole group: ACTIVE, DELIVERED, PARTIAL, CANCELLED... */
  groupStatus: string;
  zoneId: string; warehouseId: string;
  customer: { name: string; phone: string };
  items: { name: string; variantLabel: string; qty: number; status: "ok" | "unavailable" | "reduced" }[];
  itemCount: number; bagCount: number | null;
  address: { line1: string; landmark: string; locality: string; location: { lat: number; lng: number }; locationAccuracyM: number | null; deliveryNotes: string | null };
  voiceNote: { mediaId: string; durationSec: number | null; expired: boolean } | null;
  housePhoto: { mediaId: string } | null;
  paymentMethod: "cod" | "online"; paymentStatus: string; amountDue: number;
  /** Paid online already: the rider must not collect. */
  alreadyPaid: boolean;
  /** A cash or UPI collection has been recorded (F22). Cash on delivery needs one before the order can be delivered. */
  collectionRecorded: boolean; collectionMethod: "cash" | "upi" | null; deliveredOffline: boolean;
  /** The customer must read a delivery code to the rider. */
  otpRequired: boolean;
  promisedAt: Date; readyAt: Date | null; deliveredAt: Date | null;
}

/** Who asked for a change: a rider, an admin or the system. */
export interface OrderActor { kind: "rider" | "admin" | "system"; id: string }

export type TransitionResult = { ok: true; order: DeliveryOrder } | { ok: false; reason: "not_found" | "invalid_transition"; from?: OrderStatus };

export interface OrdersPort {
  get(orderId: string): Promise<DeliveryOrder | null>;
  getMany(orderIds: readonly string[]): Promise<DeliveryOrder[]>;
  /** The orders (children) of one checkout. */
  childrenOf(groupId: string): Promise<DeliveryOrder[]>;
  /** Orders in a status, oldest first, for the dispatch board. */
  listByStatus(status: OrderStatus, limit: number): Promise<DeliveryOrder[]>;
  /** Moves an order to a new status through the state machine. A move the machine does not allow comes back as `invalid_transition`. */
  transition(orderId: string, to: OrderStatus, by: OrderActor, details?: Record<string, unknown>): Promise<TransitionResult>;
  /** Writes an entry to the order's timeline without changing its status (for example a hand-over between riders). */
  recordEvent(orderId: string, type: string, by: OrderActor, details?: Record<string, unknown>): Promise<void>;
  /** Checks the delivery code the customer read out. Counts wrong tries and locks after too many. */
  verifyDeliveryOtp(orderId: string, otp: string): Promise<{ valid: true } | { valid: false; attemptsLeft: number | null; locked: boolean }>;
  /**
   * For a failed delivery the admin gives up on: cancels the order, sends good goods back to stock (or writes spoiled goods off)
   * and refunds a prepaid order. Dev 1 does the stock and refund calls.
   */
  cancelFailedAndReturn(orderId: string, input: { goodsCondition: "good" | "spoiled"; note: string | null }, by: OrderActor):
    Promise<{ ok: true; order: DeliveryOrder; refund: { id: string; amount: number } | null } | { ok: false; reason: "not_found" | "invalid_transition"; from?: OrderStatus }>;
}

/** Until the orders module exists nothing can be dispatched. */
export const noOrders: OrdersPort = {
  get: async () => null,
  getMany: async () => [],
  childrenOf: async () => [],
  listByStatus: async () => [],
  transition: async () => ({ ok: false, reason: "not_found" }),
  recordEvent: async () => undefined,
  verifyDeliveryOtp: async () => ({ valid: false, attemptsLeft: null, locked: false }),
  cancelFailedAndReturn: async () => ({ ok: false, reason: "not_found" }),
};
