import { Types, type Connection } from "mongoose";
import type { Dashboard, DashboardFilter, DashboardStore } from "../application/ports.js";
import { average, type ReportDef, type ReportParams, type ReportTable } from "../domain/reports.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Document = Record<string, any>;

/** What the shop earns on one order: items less its share of the discount, plus its share of the fees. A rider tip is not counted. Paise. */
const ORDER_TOTAL = { $add: [{ $subtract: ["$itemsSubtotal", "$allocatedDiscount"] }, { $sum: { $map: { input: { $filter: { input: "$allocatedCharges", cond: { $ne: ["$$this.type", "tip"] } } }, in: "$$this.amount" } } }] };
/** An order counts as sold once it is placed and not cancelled. Orders still waiting for online payment are not sales yet. */
const SOLD = { $nin: ["PENDING_PAYMENT", "CANCELLED"] };
const ACTIVE = ["PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "FAILED_DELIVERY"];
const IST = "Asia/Kolkata";
const inScope = (field: string, ids: readonly string[] | null): Document => (ids ? { [field]: { $in: [...ids] } } : {});
const day = (field: string): Document => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: IST } });
const oid = (ids: readonly string[]) => ids.filter(id => /^[a-f0-9]{24}$/.test(id)).map(id => new Types.ObjectId(id));

