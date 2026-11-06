import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter, type AuditEvent } from "../../audit/audit.public.js";
import type { Banner, Coupon, FeeRule, Rule } from "../domain/pricing.js";
import { ActiveRuleExistsError, CouponLimitError, DuplicateCodeError, type Audited, type PricingStore, type Usage } from "../application/ports.js";

type Doc<T extends { id: string }> = Omit<T, "id"> & { _id: string };
const wrap = <T extends { id: string }>({ id, ...rest }: T): Doc<T> => ({ _id: id, ...rest } as Doc<T>);
const unwrap = <T extends { id: string }>({ _id, ...rest }: Doc<T>): T => ({ id: _id, ...rest } as unknown as T);
const strip = <T extends { id?: string }>(patch: T): Omit<T, "id"> => { const { id: _id, ...rest } = patch; return rest; };
const isDuplicate = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

export function createMongoPricingStore(connection: Connection): PricingStore {
  const rules = () => connection.collection<Doc<Rule>>("delivery_rules");
  const coupons = () => connection.collection<Doc<Coupon>>("coupons");
  const usages = () => connection.collection<Doc<Usage>>("coupon_usage");
  const userCounts = () => connection.collection<{ _id: string; count: number }>("coupon_user_counts");
  const banners = () => connection.collection<Doc<Banner>>("banners");
  const writeAudit = createAuditWriter(connection);

  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }
  const audited = async <T>(options: Audited | undefined, fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> =>
    options?.audit ? inTransaction(async session => { const result = await fn(session); await writeAudit(options.audit!, session); return result; }) : fn(undefined);

  const store: PricingStore = {
    async ensureIndexes() {
      // One active delivery-fee rule per zone, enforced by the database.
      await rules().createIndex({ zoneIds: 1 }, { unique: true, partialFilterExpression: { type: "delivery_fee", isActive: true }, name: "one_active_fee_rule_per_zone" });
      await rules().createIndex({ type: 1, isActive: 1 });
      await coupons().createIndex({ code: 1 }, { unique: true });
      await usages().createIndex({ groupId: 1, couponId: 1 }, { unique: true });
      await usages().createIndex({ couponId: 1, at: -1 });
      await banners().createIndex({ isActive: 1, sortOrder: 1 });
    },

    async insertRule(rule, options) {
      try { await audited(options, session => rules().insertOne(wrap(rule) as never, { ...(session && { session }) })); }
      catch (error) { if (isDuplicate(error)) throw new ActiveRuleExistsError((await store.activeFeeRuleOnZones((rule as FeeRule).zoneIds))?.id ?? ""); throw error; }
    },
    async getRule(id) { const doc = await rules().findOne({ _id: id }); return doc ? unwrap<Rule>(doc) : null; },
    async updateRule(id, patch, options) {
      try { return await audited(options, async session => (await rules().updateOne({ _id: id }, { $set: strip(patch) as never }, { ...(session && { session }) })).matchedCount === 1); }
      catch (error) { if (isDuplicate(error)) throw new ActiveRuleExistsError((await store.activeFeeRuleOnZones((patch as Partial<FeeRule>).zoneIds ?? [], id))?.id ?? ""); throw error; }
    },
    async listRules(filter) {
      const query: Record<string, unknown> = {};
      if (filter.type) query.type = filter.type;
      if (filter.isActive !== undefined) query.isActive = filter.isActive;
      if (filter.zoneId) query.$or = [{ zoneIds: filter.zoneId }, { zoneIds: { $size: 0 } }];
      return (await rules().find(query).sort({ _id: 1 }).toArray()).map(d => unwrap<Rule>(d));
    },
    async activeRules() { return (await rules().find({ isActive: true }).toArray()).map(d => unwrap<Rule>(d)); },
    async activeFeeRuleOnZones(zoneIds, exceptId) {
      const doc = await rules().findOne({ type: "delivery_fee", isActive: true, zoneIds: { $in: [...zoneIds] }, ...(exceptId && { _id: { $ne: exceptId } }) });
      return doc ? unwrap<FeeRule>(doc as never) : null;
    },

    async insertCoupon(coupon, options) {
      try { await audited(options, session => coupons().insertOne(wrap(coupon) as never, { ...(session && { session }) })); }
      catch (error) { if (isDuplicate(error)) throw new DuplicateCodeError(); throw error; }
    },
    async getCoupon(id) { const doc = await coupons().findOne({ _id: id }); return doc ? unwrap<Coupon>(doc as never) : null; },
    async getCouponByCode(code) { const doc = await coupons().findOne({ code }); return doc ? unwrap<Coupon>(doc as never) : null; },
    async updateCoupon(id, patch, options) {
      try { return await audited(options, async session => (await coupons().updateOne({ _id: id }, { $set: strip(patch) as never }, { ...(session && { session }) })).matchedCount === 1); }
      catch (error) { if (isDuplicate(error)) throw new DuplicateCodeError(); throw error; }
    },
    async listCoupons(filter, limit, beforeId) {
      const query: Record<string, unknown> = { ...(beforeId && { _id: { $lt: beforeId } }) };
      if (filter.isActive !== undefined) query.isActive = filter.isActive;
      return (await coupons().find(query).sort({ _id: -1 }).limit(limit).toArray()).map(d => unwrap<Coupon>(d as never));
    },
    async availableCoupons(now) {
      const inDate = { $and: [{ $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }, { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }] };
      return (await coupons().find({ isActive: true, ...inDate }).sort({ _id: 1 }).toArray()).map(d => unwrap<Coupon>(d as never));
    },
    async usedByUser(couponId, userId) { return (await userCounts().findOne({ _id: `${couponId}:${userId}` }))?.count ?? 0; },

    async holdCoupon(coupon, usage) {
      try {
        return await inTransaction(async session => {
          // This order already holds the coupon: nothing more to take.
          if (await usages().findOne({ groupId: usage.groupId, couponId: coupon.id }, { session })) return false;
          const taken = await coupons().updateOne(
            { _id: coupon.id, isActive: true, ...(coupon.totalLimit !== null && { usedCount: { $lt: coupon.totalLimit } }) },
            { $inc: { usedCount: 1 } }, { session },
          );
          if (taken.matchedCount === 0) throw new CouponLimitError("limit_reached");
          const key = `${coupon.id}:${usage.userId}`;
          if (coupon.perUserLimit !== null) {
            await userCounts().updateOne({ _id: key }, { $setOnInsert: { count: 0 } }, { upsert: true, session });
            const mine = await userCounts().updateOne({ _id: key, count: { $lt: coupon.perUserLimit } }, { $inc: { count: 1 } }, { session });
            if (mine.matchedCount === 0) throw new CouponLimitError("user_limit_reached");
          } else {
            await userCounts().updateOne({ _id: key }, { $inc: { count: 1 } }, { upsert: true, session });
          }
          await usages().insertOne(wrap(usage) as never, { session });
          return true;
        });
      } catch (error) {
        if (isDuplicate(error)) return false;
        throw error;
      }
    },
    async releaseCoupon(groupId) {
      return inTransaction(async session => {
        const held = await usages().find({ groupId }, { session }).toArray();
        if (held.length === 0) return false;
        for (const usage of held) {
          await usages().deleteOne({ _id: usage._id }, { session });
          await coupons().updateOne({ _id: usage.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
          await userCounts().updateOne({ _id: `${usage.couponId}:${usage.userId}`, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session });
        }
        return true;
      });
    },
    async listUsage(couponId, limit, beforeId) {
      const rows = (await usages().find({ couponId, ...(beforeId && { _id: { $lt: beforeId } }) }).sort({ _id: -1 }).limit(limit).toArray()).map(d => unwrap<Usage>(d as never));
      const sum = await usages().aggregate<{ total: number }>([{ $match: { couponId } }, { $group: { _id: null, total: { $sum: "$discountAmount" } } }]).toArray();
      return { rows, totalDiscount: sum[0]?.total ?? 0 };
    },

    async insertBanner(banner, options) { await audited(options, session => banners().insertOne(wrap(banner) as never, { ...(session && { session }) })); },
    async getBanner(id) { const doc = await banners().findOne({ _id: id }); return doc ? unwrap<Banner>(doc as never) : null; },
    async updateBanner(id, patch, options) { return audited(options, async session => (await banners().updateOne({ _id: id }, { $set: strip(patch) as never }, { ...(session && { session }) })).matchedCount === 1); },
    async deleteBanner(id, options) { return audited(options, async session => (await banners().deleteOne({ _id: id }, { ...(session && { session }) })).deletedCount === 1); },
    async listBanners() { return (await banners().find({}).sort({ sortOrder: 1, _id: 1 }).toArray()).map(d => unwrap<Banner>(d as never)); },
    async activeBannersForZone(zoneId, now) {
      const query = {
        isActive: true, $and: [
          { $or: [{ zoneId: null }, { zoneId }] }, { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
        ],
      };
      return (await banners().find(query).sort({ sortOrder: 1, _id: 1 }).toArray()).map(d => unwrap<Banner>(d as never));
    },
    async recordAudit(entry: AuditEvent) { await inTransaction(session => writeAudit(entry, session)); },
  };
  return store;
}
