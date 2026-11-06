import type { ClientSession, Connection } from "mongoose";
import { Types } from "mongoose";
import { createAuditWriter, type AuditEvent } from "../../audit/audit.public.js";
import type { Review } from "../domain/sync.js";
import type { EventClaim, EventOutcome, NewReview, SyncStore } from "../application/ports.js";

type ReviewDoc = Omit<Review, "id"> & { _id: string };
type EventDoc = EventClaim & { _id: string; result: "processing" | EventOutcome["result"]; reason: string | null; message: string | null; finishedAt: Date | null };
const toReview = ({ _id, ...rest }: ReviewDoc): Review => ({ id: _id, ...rest });

export function createMongoSyncStore(connection: Connection): SyncStore {
  const events = () => connection.collection<EventDoc>("sync_events");
  const reviews = () => connection.collection<ReviewDoc>("offline_reviews");
  const writeAudit = createAuditWriter(connection);
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  return {
    async ensureIndexes() {
      // The same event, however often it is sent, is handled once.
      await events().createIndex({ riderId: 1, clientEventId: 1 }, { unique: true });
      await events().createIndex({ orderId: 1 });
      // Event records are kept for 90 days.
      await events().createIndex({ receivedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
      await reviews().createIndex({ orderId: 1 }, { unique: true });
      await reviews().createIndex({ status: 1, warehouseId: 1, syncedAt: -1 });
    },
    async claim(event) {
      try {
        await events().insertOne({ _id: new Types.ObjectId().toHexString(), ...event, result: "processing", reason: null, message: null, finishedAt: null });
        return true;
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000) return false;
        throw error;
      }
    },
    async finish(riderId, clientEventId, outcome) {
      await events().updateOne({ riderId, clientEventId }, { $set: { result: outcome.result, reason: outcome.reason, message: outcome.message, finishedAt: new Date() } });
    },
    async release(riderId, clientEventId) { await events().deleteOne({ riderId, clientEventId, result: "processing" }); },
    async openReview(review: NewReview) {
      await reviews().updateOne(
        { orderId: review.orderId },
        { $setOnInsert: { ...review, status: "open", outcome: null, note: null, resolvedBy: null, resolvedAt: null, _id: new Types.ObjectId().toHexString() } },
        { upsert: true },
      );
    },
    async getReview(orderId) { const doc = await reviews().findOne({ orderId }); return doc ? toReview(doc) : null; },
    async listReviews(filter, limit, beforeId) {
      const query: Record<string, unknown> = { ...(beforeId && { _id: { $lt: beforeId } }) };
      if (filter.status) query.status = filter.status;
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      if (filter.from || filter.to) query.syncedAt = { ...(filter.from && { $gte: filter.from }), ...(filter.to && { $lte: filter.to }) };
      return (await reviews().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(toReview);
    },
    openCount(warehouseIds) { return reviews().countDocuments({ status: "open", ...(warehouseIds && { warehouseId: { $in: [...warehouseIds] } }) }); },
    async closeReview(orderId, patch) {
      const done = await reviews().updateOne({ orderId, status: "open" }, { $set: { status: "resolved", outcome: patch.outcome, note: patch.note, resolvedBy: patch.by, resolvedAt: patch.at } });
      return done.modifiedCount === 1;
    },
    async reopenReview(orderId) { await reviews().updateOne({ orderId }, { $set: { status: "open", outcome: null, note: null, resolvedBy: null, resolvedAt: null } }); },
    async recordAudit(entry: AuditEvent) { await inTransaction(session => writeAudit(entry, session)); },
  };
}
