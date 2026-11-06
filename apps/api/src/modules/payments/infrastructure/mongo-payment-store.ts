import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter, type AuditEvent } from "../../audit/audit.public.js";
import type { Payment, PaymentEvent, Reconciliation } from "../domain/payment.js";
import { DuplicateEventError, type PaymentStore } from "../application/ports.js";

type PaymentDoc = Omit<Payment, "id"> & { _id: string };
type EventDoc = Omit<PaymentEvent, "id"> & { _id: string };
type ReconDoc = Omit<Reconciliation, "id"> & { _id: string };
const toPayment = ({ _id, ...rest }: PaymentDoc): Payment => ({ id: _id, ...rest });
const toEvent = ({ _id, ...rest }: EventDoc): PaymentEvent => ({ id: _id, ...rest });

export function createMongoPaymentStore(connection: Connection): PaymentStore {
  const payments = () => connection.collection<PaymentDoc>("payments");
  const events = () => connection.collection<EventDoc>("payment_events");
  const recons = () => connection.collection<ReconDoc>("payment_reconciliations");
  const writeAudit = createAuditWriter(connection);
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  const strip = (patch: Partial<Payment>) => { const { id: _id, ...rest } = patch; return rest; };

  return {
    async ensureIndexes() {
      await payments().createIndex({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: "string" } } });
      await payments().createIndex({ razorpayLinkId: 1 }, { unique: true, partialFilterExpression: { razorpayLinkId: { $type: "string" } } });
      await payments().createIndex({ groupId: 1, createdAt: -1 });
      await payments().createIndex({ status: 1, createdAt: -1 });
      await payments().createIndex({ capturedAt: 1 }, { sparse: true });
      // A provider event is handled once, however often it is delivered.
      await events().createIndex({ eventId: 1 }, { unique: true });
      await events().createIndex({ razorpayOrderId: 1, at: -1 });
      await recons().createIndex({ date: 1, createdAt: -1 });
    },
    async insert(p) { const { id, ...rest } = p; await payments().insertOne({ _id: id, ...rest }); },
    async get(id) { const d = await payments().findOne({ _id: id }); return d ? toPayment(d) : null; },
    async byRazorpayOrder(orderId) { const d = await payments().findOne({ razorpayOrderId: orderId }); return d ? toPayment(d) : null; },
    async byLink(linkId) { const d = await payments().findOne({ razorpayLinkId: linkId }); return d ? toPayment(d) : null; },
    async forGroup(groupId) { return (await payments().find({ groupId }).sort({ _id: 1 }).toArray()).map(toPayment); },
    async list(filter, limit, beforeId) {
      const query: Record<string, unknown> = { ...(beforeId && { _id: { $lt: beforeId } }) };
      if (filter.status) query.status = filter.status;
      if (filter.method) query.method = filter.method;
      if (filter.groupIds) query.groupId = { $in: [...filter.groupIds] };
      if (filter.from || filter.to) query.createdAt = { ...(filter.from && { $gte: filter.from }), ...(filter.to && { $lte: filter.to }) };
      return (await payments().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(toPayment);
    },
    async update(id, patch, audit) {
      await inTransaction(async session => {
        await payments().updateOne({ _id: id }, { $set: { ...strip(patch), updatedAt: new Date() } as never }, { session });
        if (audit) await writeAudit(audit, session);
      });
    },
    async capture(id, patch, audit) {
      return inTransaction(async session => {
        const done = await payments().updateOne({ _id: id, status: { $ne: "captured" } }, { $set: { ...strip(patch), status: "captured", updatedAt: new Date() } as never }, { session });
        if (done.modifiedCount !== 1) return false;
        if (audit) await writeAudit(audit, session);
        return true;
      });
    },
    async recordEvent(event) {
      const { id, ...rest } = event;
      try { await events().insertOne({ _id: id, ...rest }); }
      catch (error) { if ((error as { code?: number } | null)?.code === 11000) throw new DuplicateEventError(); throw error; }
    },
    async setEventResult(eventId, result) { await events().updateOne({ eventId }, { $set: { result } }); },
    async lastEvent(orderId, paymentId) {
      const or = [...(orderId ? [{ razorpayOrderId: orderId }] : []), ...(paymentId ? [{ razorpayPaymentId: paymentId }] : [])];
      if (or.length === 0) return null;
      const d = await events().find({ $or: or }).sort({ at: -1 }).limit(1).next();
      return d ? toEvent(d) : null;
    },
    async capturedBetween(from, to) { return (await payments().find({ status: "captured", capturedAt: { $gte: from, $lt: to } }).toArray()).map(toPayment); },
    async saveReconciliation(r) { const { id, ...rest } = r; await recons().insertOne({ _id: id, ...rest }); },
    async latestReconciliation(date) { const d = await recons().find({ date }).sort({ createdAt: -1 }).limit(1).next(); return d ? { id: d._id, ...(({ _id: _i, ...rest }) => rest)(d) } : null; },
  };
}
