import type { Rider, RiderSettings } from "../../riders/riders.public.js";

export type AssignmentStatus = "assigned" | "acknowledged" | "reassigned" | "cancelled" | "completed";
export const LIVE_STATUSES: readonly AssignmentStatus[] = ["assigned", "acknowledged"];

export interface Assignment {
  id: string; orderId: string; riderId: string; batchId: string | null; status: AssignmentStatus;
  /** True while the rider is expected to deliver the order (assigned or acknowledged). At most one live assignment per order. */
  live: boolean;
  mode: "manual" | "auto"; assignedBy: string | null; assignedAt: Date; ackDeadlineAt: Date; ackAt: Date | null;
  /** Set once the unacknowledged order has been escalated (WhatsApp to the rider, alert to the admin). */
  escalatedAt: Date | null; whatsappSentAt: Date | null;
  outcome: "delivered" | "failed" | null; completedAt: Date | null; endedAt: Date | null; endReason: string | null;
  /** The assignment this one took over from a rider who handed the order over. */
  handoverFromId: string | null;
  zoneId: string; warehouseId: string; groupId: string;
  pickup: { at: Date; bagCount: number | null } | null;
  /** Set when an admin has dealt with a failed delivery. */
  failedResolvedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}

export interface Stop {
  seq: number; type: "pickup" | "drop"; warehouseId?: string; orderIds: string[]; status: "pending" | "arrived" | "done";
  /** Orders at this stop already picked up (pickup stops) or finished (drop stops). */
  doneOrderIds: string[]; arrivedAt?: Date; doneAt?: Date;
}
export interface Batch {
  id: string; riderId: string; zoneId: string; status: "planned" | "active" | "done" | "cancelled"; stops: Stop[]; orderIds: string[];
  createdBy: string; createdAt: Date; updatedAt: Date;
}

export interface Problem { id: string; orderId: string; riderId: string; assignmentId: string; type: string; note: string | null; createdAt: Date }

export type FeedEvent = "assigned" | "reassigned_away" | "cancelled" | "payment_paid" | "updated";
export interface FeedEntry { id: string; seq: number; riderId: string; assignmentId: string; orderId: string; event: FeedEvent; at: Date }

export interface DispatchSettings extends RiderSettings {
  assignmentMode: "manual" | "auto";
  /** The most orders in one batch. The batch limit follows `maxActiveOrders` but never goes past this. */
  maxBatchOrders: number;
  /** A ready order nobody has picked up for this long is flagged on the board. */
  delayedAfterMinutes: number;
}

export type IneligibleReason = "offline" | "on_break" | "wrong_zone" | "wrong_warehouse" | "at_capacity" | "stale_location";

/** Why a rider cannot take an order right now. Empty means they can. */
export function ineligibleReasons(rider: Rider, order: { zoneId: string; warehouseId: string }, settings: RiderSettings, now: Date): IneligibleReason[] {
  const reasons: IneligibleReason[] = [];
  if (!rider.isActive || rider.status === "offline" || rider.currentShiftId === null) reasons.push("offline");
  else if (rider.status === "on_break") reasons.push("on_break");
  if (rider.zoneId !== order.zoneId) reasons.push("wrong_zone");
  if (!rider.warehouseIds.includes(order.warehouseId)) reasons.push("wrong_warehouse");
  if (rider.activeOrderCount >= settings.maxActiveOrders) reasons.push("at_capacity");
  if (!rider.lastLocationAt || now.getTime() - rider.lastLocationAt.getTime() > settings.locationStaleSeconds * 1000) reasons.push("stale_location");
  return reasons;
}

export interface Candidate { rider: Rider; distanceMeters: number | null }

/** Fewest active orders, then nearest to the warehouse, then the one who has waited longest since an assignment. */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) =>
    a.rider.activeOrderCount - b.rider.activeOrderCount
    || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)
    || (a.rider.lastAssignedAt?.getTime() ?? 0) - (b.rider.lastAssignedAt?.getTime() ?? 0)
    || (a.rider.id < b.rider.id ? -1 : 1));
}

/** The largest batch a rider may carry. */
export const batchLimit = (settings: DispatchSettings) => Math.min(settings.maxActiveOrders, settings.maxBatchOrders);

/**
 * Stops for a batch: a pickup at each warehouse (in the order given, else first seen) then a drop for each customer's checkout.
 * Orders of one group go to one drop.
 */
export function buildStops(orders: readonly { id: string; groupId: string; warehouseId: string }[], pickupOrder?: readonly string[]): Stop[] {
  const warehouses = pickupOrder ? [...pickupOrder] : [...new Set(orders.map(o => o.warehouseId))];
  const groups = [...new Set(orders.map(o => o.groupId))];
  const stops: Stop[] = [];
  for (const warehouseId of warehouses) {
    stops.push({ seq: stops.length + 1, type: "pickup", warehouseId, orderIds: orders.filter(o => o.warehouseId === warehouseId).map(o => o.id), status: "pending", doneOrderIds: [] });
  }
  for (const groupId of groups) stops.push({ seq: stops.length + 1, type: "drop", orderIds: orders.filter(o => o.groupId === groupId).map(o => o.id), status: "pending", doneOrderIds: [] });
  return stops;
}

/** The caller's stops, if they cover exactly the batch's orders: every order picked up once and dropped once. Renumbered from 1. */
export function sameStops(orderIds: readonly string[], proposed: readonly { type: "pickup" | "drop"; warehouseId?: string | undefined; orderIds: string[] }[], orders: readonly { id: string; warehouseId: string }[]): Stop[] | null {
  const want = [...orderIds].sort().join();
  const pickups = proposed.filter(s => s.type === "pickup");
  const drops = proposed.filter(s => s.type === "drop");
  const covers = (stops: typeof proposed) => stops.flatMap(s => s.orderIds).sort().join() === want;
  if (!covers(pickups) || !covers(drops)) return null;
  const warehouseOf = new Map(orders.map(o => [o.id, o.warehouseId]));
  if (pickups.some(s => !s.warehouseId || s.orderIds.some(id => warehouseOf.get(id) !== s.warehouseId))) return null;
  return proposed.map((s, i) => ({ seq: i + 1, type: s.type, ...(s.type === "pickup" && { warehouseId: s.warehouseId! }), orderIds: [...s.orderIds], status: "pending" as const, doneOrderIds: [] }));
}

export const assignmentView = (a: Assignment) => ({
  id: a.id, orderId: a.orderId, riderId: a.riderId, status: a.status, mode: a.mode, ackDeadlineAt: a.ackDeadlineAt.toISOString(), assignedAt: a.assignedAt.toISOString(),
  batchId: a.batchId,
});

export const batchView = (b: Batch) => ({
  id: b.id, riderId: b.riderId, zoneId: b.zoneId, status: b.status, createdBy: b.createdBy,
  stops: b.stops.map(s => ({ seq: s.seq, type: s.type, ...(s.warehouseId && { warehouseId: s.warehouseId }), orderIds: s.orderIds, status: s.status })),
});