export function createMongoReportStore(connection: Connection): { dashboard: DashboardStore; reports: ReportDef[] } {
  const col = (name: string) => connection.collection(name);
  const aggregate = (name: string, pipeline: Document[]) => col(name).aggregate(pipeline).toArray();
  /** Names for a set of ids from a collection whose `_id` is a string. */
  async function names(collection: string, ids: readonly string[], field = "name"): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const docs = await col(collection).find({ _id: { $in: [...ids] } as never }, { projection: { [field]: 1 } }).toArray();
    return new Map(docs.map(d => [String(d._id), String(d[field] ?? d._id)]));
  }
  async function warehouseNames(ids: readonly string[]): Promise<Map<string, string>> {
    const valid = oid(ids);
    if (valid.length === 0) return new Map();
    const docs = await col("warehouses").find({ _id: { $in: valid } }, { projection: { name: 1 } }).toArray();
    return new Map(docs.map(d => [String(d._id), String(d.name)]));
  }
  const table = (columns: string[], rows: ReportTable["rows"]): ReportTable => ({ columns, rows });
  const orderMatch = ({ range, warehouseIds }: ReportParams, extra: Document = {}): Document =>
    ({ createdAt: { $gte: range.start, $lt: range.end }, ...inScope("warehouseId", warehouseIds), ...extra });

  const dashboard: DashboardStore = {
    async dashboard(f: DashboardFilter): Promise<Dashboard> {
      const scope = inScope("warehouseId", f.warehouseIds);
      const today = await aggregate("orders", [
        { $match: { ...scope, createdAt: { $gte: f.start, $lt: f.end }, status: { $ne: "PENDING_PAYMENT" } } },
        { $group: { _id: { warehouseId: "$warehouseId", status: "$status" }, orders: { $sum: 1 }, revenue: { $sum: ORDER_TOTAL } } },
      ]);
      const perWarehouse = new Map<string, { orders: number; revenue: number }>();
      let placed = 0, delivered = 0, cancelled = 0, revenue = 0;
      for (const row of today) {
        placed += row.orders;
        if (row._id.status === "DELIVERED") delivered += row.orders;
        const gone = row._id.status === "CANCELLED";
        if (gone) cancelled += row.orders; else revenue += row.revenue;
        const entry = perWarehouse.get(row._id.warehouseId) ?? { orders: 0, revenue: 0 };
        entry.orders += row.orders; if (!gone) entry.revenue += row.revenue;
        perWarehouse.set(row._id.warehouseId, entry);
      }
      const delayedBefore = new Date(f.now.getTime() - f.delayedAfterMinutes * 60_000);
      const [active, delayed, riderRows, pendingRefunds, lowStock, offline, reconciliation, cash, unacked] = await Promise.all([
        col("orders").countDocuments({ ...scope, status: { $in: ACTIVE } }),
        col("orders").countDocuments({ ...scope, status: { $in: ACTIVE }, scheduledWindow: null, promisedAt: { $lt: delayedBefore } }),
        aggregate("riders", [{ $match: { isActive: true, ...(f.warehouseIds ? { warehouseIds: { $in: [...f.warehouseIds] } } : {}) } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
        col("refunds").countDocuments({ ...scope, status: { $in: ["requested", "approved"] } }),
        col("warehouse_products").countDocuments({
          ...scope, status: "active",
          $or: [{ stockGrams: { $lt: f.lowStock.grams } }, { variants: { $elemMatch: { isActive: true, stock: { $lt: f.lowStock.units } } } }],
        }),
        col("offline_reviews").countDocuments({ ...scope, status: "open" }),
        col("cash_reconciliation").countDocuments({ ...scope, status: "open" }),
        aggregate("cash_balances", [{ $match: scope }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
        aggregate("assignments", [
          { $match: { live: true, status: "assigned", ackAt: null } },
          ...(f.warehouseIds ? [{ $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "o" } }, { $match: { "o.warehouseId": { $in: [...f.warehouseIds] } } }] : []),
          { $count: "n" },
        ]),
      ]);
      const riders = { online: 0, onBreak: 0, offline: 0 };
      for (const r of riderRows) { if (r._id === "online") riders.online = r.n; else if (r._id === "on_break") riders.onBreak = r.n; else riders.offline += r.n; }
      return {
        date: f.date, orders: { today: placed, active, delivered, cancelled }, revenue: { today: revenue }, riders, pendingRefunds, lowStock,
        offlineDeliveryReviews: offline, reconciliationOpen: reconciliation, riderCashOutstanding: cash[0]?.total ?? 0, unacknowledgedAssignments: unacked[0]?.n ?? 0, delayedOrders: delayed,
        byWarehouse: [...perWarehouse].map(([warehouseId, v]) => ({ warehouseId, ...v })).sort((a, b) => b.revenue - a.revenue || a.warehouseId.localeCompare(b.warehouseId)),
      };
    },
  };

  const sales: ReportDef = {
    name: "sales", title: "Sales", groupBy: ["day", "warehouse", "product", "category"], defaultGroupBy: "day",
    async run(p) {
      if (p.groupBy === "product" || p.groupBy === "category") {
        const byCategory = p.groupBy === "category";
        const rows = await aggregate("orders", [
          { $match: orderMatch(p, { status: SOLD }) }, { $unwind: "$items" }, { $match: { "items.status": { $ne: "unavailable" } } },
          ...(byCategory ? [{ $lookup: { from: "products", localField: "items.productId", foreignField: "_id", as: "p" } }] : []),
          { $group: { _id: byCategory ? { $ifNull: [{ $first: "$p.categoryId" }, "unknown"] } : "$items.productId", units: { $sum: "$items.qty" }, revenue: { $sum: "$items.lineTotal" }, orders: { $addToSet: "$_id" } } },
          { $sort: { revenue: -1, _id: 1 } },
        ]);
        const label = await names(byCategory ? "categories" : "products", rows.map(r => String(r._id)));
        return table([byCategory ? "category" : "product", "orders", "units", "revenue"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.orders.length, r.units, r.revenue]));
      }
      const byWarehouse = p.groupBy === "warehouse";
      const rows = await aggregate("orders", [
        { $match: orderMatch(p, { status: SOLD }) },
        { $group: { _id: byWarehouse ? "$warehouseId" : day("$createdAt"), orders: { $sum: 1 }, revenue: { $sum: ORDER_TOTAL } } }, { $sort: { _id: 1 } },
      ]);
      const label = byWarehouse ? await warehouseNames(rows.map(r => String(r._id))) : new Map<string, string>();
      return table([byWarehouse ? "warehouse" : "date", "orders", "revenue", "avgOrderValue"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.orders, r.revenue, average(r.revenue, r.orders)]));
    },
  };

  const funnel: ReportDef = {
    name: "order-funnel", title: "Order funnel", groupBy: ["status", "warehouse"], defaultGroupBy: "status",
    async run(p) {
      const byWarehouse = p.groupBy === "warehouse";
      const rows = await aggregate("orders", [
        { $match: orderMatch(p) },
        { $group: { _id: byWarehouse ? { w: "$warehouseId", s: "$status" } : { s: "$status" }, orders: { $sum: 1 } } }, { $sort: { "_id.w": 1, "_id.s": 1 } },
      ]);
      if (!byWarehouse) return table(["status", "orders"], rows.map(r => [r._id.s, r.orders]));
      const label = await warehouseNames(rows.map(r => String(r._id.w)));
      return table(["warehouse", "status", "orders"], rows.map(r => [label.get(String(r._id.w)) ?? String(r._id.w), r._id.s, r.orders]));
    },
  };

  const codCash: ReportDef = {
    name: "cod-cash", title: "Cash on delivery collections", groupBy: ["rider", "day", "warehouse"], defaultGroupBy: "rider",
    async run(p) {
      const key = p.groupBy === "rider" ? "$riderId" : p.groupBy === "warehouse" ? "$warehouseId" : day("$at");
      const rows = await aggregate("cash_ledger", [
        { $match: { at: { $gte: p.range.start, $lt: p.range.end }, ...inScope("warehouseId", p.warehouseIds) } },
        { $group: { _id: key,
          collected: { $sum: { $cond: [{ $eq: ["$type", "collected"] }, "$amount", 0] } },
          deposited: { $sum: { $cond: [{ $eq: ["$type", "deposit"] }, { $multiply: ["$amount", -1] }, 0] } },
          adjusted: { $sum: { $cond: [{ $eq: ["$type", "adjustment"] }, "$amount", 0] } }, net: { $sum: "$amount" } } },
        { $sort: { _id: 1 } },
      ]);
      const label = p.groupBy === "rider" ? await names("riders", rows.map(r => String(r._id))) : p.groupBy === "warehouse" ? await warehouseNames(rows.map(r => String(r._id))) : new Map<string, string>();
      return table([p.groupBy === "day" ? "date" : p.groupBy, "collected", "deposited", "adjusted", "net"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.collected, r.deposited, r.adjusted, r.net]));
    },
  };

  const riderDeliveries: ReportDef = {
    name: "rider-deliveries", title: "Rider deliveries", groupBy: ["rider", "day"], defaultGroupBy: "rider",
    async run(p) {
      const rows = await aggregate("assignments", [
        { $match: { outcome: { $in: ["delivered", "failed"] }, completedAt: { $gte: p.range.start, $lt: p.range.end } } },
        ...(p.warehouseIds ? [{ $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "o" } }, { $match: { "o.warehouseId": { $in: [...p.warehouseIds] } } }] : []),
        { $group: { _id: p.groupBy === "rider" ? "$riderId" : day("$completedAt"),
          deliveries: { $sum: { $cond: [{ $eq: ["$outcome", "delivered"] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ["$outcome", "failed"] }, 1, 0] } },
          minutes: { $sum: { $cond: [{ $eq: ["$outcome", "delivered"] }, { $divide: [{ $subtract: ["$completedAt", "$assignedAt"] }, 60_000] }, 0] } } } },
        { $sort: { _id: 1 } },
      ]);
      const label = p.groupBy === "rider" ? await names("riders", rows.map(r => String(r._id))) : new Map<string, string>();
      return table([p.groupBy === "rider" ? "rider" : "date", "deliveries", "failed", "avgMinutes"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.deliveries, r.failed, average(r.minutes, r.deliveries)]));
    },
  };

  const deliveryTime: ReportDef = {
    name: "delivery-time", title: "Promised versus actual delivery time", groupBy: ["warehouse", "day"], defaultGroupBy: "warehouse",
    async run(p) {
      const rows = await aggregate("orders", [
        { $match: { status: "DELIVERED", "stamps.deliveredAt": { $gte: p.range.start, $lt: p.range.end }, ...inScope("warehouseId", p.warehouseIds) } },
        { $group: { _id: { g: p.groupBy === "warehouse" ? "$warehouseId" : day("$stamps.deliveredAt"), hour: { $hour: { date: "$createdAt", timezone: IST } } },
          delivered: { $sum: 1 }, onTime: { $sum: { $cond: [{ $lte: ["$stamps.deliveredAt", "$promisedAt"] }, 1, 0] } },
          promised: { $sum: { $divide: [{ $subtract: ["$promisedAt", "$createdAt"] }, 60_000] } }, actual: { $sum: { $divide: [{ $subtract: ["$stamps.deliveredAt", "$createdAt"] }, 60_000] } } } },
        { $sort: { "_id.g": 1, "_id.hour": 1 } },
      ]);
      const label = p.groupBy === "warehouse" ? await warehouseNames(rows.map(r => String(r._id.g))) : new Map<string, string>();
      return table([p.groupBy === "warehouse" ? "warehouse" : "date", "hour", "delivered", "onTime", "avgPromisedMinutes", "avgActualMinutes"],
        rows.map(r => [label.get(String(r._id.g)) ?? String(r._id.g), r._id.hour, r.delivered, r.onTime, average(r.promised, r.delivered), average(r.actual, r.delivered)]));
    },
  };

  const wastage: ReportDef = {
    name: "stock-wastage", title: "Stock wastage", groupBy: ["product", "warehouse", "day"], defaultGroupBy: "product",
    async run(p) {
      const key = p.groupBy === "product" ? "$productId" : p.groupBy === "warehouse" ? "$warehouseId" : day("$createdAt");
      const rows = await aggregate("stock_movements", [
        { $match: { reason: "wastage", createdAt: { $gte: p.range.start, $lt: p.range.end }, ...inScope("warehouseId", p.warehouseIds) } },
        { $group: { _id: key, entries: { $sum: 1 },
          grams: { $sum: { $cond: [{ $eq: ["$mode", "grams"] }, { $multiply: ["$delta", -1] }, 0] } }, units: { $sum: { $cond: [{ $eq: ["$mode", "units"] }, { $multiply: ["$delta", -1] }, 0] } } } },
        { $sort: { _id: 1 } },
      ]);
      const label = p.groupBy === "product" ? await names("products", rows.map(r => String(r._id))) : p.groupBy === "warehouse" ? await warehouseNames(rows.map(r => String(r._id))) : new Map<string, string>();
      return table([p.groupBy === "day" ? "date" : p.groupBy, "entries", "gramsLost", "unitsLost"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.entries, r.grams, r.units]));
    },
  };

  const surcharges: ReportDef = {
    name: "surcharge-income", title: "Surcharge income", groupBy: ["day", "warehouse"], defaultGroupBy: "day",
    async run(p) {
      const rows = await aggregate("orders", [
        { $match: orderMatch(p, { status: SOLD }) }, { $unwind: "$allocatedCharges" }, { $match: { "allocatedCharges.type": { $regex: "^surcharge_" } } },
        { $group: { _id: p.groupBy === "warehouse" ? "$warehouseId" : day("$createdAt"),
          rain: { $sum: { $cond: [{ $eq: ["$allocatedCharges.type", "surcharge_rain"] }, "$allocatedCharges.amount", 0] } },
          lateNight: { $sum: { $cond: [{ $eq: ["$allocatedCharges.type", "surcharge_late_night"] }, "$allocatedCharges.amount", 0] } },
          other: { $sum: { $cond: [{ $eq: ["$allocatedCharges.type", "surcharge_other"] }, "$allocatedCharges.amount", 0] } }, total: { $sum: "$allocatedCharges.amount" } } },
        { $sort: { _id: 1 } },
      ]);
      const label = p.groupBy === "warehouse" ? await warehouseNames(rows.map(r => String(r._id))) : new Map<string, string>();
      return table([p.groupBy === "warehouse" ? "warehouse" : "date", "rain", "lateNight", "other", "total"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.rain, r.lateNight, r.other, r.total]));
    },
  };

  const notifyDemand: ReportDef = {
    name: "notify-demand", title: "Notify Me demand", groupBy: ["product"], defaultGroupBy: "product",
    async run(p) {
      // Subscriptions belong to a zone, so scoped staff see the zones their warehouses are in.
      let zoneFilter: Document = {};
      if (p.warehouseIds) {
        const docs = await col("warehouses").find({ _id: { $in: oid(p.warehouseIds) } }, { projection: { zoneId: 1 } }).toArray();
        zoneFilter = { zoneId: { $in: [...new Set(docs.map(d => String(d.zoneId)))] } };
      }
      const rows = await aggregate("stock_subscriptions", [
        { $match: { status: "waiting", createdAt: { $gte: p.range.start, $lt: p.range.end }, ...zoneFilter } },
        { $group: { _id: "$productId", waiting: { $sum: 1 }, customers: { $addToSet: "$userId" } } }, { $sort: { waiting: -1, _id: 1 } },
      ]);
      const label = await names("products", rows.map(r => String(r._id)));
      return table(["product", "waiting", "customers"], rows.map(r => [label.get(String(r._id)) ?? String(r._id), r.waiting, r.customers.length]));
    },
  };

  const couponUsage: ReportDef = {
    name: "coupon-usage", title: "Coupon usage", groupBy: ["coupon"], defaultGroupBy: "coupon",
    async run(p) {
      const rows = await aggregate("orders", [
        { $match: orderMatch(p, { status: SOLD, allocatedDiscount: { $gt: 0 } }) },
        { $lookup: { from: "order_groups", localField: "groupId", foreignField: "_id", as: "g" } },
        { $unwind: "$g" }, { $match: { "g.couponCode": { $type: "string" } } },
        { $group: { _id: "$g.couponCode", orders: { $sum: 1 }, discount: { $sum: "$allocatedDiscount" }, groups: { $addToSet: "$groupId" } } }, { $sort: { discount: -1, _id: 1 } },
      ]);
      return table(["coupon", "uses", "orders", "discount"], rows.map(r => [String(r._id), r.groups.length, r.orders, r.discount]));
    },
  };

  return { dashboard, reports: [sales, funnel, codCash, riderDeliveries, deliveryTime, wastage, surcharges, notifyDemand, couponUsage] };
}
