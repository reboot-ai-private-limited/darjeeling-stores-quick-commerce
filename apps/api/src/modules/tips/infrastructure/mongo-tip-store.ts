import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import type { TipFilter, TipRow, TipStore, TipTotals } from "../application/ports.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;
const TIP_OF_ORDER = { $sum: { $map: { input: { $filter: { input: "$o.allocatedCharges", cond: { $eq: ["$$this.type", "tip"] } } }, in: "$$this.amount" } } };

/**
 * Tips are worked out from the deliveries themselves (the order's tip charge, and the rider who delivered it), so they can never drift from
 * the orders. The only thing stored here is which tips the owner has already paid out: one `rider_tip_payments` row per order.
 */
export function createMongoTipStore(connection: Connection): TipStore {
  const writeAudit = createAuditWriter(connection);
  const payments = () => connection.collection("rider_tip_payments");
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }

  /** One row per delivered order that carried a tip. */
  const rows = (f: TipFilter, tail: Doc[] = []): Doc[] => [
    { $match: { outcome: "delivered", completedAt: { $gte: f.start, $lt: f.end }, ...(f.riderId && { riderId: f.riderId }) } },
    { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "o" } }, { $unwind: "$o" },
    ...(f.warehouseIds ? [{ $match: { "o.warehouseId": { $in: [...f.warehouseIds] } } }] : []),
    { $addFields: { tip: TIP_OF_ORDER } }, { $match: { tip: { $gt: 0 } } },
    { $lookup: { from: "rider_tip_payments", localField: "orderId", foreignField: "_id", as: "p" } },
    { $addFields: { paid: { $gt: [{ $size: "$p" }, 0] }, paidAt: { $first: "$p.paidAt" } } },
    ...tail,
  ];
  const aggregate = (pipeline: Doc[], session?: ClientSession) => connection.collection("assignments").aggregate(pipeline, session ? { session } : {}).toArray();
  const toTotals = (d: Doc | undefined): TipTotals => ({ count: d?.count ?? 0, total: d?.total ?? 0, owed: d?.owed ?? 0, paid: d?.paid ?? 0 });
  const GROUP = {
    count: { $sum: 1 }, total: { $sum: "$tip" },
    owed: { $sum: { $cond: ["$paid", 0, "$tip"] } }, paid: { $sum: { $cond: ["$paid", "$tip", 0] } },
  };

  return {
    async list(f) {
      const docs = await aggregate(rows(f, [
        ...(f.status ? [{ $match: { paid: f.status === "paid" } }] : []),
        { $sort: { completedAt: -1, orderId: 1 } }, { $limit: f.limit },
      ]));
      return docs.map((d): TipRow => ({
        orderId: String(d.orderId), orderNo: String(d.o.orderNo), riderId: String(d.riderId), warehouseId: String(d.o.warehouseId), amount: d.tip,
        deliveredAt: d.completedAt, status: d.paid ? "paid" : "owed", paidAt: d.paidAt ?? null,
      }));
    },

    async totals(f) { return toTotals((await aggregate(rows(f, [{ $group: { _id: null, ...GROUP } }])))[0]); },

    async byRider(f) {
      const grouped = await aggregate(rows(f, [{ $group: { _id: "$riderId", ...GROUP } }, { $sort: { owed: -1, _id: 1 } }]));
      const names = new Map((await connection.collection("riders").find({ _id: { $in: grouped.map(g => String(g._id)) } as never }, { projection: { name: 1 } }).toArray()).map(r => [String(r._id), String(r.name ?? "")]));
      return grouped.map(g => ({ riderId: String(g._id), riderName: names.get(String(g._id)) ?? "", ...toTotals(g) }));
    },

    async pay({ riderId, orderIds, before, warehouseIds, by, note, at, audit }) {
      return inTransaction(async session => {
        const wide = { start: new Date(0), end: new Date(8_640_000_000_000_000), riderId, warehouseIds };
        const owed = (await aggregate(rows(wide, [{ $match: { paid: false } }]), session))
          .filter(d => (orderIds ? orderIds.includes(String(d.orderId)) : before ? d.completedAt < before : false));
        if (owed.length === 0) return { count: 0, amount: 0 };
        const amount = owed.reduce((sum, d) => sum + (d.tip as number), 0);
        await payments().insertMany(owed.map(d => ({ _id: String(d.orderId) as never, riderId, amount: d.tip, warehouseId: String(d.o.warehouseId), paidAt: at, paidBy: by, note })), { session });
        await writeAudit(audit({ count: owed.length, amount }), session);
        return { count: owed.length, amount };
      });
    },
  };
}
