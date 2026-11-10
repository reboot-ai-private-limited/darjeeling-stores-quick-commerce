import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter, type AuditEvent } from "../../audit/audit.public.js";
import type { Order, OrderEvent, OrderGroup, OrderStatus } from "../domain/order.js";
import { DuplicateGroupError, StaleOrderError, type Change, type OrderFilter, type OrderStore } from "../application/ports.js";

type OrderDoc = Omit<Order, "id"> & { _id: string };
type GroupDoc = Omit<OrderGroup, "id"> & { _id: string };
type EventDoc = Omit<OrderEvent, "id"> & { _id: string };
type ChangeDoc = Omit<Change, "seq"> & { _id: number };
const toOrder = ({ _id, ...rest }: OrderDoc): Order => ({ id: _id, ...rest });
const toGroup = ({ _id, ...rest }: GroupDoc): OrderGroup => ({ id: _id, ...rest });
const toEvent = ({ _id, ...rest }: EventDoc): OrderEvent => ({ id: _id, ...rest });
const strip = <T extends { id?: string }>(patch: T): Omit<T, "id"> => { const { id: _id, ...rest } = patch; return rest; };
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createMongoOrderStore(connection: Connection): OrderStore {
  const groups = () => connection.collection<GroupDoc>("order_groups");
  const orders = () => connection.collection<OrderDoc>("orders");
  const events = () => connection.collection<EventDoc>("order_events");
  const changes = () => connection.collection<ChangeDoc>("order_changes");
  const counters = () => connection.collection<{ _id: string; value: number }>("order_counters");
  const writeAudit = createAuditWriter(connection);

  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  /** The next number of the change feed, taken in the same transaction as the change so the feed never skips. */
  async function change(entry: Omit<Change, "seq">, session: ClientSession): Promise<void> {
    const counter = await counters().findOneAndUpdate({ _id: "order_changes" }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after", session });
    await changes().insertOne({ _id: counter!.value, ...entry }, { session });
  }

  return {
    async ensureIndexes() {
      await groups().createIndex({ groupNo: 1 }, { unique: true });
      await groups().createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true });
      await groups().createIndex({ userId: 1, createdAt: -1 });
      await groups().createIndex({ expiresAt: 1 }, { sparse: true });
      await orders().createIndex({ orderNo: 1 }, { unique: true });
      await orders().createIndex({ groupId: 1 });
      await orders().createIndex({ warehouseId: 1, status: 1, createdAt: -1 });
      await orders().createIndex({ userId: 1, createdAt: -1 });
      await orders().createIndex({ status: 1, createdAt: 1 });
      // The dashboard and the sales reports read a day or a range of days across every warehouse.
      await orders().createIndex({ createdAt: -1 });
      await events().createIndex({ orderId: 1, at: 1 });
      await changes().createIndex({ warehouseId: 1, _id: 1 });
    },
    async nextGroupNumber() {
      const counter = await counters().findOneAndUpdate({ _id: "group_no" }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" });
      return 240_000 + counter!.value;
    },

    async insertGroup(group, children, firstEvents) {
      const { id: groupId, ...groupRest } = group;
      try {
        await inTransaction(async session => {
          await groups().insertOne({ _id: groupId, ...groupRest }, { session });
          for (const child of children) { const { id, ...rest } = child; await orders().insertOne({ _id: id, ...rest }, { session }); }
          for (const event of firstEvents) { const { id, ...rest } = event; await events().insertOne({ _id: id, ...rest }, { session }); }
          for (const child of children) await change({ orderId: child.id, warehouseId: child.warehouseId, event: "created", at: child.createdAt }, session);
        });
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000 && /idempotencyKey/.test(String((error as Error).message))) throw new DuplicateGroupError();
        throw error;
      }
    },
    async findGroupByKey(userId, key) { const doc = await groups().findOne({ userId, idempotencyKey: key }); return doc ? toGroup(doc) : null; },
    countGroupsOf(userId) { return groups().countDocuments({ userId }); },
    async groupIdByNo(groupNo) { return (await groups().findOne({ groupNo }, { projection: { _id: 1 } }))?._id ?? null; },
    async expiredGroupIds(before, limit) {
      return (await groups().find({ expiresAt: { $ne: null, $lte: before }, paymentMethod: "online", paymentStatus: { $ne: "paid" } }).sort({ expiresAt: 1 }).limit(limit).toArray()).map(g => g._id);
    },
    async getGroup(id) { const doc = await groups().findOne({ _id: id }); return doc ? toGroup(doc) : null; },
    async updateGroup(id, patch) { await groups().updateOne({ _id: id }, { $set: { ...strip(patch), updatedAt: new Date() } as never }); },
    async listGroupsOf(userId, filter, limit, beforeId) {
      const query: Record<string, unknown> = { userId, ...(beforeId && { _id: { $lt: beforeId } }) };
      const found = (await groups().find(query).sort({ _id: -1 }).limit(limit * 5).toArray()).map(toGroup);
      if (filter.live === undefined) return found.slice(0, limit);
      // Whether a group is still in progress depends on its children, so the filter is applied after reading them.
      const out: OrderGroup[] = [];
      for (const group of found) {
        const kids = (await orders().find({ groupId: group.id }, { projection: { status: 1 } }).toArray()).map(k => k.status);
        if (kids.some(s => s !== "DELIVERED" && s !== "CANCELLED") === filter.live) out.push(group);
        if (out.length >= limit) break;
      }
      return out;
    },

    async getOrder(id) { const doc = await orders().findOne({ _id: id }); return doc ? toOrder(doc) : null; },
    async getOrders(ids) { return ids.length === 0 ? [] : (await orders().find({ _id: { $in: [...ids] } }).toArray()).map(toOrder); },
    async childrenOf(groupId) { return (await orders().find({ groupId }).sort({ orderNo: 1 }).toArray()).map(toOrder); },
    async listOrders(filter: OrderFilter, limit, beforeId) {
      const query: Record<string, unknown> = { ...(beforeId && { _id: { $lt: beforeId } }) };
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      if (filter.statuses) query.status = { $in: [...filter.statuses] };
      if (filter.paymentStatus) query.paymentStatus = filter.paymentStatus;
      if (filter.userId) query.userId = filter.userId;
      if (filter.windowStart) query["scheduledWindow.start"] = filter.windowStart;
      else if (filter.windowFrom || filter.windowTo) query["scheduledWindow.start"] = { ...(filter.windowFrom && { $gte: filter.windowFrom }), ...(filter.windowTo && { $lt: filter.windowTo }) };
      if (filter.ids) query._id = { ...(query._id as object | undefined), $in: [...filter.ids] };
      if (filter.preOrder !== undefined) query.scheduledWindow = filter.preOrder ? { $ne: null } : null;
      if (filter.from || filter.to) query.createdAt = { ...(filter.from && { $gte: filter.from }), ...(filter.to && { $lte: filter.to }) };
      if (filter.flagged) query.$or = [{ "delivery.offline": true, collection: { $ne: null }, "collection.method": "upi_unverified" }, { "delivery.offline": true }];
      if (filter.q) {
        const rx = new RegExp(escapeRegex(filter.q), "i");
        query.$and = [{ $or: [{ orderNo: rx }, { customerName: rx }, { customerPhone: rx }] }];
      }
      return (await orders().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(toOrder);
    },
    async listByStatus(status, limit) { return (await orders().find({ status }).sort({ createdAt: 1 }).limit(limit).toArray()).map(toOrder); },

    async transition(orderId, from, patch, event, audit) {
      return inTransaction(async session => {
        const { id: _id, ...rest } = strip(patch) as Partial<Order> & { id?: string };
        const updated = await orders().findOneAndUpdate({ _id: orderId, status: from }, { $set: { ...rest, updatedAt: event.at } as never, $inc: { rev: 1 } }, { returnDocument: "after", session });
        if (!updated) throw new StaleOrderError();
        const { id, ...eventRest } = event;
        await events().insertOne({ _id: id, ...eventRest }, { session });
        await change({ orderId, warehouseId: updated.warehouseId, event: "status_changed", at: event.at }, session);
        if (audit) await writeAudit(audit, session);
        return toOrder(updated);
      });
    },
    async patch(orderId, patch, event, where, audit) {
      return inTransaction(async session => {
        const filter: Record<string, unknown> = { _id: orderId, ...(where?.status && { status: where.status }), ...(where?.rev !== undefined && { rev: where.rev }) };
        const updated = await orders().findOneAndUpdate(filter, { $set: { ...strip(patch), updatedAt: new Date() } as never, $inc: { rev: 1 } }, { returnDocument: "after", session });
        if (!updated) return null;
        if (event) { const { id, ...rest } = event; await events().insertOne({ _id: id, ...rest }, { session }); }
        await change({ orderId, warehouseId: updated.warehouseId, event: "updated", at: new Date() }, session);
        if (audit) await writeAudit(audit, session);
        return toOrder(updated);
      });
    },
    async addEvent(event) { const { id, ...rest } = event; await events().insertOne({ _id: id, ...rest }); },
    async eventsOf(orderId) { return (await events().find({ orderId }).sort({ at: 1, _id: 1 }).toArray()).map(toEvent); },
    async addNote(orderId, note, event) {
      await inTransaction(async session => {
        await orders().updateOne({ _id: orderId }, { $push: { notes: note }, $set: { updatedAt: note.at } } as never, { session });
        const { id, ...rest } = event;
        await events().insertOne({ _id: id, ...rest }, { session });
      });
    },

    async changesSince(seq, filter, limit) {
      const query: Record<string, unknown> = { _id: { $gt: seq } };
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      return (await changes().find(query).sort({ _id: 1 }).limit(limit).toArray()).map(({ _id, ...rest }) => ({ seq: _id, ...rest }));
    },
    async latestChange() { return (await changes().find({}).sort({ _id: -1 }).limit(1).next())?._id ?? 0; },
    async recordChange(entry) { await inTransaction(session => change(entry, session)); },
    async countWrongOtp(groupId) {
      const updated = await groups().findOneAndUpdate({ _id: groupId }, { $inc: { otpWrong: 1 } }, { returnDocument: "after" });
      return updated?.otpWrong ?? 0;
    },
    async recordAudit(entry: AuditEvent) { await inTransaction(session => writeAudit(entry, session)); },
  };
}
export type { OrderStatus };
