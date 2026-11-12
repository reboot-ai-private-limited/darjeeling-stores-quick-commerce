import type { Banner, Coupon, FeeRule, Rule } from "../domain/pricing.js";

export class DuplicateCodeError extends Error {}
export class ActiveRuleExistsError extends Error { constructor(readonly ruleId: string) { super("A zone already has an active rule"); } }
export class CouponLimitError extends Error { constructor(readonly reason: "limit_reached" | "user_limit_reached") { super(reason); } }

export interface Usage { id: string; couponId: string; userId: string; groupId: string; discountAmount: number; at: Date }

export interface PricingStore {
  ensureIndexes(): Promise<void>;
  insertRule(rule: Rule): Promise<void>;
  getRule(id: string): Promise<Rule | null>;
  updateRule(id: string, patch: Partial<Rule>): Promise<boolean>;
  listRules(filter: { zoneId?: string; type?: string; isActive?: boolean }): Promise<Rule[]>;
  /** Every active rule (there are few), for pricing a bill. */
  activeRules(): Promise<Rule[]>;
  activeFeeRuleOnZones(zoneIds: readonly string[], exceptId?: string): Promise<FeeRule | null>;

  insertCoupon(coupon: Coupon): Promise<void>;
  getCoupon(id: string): Promise<Coupon | null>;
  getCouponByCode(code: string): Promise<Coupon | null>;
  updateCoupon(id: string, patch: Partial<Coupon>): Promise<boolean>;
  listCoupons(filter: { isActive?: boolean }, limit: number, beforeId?: string): Promise<Coupon[]>;
  /** Coupons that are active and in date, for the list a customer sees. */
  availableCoupons(now: Date): Promise<Coupon[]>;
  usedByUser(couponId: string, userId: string): Promise<number>;
  /** Takes one use of a coupon for an order group, once; false if this group already holds it. Throws CouponLimitError at the limits. */
  holdCoupon(coupon: Coupon, usage: Usage): Promise<boolean>;
  /** Gives the use back (the order was cancelled before it counted). Safe to repeat. */
  releaseCoupon(groupId: string): Promise<boolean>;
  listUsage(couponId: string, limit: number, beforeId?: string): Promise<{ rows: Usage[]; totalDiscount: number }>;

  insertBanner(banner: Banner): Promise<void>;
  getBanner(id: string): Promise<Banner | null>;
  updateBanner(id: string, patch: Partial<Banner>): Promise<boolean>;
  deleteBanner(id: string): Promise<boolean>;
  listBanners(): Promise<Banner[]>;
  activeBannersForZone(zoneId: string, now: Date): Promise<Banner[]>;
}

export interface BannerMedia {
  claim(input: { mediaId: string; userId: string; bannerId: string }): Promise<void>;
  release(mediaId: string, reason: string): Promise<void>;
}
/** How many orders a customer has placed (for first-order coupons). Orders are in the orders module. */
export interface OrderHistory { orderCount(userId: string): Promise<number> }
