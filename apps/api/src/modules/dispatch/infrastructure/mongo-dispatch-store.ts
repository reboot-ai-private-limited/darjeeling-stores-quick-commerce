import type { ClientSession, Connection } from "mongoose";
import { Types } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import { LiveAssignmentExistsError, type DispatchStore } from "../application/ports.js";
import type { Assignment, Batch, FeedEntry, Problem } from "../domain/dispatch.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules.
type AssignmentDoc = Omit<Assignment, "id"> & { _id: string };
type BatchDoc = Omit<Batch, "id"> & { _id: string };
type FeedDoc = Omit<FeedEntry, "id"> & { _id: string };
type ProblemDoc = Omit<Problem, "id"> & { _id: string };
const toAssignment = ({ _id, ...rest }: AssignmentDoc): Assignment => ({ id: _id, ...rest });
const toBatch = ({ _id, ...rest }: BatchDoc): Batch => ({ id: _id, ...rest });
const strip = <T extends { id?: string }>(patch: T): Omit<T, "id"> => { const { id: _id, ...rest } = patch; return rest; };

export function createMongoDispatchStore(connection: Connection): DispatchStore {
  const assignments = () => connection.collection<AssignmentDoc>("assignments");
  const batches = () => connection.collection<BatchDoc>("delivery_batches");
  const feed = () => connection.collection<FeedDoc>("assignment_feed");
  const problems = () => connection.collection<ProblemDoc>("rider_problems");
  const counters = () => connection.collection<{ _id: string; value: number }>("dispatch_counters");
  const writeAudit = createAuditWriter(connection);

  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await fn(session); });
      return result;
    } finally { await session.endSession(); }
  }

  return {
    async ensureIndexes() {
      // The database itself refuses a second live assignment for one order.
      await assignments().createIndex({ orderId: 1 }, { unique: true, partialFilterExpression: { live: true }, name: "one_live_assignment_per_order" });
      await assignments().createIndex({ riderId: 1, live: 1 });
      await assignments().createIndex({ live: 1, status: 1, ackDeadlineAt: 1 });
      await assignments().createIndex({ riderId: 1, status: 1, completedAt: -1 });
      await assignments().createIndex({ warehouseId: 1, assignedAt: -1 });
      await assignments().createIndex({ outcome: 1, failedResolvedAt: 1 });
      await batches().createIndex({ riderId: 1, status: 1 });
      await batches().createIndex({ orderIds: 1 });
      await feed().createIndex({ riderId: 1, seq: 1 });
      await problems().createIndex({ createdAt: -1 });
    },

    async insertAssignment(assignment) {
      const { id, ...rest } = assignment;
      try { await assignments().insertOne({ _id: id, ...rest }); }
      catch (error) { if ((error as { code?: number } | null)?.code === 11000) throw new LiveAssignmentExistsError(); throw error; }
    },
    async getAssignment(id) { const doc = await assignments().findOne({ _id: id }); return doc ? toAssignment(doc) : null; },
    async liveForOrder(orderId) { const doc = await assignments().findOne({ orderId, live: true }); return doc ? toAssignment(doc) : null; },
    async liveForOrders(orderIds) { return orderIds.length === 0 ? [] : (await assignments().find({ orderId: { $in: [...orderIds] }, live: true }).toArray()).map(toAssignment); },
    async liveForRider(riderId) { return (await assignments().find({ riderId, live: true }).sort({ assignedAt: 1 }).toArray()).map(toAssignment); },
    async forOrderAndRider(orderId, riderId) { return (await assignments().find({ orderId, riderId }).sort({ _id: -1 }).toArray()).map(toAssignment); },

    async updateAssignment(id, patch, when) {
      const filter = { _id: id, ...(when?.live !== undefined && { live: when.live }), ...(when?.status && { status: when.status }) };
      return (await assignments().updateOne(filter, { $set: strip(patch) })).matchedCount === 1;
    },

    async listAssignments(filters, limit) {
      const filter: Record<string, unknown> = {};
      if (filters.status) filter.status = filters.status;
      if (filters.riderId) filter.riderId = filters.riderId;
      if (filters.warehouseId) filter.warehouseId = filters.warehouseId;
      else if (filters.scope) filter.warehouseId = { $in: [...filters.scope] };
      return (await assignments().find(filter).sort({ _id: -1 }).limit(limit).toArray()).map(toAssignment);
    },

    async dueForEscalation(now, limit) {
      return (await assignments().find({ live: true, status: "assigned", ackDeadlineAt: { $lte: now }, escalatedAt: null }).sort({ ackDeadlineAt: 1 }).limit(limit).toArray()).map(toAssignment);
    },
    async markEscalated(id, at) {
      return (await assignments().updateOne({ _id: id, live: true, status: "assigned", escalatedAt: null }, { $set: { escalatedAt: at, updatedAt: at } })).modifiedCount === 1;
    },

    async completedFor(riderId, range, beforeId, limit) {
      const filter: Record<string, unknown> = { riderId, status: "completed" };
      if (range.from || range.to) filter.completedAt = { ...(range.from && { $gte: range.from }), ...(range.to && { $lte: range.to }) };
      if (beforeId) filter._id = { $lt: beforeId };
      return (await assignments().find(filter).sort({ _id: -1 }).limit(limit).toArray()).map(toAssignment);
    },
    countDeliveredSince(riderId, since) { return assignments().countDocuments({ riderId, outcome: "delivered", completedAt: { $gte: since } }); },
    async failedForOrder(orderId) { return (await assignments().find({ orderId, outcome: "failed", failedResolvedAt: null }).toArray()).map(toAssignment); },
    async failedUnresolved(limit) { return (await assignments().find({ outcome: "failed", failedResolvedAt: null }).sort({ completedAt: -1 }).limit(limit).toArray()).map(toAssignment); },
    async withPickup(riderId) { return (await assignments().find({ riderId, live: true, pickup: { $ne: null } }).toArray()).map(toAssignment); },

    async insertBatch(batch) { const { id, ...rest } = batch; await batches().insertOne({ _id: id, ...rest }); },
    async getBatch(id) { const doc = await batches().findOne({ _id: id }); return doc ? toBatch(doc) : null; },
    async updateBatch(id, patch, when) {
      return (await batches().updateOne({ _id: id, ...(when?.status && { status: when.status }) }, { $set: strip(patch) })).matchedCount === 1;
    },
    async listBatches(filters, limit) {
      const filter: Record<string, unknown> = {};
      if (filters.status) filter.status = filters.status;
      if (filters.riderId) filter.riderId = filters.riderId;
      return (await batches().find(filter).sort({ _id: -1 }).limit(limit).toArray()).map(toBatch);
    },
    async batchOfOrder(orderId) { const doc = await batches().findOne({ orderIds: orderId, status: { $in: ["planned", "active"] } }); return doc ? toBatch(doc) : null; },

    appendFeed(entry) {
      // The counter and the entry are saved together, so entries become visible in sequence order and a rider polling by
      // sequence can never skip one.
      return inTransaction(async session => {
        const counter = await counters().findOneAndUpdate({ _id: "feed" }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after", session });
        const saved: FeedEntry = { id: new Types.ObjectId().toHexString(), seq: counter!.value, ...entry };
        const { id, ...rest } = saved;
        await feed().insertOne({ _id: id, ...rest }, { session });
        return saved;
      });
    },
    async feedSince(riderId, afterSeq, limit) {
      return (await feed().find({ riderId, seq: { $gt: afterSeq } }).sort({ seq: 1 }).limit(limit).toArray()).map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    },
    async latestSeq(riderId) { return (await feed().find({ riderId }).sort({ seq: -1 }).limit(1).toArray())[0]?.seq ?? 0; },

    async insertProblem(problem) { const { id, ...rest } = problem; await problems().insertOne({ _id: id, ...rest }); },
    async recentProblems(since, limit) {
      return (await problems().find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(limit).toArray()).map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    },

    async recordAudit(entry) { await inTransaction(session => writeAudit(entry, session)); },
  };
}
