import type { Rider } from "../../riders/riders.public.js";
import type { Assignment, AssignmentStatus, Batch, FeedEntry, FeedEvent, Problem } from "../domain/dispatch.js";


export interface AssignmentFilters {
  status?: AssignmentStatus | undefined; riderId?: string | undefined; warehouseId?: string | undefined;
  /** Only assignments at these warehouses (a scoped admin). `null` for no limit. */
  scope: readonly string[] | null;
}
export interface BatchFilters { status?: Batch["status"] | undefined; riderId?: string | undefined; scopeZones?: readonly string[] | null }

export class LiveAssignmentExistsError extends Error { constructor() { super("This order already has a live assignment"); this.name = "LiveAssignmentExistsError"; } }

export interface DispatchStore {
  ensureIndexes(): Promise<void>;

  /** Throws LiveAssignmentExistsError when the order already has a live assignment. */
  insertAssignment(assignment: Assignment): Promise<void>;
  getAssignment(id: string): Promise<Assignment | null>;
  liveForOrder(orderId: string): Promise<Assignment | null>;
  liveForOrders(orderIds: readonly string[]): Promise<Assignment[]>;
  liveForRider(riderId: string): Promise<Assignment[]>;
  /** All the rider's assignments for one order, newest first. */
  forOrderAndRider(orderId: string, riderId: string): Promise<Assignment[]>;
  /** The most recent assignment of an order, live or not. */
  latestForOrder(orderId: string): Promise<Assignment | null>;
  /** Saves fields of an assignment, optionally only while it is still live or in a given status. False when the condition no longer holds. */
  updateAssignment(id: string, patch: Partial<Assignment>, when?: { live?: boolean; status?: AssignmentStatus }): Promise<boolean>;
  listAssignments(filters: AssignmentFilters, limit: number): Promise<Assignment[]>;
  /** Assignments waiting for an acknowledgement past their deadline that nobody has been told about yet. */
  dueForEscalation(now: Date, limit: number): Promise<Assignment[]>;
  /** The first caller to mark one wins; false for anyone else. */
  markEscalated(id: string, at: Date): Promise<boolean>;
  completedFor(riderId: string, range: { from?: Date | undefined; to?: Date | undefined }, beforeId: string | undefined, limit: number): Promise<Assignment[]>;
  countDeliveredSince(riderId: string, since: Date): Promise<number>;
  /** An order's failed deliveries that nobody has dealt with yet. */
  failedForOrder(orderId: string): Promise<Assignment[]>;
  /** Failed deliveries nobody has dealt with yet. */
  failedUnresolved(limit: number): Promise<Assignment[]>;
  /** How many of a rider's live orders have been picked up (used before ending their shift by force). */
  withPickup(riderId: string): Promise<Assignment[]>;

  insertBatch(batch: Batch): Promise<void>;
  getBatch(id: string): Promise<Batch | null>;
  updateBatch(id: string, patch: Partial<Batch>, when?: { status?: Batch["status"] }): Promise<boolean>;
  listBatches(filters: BatchFilters, limit: number): Promise<Batch[]>;
  /** The batch (planned or active) an order belongs to. */
  batchOfOrder(orderId: string): Promise<Batch | null>;

  /** Adds an entry to a rider's feed with the next sequence number. */
  appendFeed(entry: Omit<FeedEntry, "id" | "seq">): Promise<FeedEntry>;
  feedSince(riderId: string, afterSeq: number, limit: number): Promise<FeedEntry[]>;
  latestSeq(riderId: string): Promise<number>;

  insertProblem(problem: Problem): Promise<void>;
  recentProblems(since: Date, limit: number): Promise<Problem[]>;

}

/** What dispatch needs from rider profiles, shifts and capacity. */
export interface RiderDirectory {
  get(id: string): Promise<Rider | null>;
  getMany(ids: readonly string[]): Promise<Rider[]>;
  listActive(): Promise<Rider[]>;
  reserveCapacity(riderId: string, max: number): Promise<boolean>;
  releaseCapacity(riderId: string): Promise<void>;
  markAssigned(riderId: string, at: Date): Promise<unknown>;
}

/** Messages to riders. Failures are the notifier's to handle: they never undo a dispatch decision. */
export interface RiderNotifier {
  assigned(rider: Rider, info: { assignmentId: string; orderNo: string; ackDeadlineAt: Date }): Promise<void>;
  handover(rider: Rider, info: { assignmentId: string; orderId: string; orderNo: string; ackDeadlineAt: Date }): Promise<void>;
  cancelled(rider: Rider, info: { assignmentId: string; orderId: string; orderNo: string }): Promise<void>;
  paid(rider: Rider, info: { orderId: string; orderNo: string }): Promise<void>;
  /** The rider has not acknowledged in time: WhatsApp. */
  unacknowledged(rider: Rider, info: { assignmentId: string; orderNo: string }): Promise<boolean>;
}

/** Evidence photos for failed deliveries (F24). */
export interface EvidenceMedia {
  claim(input: { mediaId: string; userId: string; orderId: string }): Promise<void>;
  unclaim(mediaId: string, orderId: string): Promise<void>;
}

export type { FeedEvent };
