import type { ClientSession, Connection } from "mongoose";
import { Types } from "mongoose";
import type { LedgerEntry, Reconciliation } from "../domain/cash.js";
import { DuplicateCollectionError, InsufficientCashError, type CashStore, type NewReconciliation, type RiderBalance } from "../application/ports.js";

type LedgerDoc = Omit<LedgerEntry, "id"> & { _id: string };
type ReconDoc = Omit<Reconciliation, "id"> & { _id: string };
interface BalanceDoc { _id: string; riderId: string; warehouseId: string; amount: number; updatedAt: Date }
interface TotalDoc { _id: string; total: number; lastDepositAt: Date | null; updatedAt: Date }
const toEntry = ({ _id, ...rest }: LedgerDoc): LedgerEntry => ({ id: _id, ...rest });
const toRecon = ({ _id, ...rest }: ReconDoc): Reconciliation => ({ id: _id, ...rest });
const newId = () => new Types.ObjectId().toHexString();

export function createMongoCashStore(connection: Connection): CashStore {
  const ledger = () => connection.collection<LedgerDoc>("cash_ledger");
  const balances = () => connection.collection<BalanceDoc>("cash_balances");
  const totals = () => connection.collection<TotalDoc>("cash_totals");
  const recon = () => connection.collection<ReconDoc>("cash_reconciliation");

  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await fn(session); });
      return result;
    } finally { await session.endSession(); }
  }
  const before = (beforeId?: string) => (beforeId ? { _id: { $lt: beforeId } } : {});

  function toBalances(rows: BalanceDoc[], lastDeposit: Map<string, Date | null>): RiderBalance[] {
    const byRider = new Map<string, RiderBalance>();
    for (const row of rows) {
      const entry = byRider.get(row.riderId) ?? { riderId: row.riderId, total: 0, byWarehouse: [], lastDepositAt: lastDeposit.get(row.riderId) ?? null };
      entry.total += row.amount;
      if (row.amount !== 0) entry.byWarehouse.push({ warehouseId: row.warehouseId, amount: row.amount });
      byRider.set(row.riderId, entry);
    }
    return [...byRider.values()];
  }

  return {
    async ensureIndexes() {
      // Cash for an order can be written once: a repeat of the same call cannot add it twice.
      await ledger().createIndex({ orderId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: "collected" }, name: "one_collection_per_order" });
      await ledger().createIndex({ orderId: 1 });
      await ledger().createIndex({ riderId: 1, at: -1 });
      await ledger().createIndex({ warehouseId: 1, at: -1 });
      await balances().createIndex({ riderId: 1 });
      await balances().createIndex({ warehouseId: 1 });
      await recon().createIndex({ orderId: 1, type: 1 }, { unique: true, partialFilterExpression: { status: "open" }, name: "one_open_item_per_order_and_type" });
      await recon().createIndex({ status: 1, warehouseId: 1, at: -1 });
      await recon().createIndex({ riderId: 1, status: 1 });
    },

    async post(entry, options = {}) {
      const id = newId();
      const at = entry.at;
      try {
        return await inTransaction(async session => {
          const key = `${entry.riderId}:${entry.warehouseId}`;
          if (options.limit && entry.amount < 0) {
            const moved = await balances().updateOne({ _id: key, amount: { $gte: -entry.amount } }, { $inc: { amount: entry.amount }, $set: { updatedAt: at } }, { session });
            if (moved.matchedCount === 0) throw new InsufficientCashError((await balances().findOne({ _id: key }, { session }))?.amount ?? 0);
          } else {
            await balances().updateOne({ _id: key }, { $inc: { amount: entry.amount }, $set: { updatedAt: at }, $setOnInsert: { riderId: entry.riderId, warehouseId: entry.warehouseId } }, { upsert: true, session });
          }
          const total = await totals().findOneAndUpdate(
            { _id: entry.riderId },
            entry.type === "deposit"
              ? { $inc: { total: entry.amount }, $set: { updatedAt: at, lastDepositAt: at } }
              : { $inc: { total: entry.amount }, $set: { updatedAt: at }, $setOnInsert: { lastDepositAt: null } },
            { upsert: true, returnDocument: "after", session },
          );
          const doc: LedgerDoc = { _id: id, ...entry, balanceAfter: total?.total ?? entry.amount };
          await ledger().insertOne(doc, { session });
          for (const item of options.reconciliations ?? []) {
            await recon().updateOne(
              { orderId: item.orderId, type: item.type, status: "open" },
              { $setOnInsert: { ...item, status: "open", outcome: null, note: null, bankReference: null, resolvedBy: null, resolvedAt: null, _id: newId() } },
              { upsert: true, session },
            );
          }
          return toEntry(doc);
        });
      } catch (error) {
        if (entry.type === "collected" && (error as { code?: number } | null)?.code === 11000) throw new DuplicateCollectionError();
        throw error;
      }
    },

    async collectedFor(orderId) { const doc = await ledger().findOne({ orderId, type: "collected" }); return doc ? toEntry(doc) : null; },
    async netForOrder(orderId) {
      const rows = await ledger().aggregate<{ total: number }>([{ $match: { orderId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray();
      return rows[0]?.total ?? 0;
    },
    async listLedger(filter, limit, beforeId) {
      const query: Record<string, unknown> = { ...before(beforeId) };
      if (filter.riderId) query.riderId = filter.riderId;
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      if (filter.type) query.type = filter.type;
      if (filter.from || filter.to) query.at = { ...(filter.from && { $gte: filter.from }), ...(filter.to && { $lte: filter.to }) };
      return (await ledger().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(toEntry);
    },
    async entriesSince(riderId, since) { return (await ledger().find({ riderId, at: { $gte: since } }).sort({ _id: -1 }).toArray()).map(toEntry); },

    async balanceOf(riderId) {
      const rows = await balances().find({ riderId }).toArray();
      const total = await totals().findOne({ _id: riderId });
      return toBalances(rows, new Map([[riderId, total?.lastDepositAt ?? null]]))[0] ?? { riderId, total: 0, byWarehouse: [], lastDepositAt: total?.lastDepositAt ?? null };
    },
    async balances(filter) {
      const query: Record<string, unknown> = {};
      if (filter.riderIds) query.riderId = { $in: [...filter.riderIds] };
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      const rows = await balances().find(query).toArray();
      const riderIds = [...new Set(rows.map(r => r.riderId))];
      const deposits = new Map((await totals().find({ _id: { $in: riderIds } }).toArray()).map(t => [t._id, t.lastDepositAt]));
      return toBalances(rows, deposits);
    },

    async openReconciliation(item: NewReconciliation) {
      const found = await recon().findOneAndUpdate(
        { orderId: item.orderId, type: item.type, status: "open" },
        { $setOnInsert: { ...item, status: "open", outcome: null, note: null, bankReference: null, resolvedBy: null, resolvedAt: null, _id: newId() } },
        { upsert: true, returnDocument: "after" },
      );
      return toRecon(found!);
    },
    async getReconciliation(id) { const doc = await recon().findOne({ _id: id }); return doc ? toRecon(doc) : null; },
    async findReconciliation(orderId, type) { const doc = await recon().find({ orderId, type: type as never }).sort({ _id: -1 }).limit(1).next(); return doc ? toRecon(doc) : null; },
    async listReconciliation(filter, limit, beforeId) {
      const query: Record<string, unknown> = { ...before(beforeId) };
      if (filter.type) query.type = filter.type;
      if (filter.status) query.status = filter.status;
      if (filter.warehouseIds) query.warehouseId = { $in: [...filter.warehouseIds] };
      if (filter.riderId) query.riderId = filter.riderId;
      return (await recon().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(toRecon);
    },
    openCount(warehouseIds) { return recon().countDocuments({ status: "open", ...(warehouseIds && { warehouseId: { $in: [...warehouseIds] } }) }); },
    async closeReconciliation(id, patch) {
      const done = await recon().updateOne({ _id: id, status: "open" }, { $set: { status: "resolved", outcome: patch.outcome, note: patch.note, bankReference: patch.bankReference, resolvedBy: patch.by, resolvedAt: patch.at } });
      return done.modifiedCount === 1;
    },
    async reopenReconciliation(id) {
      await recon().updateOne({ _id: id }, { $set: { status: "open", outcome: null, note: null, bankReference: null, resolvedBy: null, resolvedAt: null } });
    },
  };
}
