import { Types, type ClientSession, type Connection } from "mongoose";
import type { CustomerDetail, CustomerRow, CustomerStore, Outcome } from "../application/ports.js";
import { escapeRegex, NO_STATS, REQUIRED_STATUS, searchFilter, STATUSES, type Customer, type CustomerStats, type CustomerStatus } from "../domain/customer.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;
const OBJECT_ID = /^[a-f0-9]{24}$/;
const PLACED = { $nin: ["PENDING_PAYMENT", "CANCELLED"] };
const IN_PROGRESS = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "FAILED_DELIVERY"];
const ORDER_TOTAL = { $add: [{ $subtract: ["$itemsSubtotal", "$allocatedDiscount"] }, { $sum: { $map: { input: { $filter: { input: "$allocatedCharges", cond: { $ne: ["$$this.type", "tip"] } } }, in: "$$this.amount" } } }] };
const inScope = (ids: readonly string[] | null): Doc => (ids ? { warehouseId: { $in: [...ids] } } : {});

const toCustomer = (d: Doc): Customer => ({
  id: String(d._id), name: d.name ?? "", phone: d.phone ?? null, status: (STATUSES as readonly string[]).includes(d.status) ? (d.status as CustomerStatus) : "active", codAllowed: d.codAllowed ?? true,
  blockedReason: d.blockedReason ?? null, notes: Array.isArray(d.internalNotes) ? d.internalNotes.map((n: Doc) => ({ text: String(n.text), by: String(n.by), at: n.at as Date })) : [],
  deletionRequestedAt: d.deletionRequest?.requestedAt ?? null, createdAt: d.createdAt ?? null,
});

