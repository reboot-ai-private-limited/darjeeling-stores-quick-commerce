import type { Geography } from "../../../platform/geography.js";
import type { SettingsProvider } from "../../../platform/settings.js";
import { AppError, conflict, forbidden, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import {
  bannerView, computeBill, couponDiscount, couponProblem, couponView, describeCoupon, ruleView, tierProblem, validClock,
  type Banner, type Coupon, type CouponReason, type FeeRule, type Rule, type SurchargeRule, type Tier, type Window,
} from "../domain/pricing.js";
import {
  ActiveRuleExistsError, CouponLimitError, DuplicateCodeError, type BannerMedia, type OrderHistory, type PricingStore,
} from "./ports.js";

export interface PricingSettings {
  /** All surcharges together never exceed this many paise. Null means no cap. */
  surchargeCap: number | null;
  /** Used when the rain switch is turned on and no rain rule exists yet. */
  rainDefaults: { amount: number; extraMinutes: number };
}
export const DEFAULT_PRICING_SETTINGS: PricingSettings = { surchargeCap: 5000, rainDefaults: { amount: 1500, extraMinutes: 10 } };

export interface PricingDeps {
  store: PricingStore; geography: Geography; media: BannerMedia; orders: OrderHistory; settings: SettingsProvider<PricingSettings>; now: () => Date; newId: () => string;
}

export interface FeeRuleInput { type: "delivery_fee"; zoneIds: string[]; isActive: boolean; alwaysFree: boolean; minOrder: number | null; feeBasis: "afterDiscount" | "beforeDiscount"; tiers: Tier[] }
export interface SurchargeInput {
  type: "surcharge"; kind: "rain" | "late_night" | "other"; zoneIds: string[]; isActive: boolean; activeUntil: Date | null; window: Window | null;
  amount: number; extraMinutes: number; waivedByFreeDelivery: boolean;
}
export interface CouponInput {
  code: string; type: Coupon["type"]; value: number; maxDiscount: number | null; minOrder: number; perUserLimit: number | null; totalLimit: number | null;
  firstOrderOnly: boolean; zoneIds: string[]; warehouseIds: string[]; startsAt: Date | null; endsAt: Date | null; isActive: boolean; description: string | null;
}
export interface BannerInput {
  title: string; imageMediaId: string | null; link: Banner["link"]; zoneId: string | null; sortOrder: number; startsAt: Date | null; endsAt: Date | null; isActive: boolean;
}

const audit = (ctx: Ctx, action: string, entityType: string, entityId: string) =>
  ({ actorId: ctx.actor.userId, actorRole: ctx.actor.role, requestId: ctx.requestId, action, entityType, entityId });
/** The reasons a client may see. */
const publicReason = (reason: CouponReason): string =>
  reason === "user_limit_reached" ? "limit_reached" : reason === "not_found" || reason === "inactive" || reason === "not_started" ? "not_applicable" : reason;

/** Delivery fees, surcharges, coupons and home banners (F11, F12). All money is paise. */
export function createPricingService(deps: PricingDeps) {
  const { store, geography, media, orders, now, newId } = deps;

  /** A rule or coupon may only name zones the caller manages: every warehouse of each zone must be in their scope. */
  async function assertZones(ctx: Ctx, zoneIds: readonly string[]): Promise<void> {
    for (const zoneId of zoneIds) {
      if (!(await geography.zone(zoneId))) throw validation("That zone does not exist", { field: "zoneIds", zoneId });
      if (!ctx.actor.scope.all) {
        const warehouses = await geography.warehousesOfZone(zoneId);
        if (warehouses.length === 0 || warehouses.some(w => !ctx.actor.scope.warehouseIds.includes(w.id))) throw forbidden("This zone is outside your scope");
      }
    }
    if (zoneIds.length === 0 && !ctx.actor.scope.all) throw forbidden("Only a manager of every zone can make a rule for all zones");
  }

  function checkWindow(window: Window | null): void {
    if (!window) return;
    if (!validClock(window.start) || !validClock(window.end)) throw validation("The window times must be HH:MM", { field: "window" });
    if (window.days.length === 0 || window.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw validation("Days are numbers from 0 (Sunday) to 6", { field: "window.days" });
  }

  function checkRule(rule: Rule): void {
    if (rule.type === "delivery_fee") {
      if (rule.zoneIds.length === 0) throw validation("A delivery fee rule must name its zones", { field: "zoneIds" });
      const problem = rule.alwaysFree ? null : tierProblem(rule.tiers);
      if (problem) throw validation(problem, { field: "tiers" });
    } else {
      checkWindow(rule.window);
      if (rule.kind === "late_night" && !rule.window) throw validation("A late-night rule needs a window", { field: "window" });
    }
  }
  const taken = (error: unknown): never => {
    if (error instanceof ActiveRuleExistsError) throw conflict("A zone in this rule already has an active delivery fee rule", { ruleId: error.ruleId });
    throw error;
  };

  async function claimImage(ctx: Ctx, bannerId: string, mediaId: string): Promise<void> {
    await media.claim({ mediaId, userId: ctx.actor.userId, bannerId });
  }

  const service = {
    // ---------------------------------------------------------------- F11 rules

    async listRules(ctx: Ctx, query: { zoneId?: string | undefined; type?: "delivery_fee" | "surcharge" | undefined; isActive?: boolean | undefined }) {
      const rows = await store.listRules({ ...(query.zoneId && { zoneId: query.zoneId }), ...(query.type && { type: query.type }), ...(query.isActive !== undefined && { isActive: query.isActive }) });
      const visible = ctx.actor.scope.all ? rows : (await Promise.all(rows.map(async r => {
        try { await assertZones(ctx, r.zoneIds); return [r]; } catch { return []; }
      }))).flat();
      return visible.map(ruleView);
    },

    async getRule(ctx: Ctx, id: string) {
      const rule = await store.getRule(id);
      if (!rule) throw notFound("Rule");
      await assertZones(ctx, rule.zoneIds);
      return ruleView(rule);
    },

    async createRule(ctx: Ctx, input: FeeRuleInput | SurchargeInput) {
      await assertZones(ctx, input.zoneIds);
      const at = now();
      const rule = { ...input, id: newId(), createdAt: at, updatedAt: at } as Rule;
      checkRule(rule);
      try { await store.insertRule(rule, { audit: audit(ctx, "pricing.rule_create", "delivery_rule", rule.id) }); } catch (error) { taken(error); }
      return ruleView(rule);
    },

    async updateRule(ctx: Ctx, id: string, patch: { type?: string; zoneIds?: string[] } & Record<string, unknown>) {
      const current = await store.getRule(id);
      if (!current) throw notFound("Rule");
      await assertZones(ctx, current.zoneIds);
      if (patch.type && patch.type !== current.type) throw validation("A rule cannot change its type", { field: "type" });
      if (patch.zoneIds) await assertZones(ctx, patch.zoneIds);
      const { type: _type, ...fields } = patch;
      const next = { ...current, ...fields, updatedAt: now() } as Rule;
      checkRule(next);
      try { await store.updateRule(id, { ...fields, updatedAt: next.updatedAt } as Partial<Rule>, { audit: audit(ctx, "pricing.rule_update", "delivery_rule", id) }); } catch (error) { taken(error); }
      return ruleView(next);
    },

    async deactivateRule(ctx: Ctx, id: string) {
      const rule = await store.getRule(id);
      if (!rule) throw notFound("Rule");
      await assertZones(ctx, rule.zoneIds);
      await store.updateRule(id, { isActive: false, updatedAt: now() }, { audit: audit(ctx, "pricing.rule_deactivate", "delivery_rule", id) });
      return { ok: true };
    },

    /** The exact bill a customer would get. Nothing is saved. */
    async preview(ctx: Ctx, input: { zoneId: string; subtotal: number; discount: number; at: Date; splitIntoWarehouses: number }) {
      await assertZones(ctx, [input.zoneId]);
      const settings = await deps.settings({ zoneId: input.zoneId });
      const bill = computeBill({
        zoneId: input.zoneId, subtotal: input.subtotal, discount: input.discount, at: input.at, rules: await store.activeRules(), surchargeCap: settings.surchargeCap,
        deliveries: input.splitIntoWarehouses,
      });
      return { charges: bill.charges, surchargeCapApplied: bill.surchargeCapApplied, extraMinutes: bill.extraMinutes, total: bill.total, nextFreeDeliveryAt: bill.nextFreeDeliveryAt, feeShares: bill.feeShares };
    },

    /** Turns rain mode on for some zones (until a time) or off. */
    async setRain(ctx: Ctx, input: { on: boolean; until: Date | null; zoneIds: string[] }) {
      await assertZones(ctx, input.zoneIds);
      const existing = (await store.listRules({ type: "surcharge" })).filter((r): r is SurchargeRule => r.type === "surcharge" && r.kind === "rain");
      const covers = (r: SurchargeRule) => input.zoneIds.length === 0 || r.zoneIds.length === 0 || r.zoneIds.some(z => input.zoneIds.includes(z));
      if (!input.on) {
        const off = existing.filter(r => r.isActive && covers(r));
        for (const r of off) await store.updateRule(r.id, { isActive: false, updatedAt: now() }, { audit: audit(ctx, "pricing.rain_off", "delivery_rule", r.id) });
        return { ruleId: off[0]?.id ?? null, isActive: false, activeUntil: null };
      }
      if (input.until && input.until.getTime() <= now().getTime()) throw validation("The end time must be in the future", { field: "until" });
      const match = existing.find(r => r.zoneIds.length === input.zoneIds.length && r.zoneIds.every(z => input.zoneIds.includes(z)));
      if (match) {
        await store.updateRule(match.id, { isActive: true, activeUntil: input.until, updatedAt: now() }, { audit: audit(ctx, "pricing.rain_on", "delivery_rule", match.id) });
        return { ruleId: match.id, isActive: true, activeUntil: input.until?.toISOString() ?? null };
      }
      const at = now();
      const settings = await deps.settings(input.zoneIds.length === 1 ? { zoneId: input.zoneIds[0]! } : undefined);
      const rule: SurchargeRule = {
        id: newId(), type: "surcharge", kind: "rain", zoneIds: input.zoneIds, isActive: true, activeUntil: input.until, window: null,
        amount: settings.rainDefaults.amount, extraMinutes: settings.rainDefaults.extraMinutes, waivedByFreeDelivery: false, createdAt: at, updatedAt: at,
      };
      await store.insertRule(rule, { audit: audit(ctx, "pricing.rain_on", "delivery_rule", rule.id) });
      return { ruleId: rule.id, isActive: true, activeUntil: input.until?.toISOString() ?? null };
    },

    /** Background job: rain rules past their end time are switched off for good. */
    async expireRain(): Promise<number> {
      const at = now();
      const due = (await store.listRules({ type: "surcharge", isActive: true })).filter((r): r is SurchargeRule => r.type === "surcharge" && r.activeUntil !== null && r.activeUntil.getTime() <= at.getTime());
      for (const r of due) await store.updateRule(r.id, { isActive: false, updatedAt: at });
      return due.length;
    },

    // ---------------------------------------------------------------- the bill (used by quotes)

    async bill(input: { zoneId: string; subtotal: number; discount: number; at?: Date; freeDelivery?: boolean; deliveries?: number }) {
      const settings = await deps.settings({ zoneId: input.zoneId });
      return computeBill({
        zoneId: input.zoneId, subtotal: input.subtotal, discount: input.discount, at: input.at ?? now(), rules: await store.activeRules(), surchargeCap: settings.surchargeCap,
        ...(input.freeDelivery !== undefined && { freeDelivery: input.freeDelivery }), ...(input.deliveries !== undefined && { deliveries: input.deliveries }),
      });
    },
    /** The minimum order of the zone fee rule, if it sets one. */
    async minOrderFor(zoneId: string): Promise<number | null> {
      const rule = (await store.activeRules()).find((r): r is FeeRule => r.type === "delivery_fee" && r.zoneIds.includes(zoneId));
      return rule?.minOrder ?? null;
    },
    /** The amount at which delivery becomes free in a zone, for the cart bar. */
    async freeDeliveryThreshold(zoneId: string): Promise<number | null> {
      const rule = (await store.activeRules()).find((r): r is FeeRule => r.type === "delivery_fee" && r.zoneIds.includes(zoneId));
      if (!rule || rule.alwaysFree) return null;
      return rule.tiers.find(t => t.fee === 0)?.from ?? null;
    },

    // ---------------------------------------------------------------- F12 coupons

    async createCoupon(ctx: Ctx, input: CouponInput) {
      await assertZones(ctx, input.zoneIds);
      const at = now();
      const coupon: Coupon = { ...input, id: newId(), usedCount: 0, createdAt: at, updatedAt: at };
      try { await store.insertCoupon(coupon, { audit: audit(ctx, "pricing.coupon_create", "coupon", coupon.id) }); }
      catch (error) { if (error instanceof DuplicateCodeError) throw conflict("That coupon code already exists", { code: input.code }); throw error; }
      return couponView(coupon);
    },

    async getCoupon(ctx: Ctx, id: string) {
      const coupon = await store.getCoupon(id);
      if (!coupon) throw notFound("Coupon");
      await assertZones(ctx, coupon.zoneIds);
      return couponView(coupon);
    },

    async listCoupons(ctx: Ctx, query: { isActive?: boolean | undefined; limit: number; cursor?: string | undefined }) {
      const rows = await store.listCoupons({ ...(query.isActive !== undefined && { isActive: query.isActive }) }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      const visible = ctx.actor.scope.all ? page : (await Promise.all(page.map(async c => { try { await assertZones(ctx, c.zoneIds); return [c]; } catch { return []; } }))).flat();
      return { data: visible.map(couponView), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },

    async updateCoupon(ctx: Ctx, id: string, patch: Partial<CouponInput>) {
      const current = await store.getCoupon(id);
      if (!current) throw notFound("Coupon");
      await assertZones(ctx, current.zoneIds);
      if (patch.zoneIds) await assertZones(ctx, patch.zoneIds);
      const next: Coupon = { ...current, ...patch, updatedAt: now() };
      if (next.endsAt && next.startsAt && next.endsAt.getTime() <= next.startsAt.getTime()) throw validation("The end must be after the start", { field: "endsAt" });
      if (next.type === "percent" && (next.value < 1 || next.value > 100)) throw validation("A percentage is from 1 to 100", { field: "value" });
      if (next.totalLimit !== null && next.totalLimit < current.usedCount) throw validation("The total limit is below the uses so far", { field: "totalLimit" });
      try { await store.updateCoupon(id, { ...patch, updatedAt: next.updatedAt }, { audit: audit(ctx, "pricing.coupon_update", "coupon", id) }); }
      catch (error) { if (error instanceof DuplicateCodeError) throw conflict("That coupon code already exists", { code: patch.code }); throw error; }
      return couponView(next);
    },

    async deactivateCoupon(ctx: Ctx, id: string) {
      const coupon = await store.getCoupon(id);
      if (!coupon) throw notFound("Coupon");
      await assertZones(ctx, coupon.zoneIds);
      await store.updateCoupon(id, { isActive: false, updatedAt: now() }, { audit: audit(ctx, "pricing.coupon_deactivate", "coupon", id) });
      return couponView({ ...coupon, isActive: false });
    },

    async usage(ctx: Ctx, id: string, query: { limit: number; cursor?: string | undefined }, names: (userIds: readonly string[]) => Promise<Map<string, string>>) {
      const coupon = await store.getCoupon(id);
      if (!coupon) throw notFound("Coupon");
      await assertZones(ctx, coupon.zoneIds);
      const { rows, totalDiscount } = await store.listUsage(id, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      const nameOf = await names(page.map(r => r.userId));
      return {
        data: page.map(u => ({ userId: u.userId, customerName: nameOf.get(u.userId) ?? null, orderGroupId: u.groupId, discountAmount: u.discountAmount, at: u.at.toISOString() })),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null, totalDiscount,
      };
    },

    /** The coupons a customer could use now, each marked usable or greyed with the reason. */
    async available(userId: string, query: { zoneId: string; subtotal: number }) {
      const [list, isFirstOrder] = await Promise.all([store.availableCoupons(now()), orders.orderCount(userId).then(n => n === 0)]);
      const data = await Promise.all(list.map(async c => {
        const reason = couponProblem(c, { zoneId: query.zoneId, subtotal: query.subtotal, now: now(), isFirstOrder, usedByUser: await store.usedByUser(c.id, userId) });
        return { code: c.code, type: c.type, description: describeCoupon(c), value: c.value, minOrder: c.minOrder, applicable: reason === null, reason: reason ? publicReason(reason) : null };
      }));
      return data;
    },

    /** Checks a code for a customer and works out the discount. Throws COUPON_INVALID with a reason. */
    async check(userId: string, code: string, ctx: { zoneId: string; subtotal: number; warehouseIds?: readonly string[] }) {
      const coupon = await store.getCouponByCode(code.trim().toUpperCase());
      const invalid = (reason: string) => new AppError("COUPON_INVALID", "This coupon cannot be used", { reason });
      if (!coupon) throw invalid("not_applicable");
      const reason = couponProblem(coupon, {
        zoneId: ctx.zoneId, subtotal: ctx.subtotal, now: now(), isFirstOrder: (await orders.orderCount(userId)) === 0, usedByUser: await store.usedByUser(coupon.id, userId),
        ...(ctx.warehouseIds && { warehouseIds: ctx.warehouseIds }),
      });
      if (reason) throw invalid(publicReason(reason));
      return { coupon, discount: couponDiscount(coupon, ctx.subtotal), freeDelivery: coupon.type === "free_delivery", description: describeCoupon(coupon) };
    },

    /** Takes a use of the coupon for an order, atomically against its limits; false if this order already holds it. */
    async hold(userId: string, couponId: string, groupId: string, discountAmount: number): Promise<boolean> {
      const coupon = await store.getCoupon(couponId);
      if (!coupon) throw new AppError("COUPON_INVALID", "This coupon cannot be used", { reason: "not_applicable" });
      try { return await store.holdCoupon(coupon, { id: newId(), couponId, userId, groupId, discountAmount, at: now() }); }
      catch (error) {
        if (error instanceof CouponLimitError) throw new AppError("COUPON_INVALID", "This coupon cannot be used", { reason: "limit_reached" });
        throw error;
      }
    },
    release: (groupId: string) => store.releaseCoupon(groupId),

    // ---------------------------------------------------------------- banners

    async listBanners() { return (await store.listBanners()).map(bannerView); },

    async createBanner(ctx: Ctx, input: BannerInput) {
      if (input.zoneId) await assertZones(ctx, [input.zoneId]); else await assertZones(ctx, []);
      if (input.endsAt && input.startsAt && input.endsAt.getTime() <= input.startsAt.getTime()) throw validation("The end must be after the start", { field: "endsAt" });
      const at = now();
      const banner: Banner = { ...input, id: newId(), createdAt: at, updatedAt: at };
      if (banner.imageMediaId) await claimImage(ctx, banner.id, banner.imageMediaId);
      try { await store.insertBanner(banner, { audit: audit(ctx, "pricing.banner_create", "banner", banner.id) }); }
      catch (error) { if (banner.imageMediaId) await media.release(banner.imageMediaId, "banner_not_saved").catch(() => undefined); throw error; }
      return bannerView(banner);
    },

    async updateBanner(ctx: Ctx, id: string, patch: Partial<BannerInput>) {
      const current = await store.getBanner(id);
      if (!current) throw notFound("Banner");
      await assertZones(ctx, current.zoneId ? [current.zoneId] : []);
      if (patch.zoneId) await assertZones(ctx, [patch.zoneId]);
      const next: Banner = { ...current, ...patch, updatedAt: now() };
      if (next.endsAt && next.startsAt && next.endsAt.getTime() <= next.startsAt.getTime()) throw validation("The end must be after the start", { field: "endsAt" });
      const swapped = patch.imageMediaId !== undefined && patch.imageMediaId !== current.imageMediaId;
      if (swapped && patch.imageMediaId) await claimImage(ctx, id, patch.imageMediaId);
      try { await store.updateBanner(id, { ...patch, updatedAt: next.updatedAt }, { audit: audit(ctx, "pricing.banner_update", "banner", id) }); }
      catch (error) { if (swapped && patch.imageMediaId) await media.release(patch.imageMediaId, "banner_not_saved").catch(() => undefined); throw error; }
      if (swapped && current.imageMediaId) await media.release(current.imageMediaId, "banner_image_replaced").catch(() => undefined);
      return bannerView(next);
    },

    async deleteBanner(ctx: Ctx, id: string) {
      const current = await store.getBanner(id);
      if (!current) throw notFound("Banner");
      await assertZones(ctx, current.zoneId ? [current.zoneId] : []);
      await store.deleteBanner(id, { audit: audit(ctx, "pricing.banner_delete", "banner", id) });
      if (current.imageMediaId) await media.release(current.imageMediaId, "banner_deleted").catch(() => undefined);
      return { ok: true };
    },

    /** The banners a zone shows on its home screen, in order. */
    async bannersForZone(zoneId: string) {
      return (await store.activeBannersForZone(zoneId, now())).map(b => ({ id: b.id, title: b.title, imageMediaId: b.imageMediaId, link: b.link }));
    },
  };
  return service;
}

export type PricingService = ReturnType<typeof createPricingService>;
