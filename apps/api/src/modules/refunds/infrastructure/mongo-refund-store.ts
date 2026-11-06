import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter, type AuditEvent } from "../../audit/audit.public.js";
import type { Refund, RefundStatus } from "../domain/refund.js";
import { DuplicateRefundError, type RefundStore } from "../application/ports.js";

type Doc = Omit<Refund, "id"> & { _id: string };
const toRefund = ({ _id, ...rest }: Doc): Refund => ({ id: _id, ...rest });

export function createMongoRefundStore(connection: Connection): RefundStore {
  const refunds = () => connection.collection<Doc>("refunds");
  const writeAudit = createAuditWriter(connection);
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  return {
    async ensureIndexes() {
      // An automatic refund for one event (a cancellation, a removed item) is made once.
      await refunds().createIndex({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } }, name: "one_refund_per_event" });
      await refunds().createIndex({ orderId: 1 });
      await refunds().createIndex({ userId: 1, createdAt: -1 });
      await refunds().createIndex({ status: 1, warehouseId: 1, createdAt: -1 });
    },
    async insert(refund, audit) {
      const { id, ...rest } = refund;
      try {
        await inTransaction(async session => {
          await refunds().insertOne({ _id: id, ...rest }, { session });
          if (audit) await writeAudit(audit, session);
        });
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000 && refund.dedupeKey) throw new DuplicateRefundError(await this.byKey(refund.dedupeKey));
        throw error;
      }
    },
    async get(id) { const d = await refunds().findOne({ _id: id }); return d ? toRefund(d) : null; },
    async byKey(key) { const d = await refunds().findOne({ dedupeKey: key }); return d ? toRefund(d) : null; },
    async forOrder(orderId) { return (await refunds().find({ orderId }).sort({ _id: 1 }).toArray()).map(toRefund); },
    async listForUser(userId, limit, beforeId) {
      return (await refunds().find({ userId, ...(beforeId && { _id: { $lt: beforeId } }) }).sort({ _id: -1 }).limit(limit).toArray()).map(toRefund);
    },
    async list(filter, limit, beforeId) {
      const query: Record<string, unknown> = { ...(beforeId && { _id: { $lt: beforeId } }) };
      if (filter.status) query.status = filter.status;
      if (filter.source) query.source = filter.source;
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      if (filter.from || filter.to) query.createdAt = { ...(filter.from && { $gte: filter.from }), ...(filter.to && { $lte: filter.to }) };
      return (await refunds().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(toRefund);
    },
    pendingCount(warehouseIds) { return refunds().countDocuments({ status: "requested", ...(warehouseIds && { warehouseId: { $in: [...warehouseIds] } }) }); },
    async decide(id, from: readonly RefundStatus[], patch, audit) {
      return inTransaction(async session => {
        const { id: _i, ...rest } = patch as Partial<Refund> & { id?: string };
        const done = await refunds().updateOne({ _id: id, status: { $in: [...from] } }, { $set: rest as never }, { session });
        if (done.modifiedCount !== 1) return false;
        if (audit) await writeAudit(audit, session);
        return true;
      });
    },
  };
}