export function createMongoCustomerStore(connection: Connection): CustomerStore {
  const users = () => connection.collection("users");
  const orders = () => connection.collection("orders");
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  const oid = (id: string) => new Types.ObjectId(id);

  async function statsFor(ids: readonly string[], warehouseIds: readonly string[] | null): Promise<Map<string, CustomerStats>> {
    if (ids.length === 0) return new Map();
    const rows = await orders().aggregate([
      { $match: { userId: { $in: [...ids] }, status: PLACED, ...inScope(warehouseIds) } },
      { $group: { _id: "$userId", orderCount: { $sum: 1 }, lifetimeValue: { $sum: ORDER_TOTAL }, lastOrderAt: { $max: "$createdAt" } } },
    ]).toArray();
    return new Map(rows.map(r => [String(r._id), { orderCount: r.orderCount, lifetimeValue: r.lifetimeValue, lastOrderAt: r.lastOrderAt ?? null }]));
  }

  async function load(id: string, session: ClientSession): Promise<Customer | null> {
    if (!OBJECT_ID.test(id)) return null;
    const doc = await users().findOne({ _id: oid(id), kind: "customer" }, { session });
    return doc ? toCustomer(doc) : null;
  }

  return {
    async list(query) {
      const filter: Doc = { kind: "customer" };
      if (query.status) filter.status = query.status;
      if (query.codAllowed !== undefined) filter.codAllowed = query.codAllowed ? { $ne: false } : false;
      if (query.q) {
        const search = searchFilter(query.q);
        if ("phone" in search) filter.phone = search.phone;
        else filter.name = { $regex: `^${escapeRegex(search.namePrefix)}`, $options: "i" };
      }
      if (query.warehouseIds) {
        const ids = (await orders().distinct("userId", { warehouseId: { $in: [...query.warehouseIds] } })).filter((id): id is string => typeof id === "string" && OBJECT_ID.test(id));
        filter._id = { $in: ids.map(oid) };
      }
      if (query.cursor) {
        if (!OBJECT_ID.test(query.cursor)) return { rows: [], nextCursor: null };
        filter._id = { ...(filter._id as Doc | undefined), $lt: oid(query.cursor) };
      }
      const docs = await users().find(filter).sort({ _id: -1 }).limit(query.limit + 1).toArray();
      const page = docs.slice(0, query.limit);
      const stats = await statsFor(page.map(d => String(d._id)), query.warehouseIds);
      return {
        rows: page.map(d => ({ customer: toCustomer(d), stats: stats.get(String(d._id)) ?? NO_STATS })),
        nextCursor: docs.length > query.limit ? String(page[page.length - 1]!._id) : null,
      };
    },

    async get(id, warehouseIds): Promise<CustomerDetail | null> {
      if (!OBJECT_ID.test(id)) return null;
      const doc = await users().findOne({ _id: oid(id), kind: "customer" });
      if (!doc) return null;
      const [stats, addresses, recent] = await Promise.all([
        statsFor([id], warehouseIds),
        connection.collection("addresses").find({ userId: id }).sort({ isDefault: -1, createdAt: -1 }).limit(50).toArray(),
        orders().aggregate([{ $match: { userId: id, ...inScope(warehouseIds) } }, { $sort: { createdAt: -1 } }, { $limit: 10 }, { $addFields: { total: ORDER_TOTAL } }]).toArray(),
      ]);
      return {
        customer: toCustomer(doc), stats: stats.get(id) ?? NO_STATS,
        addresses: addresses.map(a => ({ id: String(a._id), label: String(a.label ?? ""), line1: String(a.line1 ?? ""), landmark: String(a.landmark ?? ""), locality: String(a.localityName ?? ""), pincode: String(a.pincode ?? ""), contactName: String(a.contactName ?? ""), contactPhone: String(a.contactPhone ?? ""), isDefault: a.isDefault === true, isDeliverable: a.isDeliverable === true })),
        recentOrders: recent.map(o => ({ id: String(o._id), orderNo: String(o.orderNo), status: String(o.status), warehouseId: String(o.warehouseId), total: o.total, createdAt: o.createdAt })),
      };
    },

    async all(limit): Promise<CustomerRow[]> {
      const docs = await users().find({ kind: "customer" }).sort({ _id: -1 }).limit(limit).toArray();
      const stats = await statsFor(docs.map(d => String(d._id)), null);
      return docs.map(d => ({ customer: toCustomer(d), stats: stats.get(String(d._id)) ?? NO_STATS }));
    },

    async staffName(userId) {
      if (!OBJECT_ID.test(userId)) return null;
      const doc = await users().findOne({ _id: oid(userId) }, { projection: { name: 1 } });
      return doc && typeof doc.name === "string" && doc.name ? doc.name : null;
    },

    async edit({ id, codAllowed, note, at }) {
      return inTransaction(async (session): Promise<Outcome<Customer>> => {
        const before = await load(id, session);
        if (!before) return { ok: false, reason: "not_found" };
        const set: Doc = { updatedAt: at };
        if (codAllowed !== undefined) set.codAllowed = codAllowed;
        await users().updateOne({ _id: oid(id) }, { $set: set, ...(note && { $push: { internalNotes: { text: note.text, by: note.by, at } } }) } as never, { session });
        const after = (await load(id, session))!;
        return { ok: true, value: after };
      });
    },

    async transition({ id, action, reason, by, at }) {
      return inTransaction(async (session): Promise<Outcome<Customer>> => {
        const before = await load(id, session);
        if (!before) return { ok: false, reason: "not_found" };
        if (before.status !== REQUIRED_STATUS[action]) return { ok: false, reason: "wrong_status" };
        // Sessions stop working because only active customers are accepted; the revision bump also invalidates tokens already issued.
        const update = action === "block"
          ? { $set: { status: "blocked", blockedReason: reason, blockedAt: at, blockedBy: by, updatedAt: at }, $inc: { credentialRevision: 1 } }
          : { $set: { status: "active", updatedAt: at }, $unset: { blockedReason: "", blockedAt: "", blockedBy: "" } };
        const result = await users().updateOne({ _id: oid(id), kind: "customer", status: REQUIRED_STATUS[action] }, update, { session });
        if (result.matchedCount === 0) return { ok: false, reason: "wrong_status" };
        const after = (await load(id, session))!;
        return { ok: true, value: after };
      });
    },

    async finalise({ id, by, at }) {
      return inTransaction(async (session): Promise<Outcome<{ customer: Customer; addressIds: string[] }>> => {
        const doc = OBJECT_ID.test(id) ? await users().findOne({ _id: oid(id), kind: "customer" }, { session }) : null;
        if (!doc) return { ok: false, reason: "not_found" };
        const before = toCustomer(doc);
        if (before.status !== REQUIRED_STATUS.finalise) return { ok: false, reason: "wrong_status" };
        if ((await orders().countDocuments({ userId: id, status: { $in: IN_PROGRESS } }, { session, limit: 1 })) > 0) return { ok: false, reason: "has_active_orders" };
        const addresses = await connection.collection("addresses").find({ userId: id }, { session, projection: { _id: 1 } }).toArray();
        const phone = typeof doc.phone === "string" ? doc.phone : null;
        const result = await users().updateOne({ _id: oid(id), kind: "customer", status: "deletion_requested" }, {
          $set: {
            name: "Deleted customer", status: "deleted", codAllowed: false, updatedAt: at, "deletionRequest.finalisedAt": at, "deletionRequest.finalisedBy": by,
            notificationPrefs: { promoPush: false, promoWhatsApp: false, cartReminders: false },
          },
          // Phone and email are removed so the number can register again; the partial unique indexes only cover text values.
          $unset: { phone: "", email: "", defaultAddressId: "", internalNotes: "", blockedReason: "", blockedAt: "", blockedBy: "" },
          $inc: { credentialRevision: 1 },
        }, { session });
        if (result.matchedCount === 0) return { ok: false, reason: "wrong_status" };
        await connection.collection("addresses").deleteMany({ userId: id }, { session });
        await connection.collection("carts").deleteMany({ userId: id }, { session });
        await connection.collection("device_tokens").deleteMany({ userId: doc._id }, { session });
        await connection.collection("device_tokens").deleteMany({ userId: id }, { session });
        await connection.collection("notification_prefs").deleteMany({ userId: id }, { session });
        await connection.collection("otps").deleteMany({ $or: [{ userId: doc._id }, ...(phone ? [{ phone }] : [])] }, { session });
        await connection.collection("stock_subscriptions").updateMany({ userId: id, status: "waiting" }, { $set: { status: "cancelled", cancelledAt: at, updatedAt: at } }, { session });
        const after = (await load(id, session))!;
        return { ok: true, value: { customer: after, addressIds: addresses.map(a => String(a._id)) } };
      });
    },

  };
}
