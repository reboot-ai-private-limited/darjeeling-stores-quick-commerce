import { describe, expect, it } from "vitest";
import {
  computeBill, couponDiscount, couponProblem, feeFor, inWindow, nextFreeAt, tierProblem,
  type Coupon, type FeeRule, type SurchargeRule, type Tier, type Window,
} from "../src/modules/pricing/domain/pricing.js";

const T0 = new Date("2026-11-05T00:00:00Z");
const tiers: Tier[] = [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: 59999, fee: 2000 }, { from: 60000, to: null, fee: 0 }];
const fee = (over: Partial<FeeRule> = {}): FeeRule => ({ id: "f1", type: "delivery_fee", zoneIds: ["z1"], isActive: true, alwaysFree: false, minOrder: 10000, feeBasis: "afterDiscount", tiers, createdAt: T0, updatedAt: T0, ...over });
const surcharge = (over: Partial<SurchargeRule> = {}): SurchargeRule => ({
  id: "s1", type: "surcharge", kind: "rain", zoneIds: ["z1"], isActive: true, activeUntil: null, window: null, amount: 1500, extraMinutes: 10, waivedByFreeDelivery: false, createdAt: T0, updatedAt: T0, ...over,
});
const at = (iso: string) => new Date(iso);

describe("fee tiers", () => {
  it("accepts tiers that start at 0, join without gaps and end open", () => {
    expect(tierProblem(tiers)).toBeNull();
    expect(tierProblem([{ from: 0, to: null, fee: 0 }])).toBeNull();
  });
  it("names the first problem", () => {
    expect(tierProblem([])).toMatch(/at least one/);
    expect(tierProblem([{ from: 100, to: null, fee: 0 }])).toMatch(/start at 0/);
    expect(tierProblem([{ from: 0, to: 100, fee: 5 }, { from: 102, to: null, fee: 0 }])).toMatch(/gap/);
    expect(tierProblem([{ from: 0, to: 100, fee: 5 }, { from: 100, to: null, fee: 0 }])).toMatch(/gap or overlap/);
    expect(tierProblem([{ from: 0, to: 100, fee: 5 }])).toMatch(/open-ended/);
    expect(tierProblem([{ from: 0, to: null, fee: 5 }, { from: 1, to: null, fee: 0 }])).toMatch(/Only the last/);
    expect(tierProblem([{ from: 0, to: null, fee: -1 }])).toMatch(/negative/);
  });
  it("picks the fee by amount at the exact edges", () => {
    const rule = fee();
    expect([0, 29999, 30000, 59999, 60000, 1_000_000].map(a => feeFor(rule, a))).toEqual([4000, 4000, 2000, 2000, 0, 0]);
    expect(feeFor(fee({ alwaysFree: true }), 100)).toBe(0);
    expect(feeFor(null, 100)).toBe(0);
  });
  it("says how much more makes delivery free", () => {
    expect(nextFreeAt(fee(), 35000)).toBe(60000);
    expect(nextFreeAt(fee(), 60000)).toBeNull();
    expect(nextFreeAt(fee({ alwaysFree: true }), 100)).toBeNull();
  });
});

describe("late-night windows", () => {
  const night: Window = { start: "22:00", end: "06:00", tz: "Asia/Kolkata", days: [0, 1, 2, 3, 4, 5, 6] };
  it("reads the time in India and crosses midnight", () => {
    // 22:00 IST is 16:30 UTC.
    expect(inWindow(night, at("2026-11-05T16:29:00Z"))).toBe(false);
    expect(inWindow(night, at("2026-11-05T16:30:00Z"))).toBe(true);
    expect(inWindow(night, at("2026-11-05T20:00:00Z"))).toBe(true); // 01:30 IST next day
    expect(inWindow(night, at("2026-11-05T00:29:00Z"))).toBe(true); // 05:59 IST
    expect(inWindow(night, at("2026-11-05T00:30:00Z"))).toBe(false); // 06:00 IST
  });
  it("counts the day the window starts on, so after midnight belongs to the day before", () => {
    // Thursday 2026-11-05 22:00 IST starts a window; 01:00 IST on Friday is part of it.
    const thursdayOnly: Window = { ...night, days: [4] };
    expect(inWindow(thursdayOnly, at("2026-11-05T17:00:00Z"))).toBe(true); // Thu 22:30 IST
    expect(inWindow(thursdayOnly, at("2026-11-05T20:00:00Z"))).toBe(true); // Fri 01:30 IST
    expect(inWindow(thursdayOnly, at("2026-11-06T17:00:00Z"))).toBe(false); // Fri 22:30 IST
    expect(inWindow(thursdayOnly, at("2026-11-06T20:00:00Z"))).toBe(false); // Sat 01:30 IST
  });
  it("handles a window within one day, and an empty-length window as all day", () => {
    const lunch: Window = { start: "12:00", end: "14:00", tz: "Asia/Kolkata", days: [4] };
    expect(inWindow(lunch, at("2026-11-05T06:30:00Z"))).toBe(true); // 12:00 IST Thursday
    expect(inWindow(lunch, at("2026-11-05T08:30:00Z"))).toBe(false); // 14:00 IST
    expect(inWindow({ ...lunch, start: "00:00", end: "00:00" }, at("2026-11-05T03:00:00Z"))).toBe(true);
  });
});

describe("the bill", () => {
  const rules = [fee(), surcharge({ id: "rain" }), surcharge({ id: "night", kind: "late_night", amount: 2000, extraMinutes: 5, window: { start: "22:00", end: "06:00", tz: "Asia/Kolkata", days: [0, 1, 2, 3, 4, 5, 6] } })];
  const base = { zoneId: "z1", subtotal: 35000, discount: 0, at: at("2026-11-05T09:00:00Z"), rules, surchargeCap: null };

  it("charges the tier fee and each surcharge that is on, and adds the extra minutes", () => {
    const day = computeBill(base);
    expect(day.charges).toEqual([{ type: "delivery_fee", label: "Delivery fee", amount: 2000, ruleId: "f1" }, { type: "surcharge_rain", label: "Rain surcharge", amount: 1500, ruleId: "rain" }]);
    expect(day).toMatchObject({ total: 3500, extraMinutes: 10, surchargeCapApplied: false, nextFreeDeliveryAt: 60000 });
    const night = computeBill({ ...base, at: at("2026-11-05T17:30:00Z") });
    expect(night.total).toBe(5500);
    expect(night.extraMinutes).toBe(15);
  });
  it("takes the discount off before choosing the tier unless the rule says otherwise", () => {
    expect(computeBill({ ...base, subtotal: 31000, discount: 2000, rules: [fee()] }).total).toBe(4000);
    expect(computeBill({ ...base, subtotal: 31000, discount: 2000, rules: [fee({ feeBasis: "beforeDiscount" })] }).total).toBe(2000);
  });
  it("makes delivery free with a free-delivery coupon or an always-free zone, and waives surcharges that ask for it", () => {
    const waived = [fee(), surcharge({ waivedByFreeDelivery: true }), surcharge({ id: "kept", kind: "other", amount: 500 })];
    expect(computeBill({ ...base, rules: waived, freeDelivery: true }).charges.map(c => c.ruleId)).toEqual(["kept"]);
    expect(computeBill({ ...base, rules: [fee({ alwaysFree: true })] }).total).toBe(0);
    expect(computeBill({ ...base, freeDelivery: true }).nextFreeDeliveryAt).toBeNull();
  });
  it("caps all surcharges together, trimming the later ones first", () => {
    const capped = computeBill({ ...base, at: at("2026-11-05T17:30:00Z"), surchargeCap: 2500 });
    expect(capped.charges.filter(c => c.type !== "delivery_fee").map(c => c.amount)).toEqual([1500, 1000]);
    expect(capped.surchargeCapApplied).toBe(true);
    expect(computeBill({ ...base, surchargeCap: 0 }).charges.map(c => c.type)).toEqual(["delivery_fee"]);
    expect(computeBill({ ...base, surchargeCap: 1500 }).surchargeCapApplied).toBe(false);
  });
  it("ignores rules for other zones, switched off, or past their end time", () => {
    expect(computeBill({ ...base, zoneId: "z2" }).total).toBe(0);
    expect(computeBill({ ...base, rules: [fee(), surcharge({ isActive: false })] }).total).toBe(2000);
    expect(computeBill({ ...base, rules: [fee(), surcharge({ activeUntil: at("2026-11-05T09:00:00Z") })] }).total).toBe(2000);
    expect(computeBill({ ...base, rules: [fee(), surcharge({ activeUntil: at("2026-11-05T09:00:01Z") })] }).total).toBe(3500);
    expect(computeBill({ ...base, rules: [fee(), surcharge({ zoneIds: [] })] }).total).toBe(3500);
  });
  it("splits the delivery fee between deliveries, the first taking the odd paise", () => {
    expect(computeBill({ ...base, subtotal: 100, rules: [fee({ tiers: [{ from: 0, to: null, fee: 3001 }] })], deliveries: 2 }).feeShares).toEqual([1501, 1500]);
    expect(computeBill({ ...base, deliveries: 1 }).feeShares).toEqual([2000]);
    expect(computeBill({ ...base, deliveries: 3 }).feeShares.reduce((a, b) => a + b, 0)).toBe(2000);
  });
});

describe("coupons", () => {
  const coupon = (over: Partial<Coupon> = {}): Coupon => ({
    id: "c1", code: "WELCOME50", type: "flat", value: 5000, maxDiscount: null, minOrder: 20000, perUserLimit: 1, totalLimit: 500, usedCount: 37, firstOrderOnly: true, zoneIds: ["z1"], warehouseIds: [],
    startsAt: at("2026-11-01T00:00:00Z"), endsAt: at("2026-12-01T00:00:00Z"), isActive: true, description: null, createdAt: T0, updatedAt: T0, ...over,
  });
  const ctx = { zoneId: "z1", subtotal: 25000, now: at("2026-11-05T00:00:00Z"), isFirstOrder: true, usedByUser: 0 };

  it("can be used when everything fits", () => { expect(couponProblem(coupon(), ctx)).toBeNull(); });
  it("gives the first reason it cannot be used", () => {
    expect(couponProblem(coupon({ isActive: false }), ctx)).toBe("inactive");
    expect(couponProblem(coupon(), { ...ctx, now: at("2026-12-01T00:00:00Z") })).toBe("expired");
    expect(couponProblem(coupon(), { ...ctx, now: at("2026-10-31T23:59:59Z") })).toBe("not_started");
    expect(couponProblem(coupon(), { ...ctx, zoneId: "z2" })).toBe("not_applicable");
    expect(couponProblem(coupon({ warehouseIds: ["w9"] }), { ...ctx, warehouseIds: ["w1"] })).toBe("not_applicable");
    expect(couponProblem(coupon({ warehouseIds: ["w1"] }), { ...ctx, warehouseIds: ["w1", "w2"] })).toBeNull();
    expect(couponProblem(coupon({ usedCount: 500 }), ctx)).toBe("limit_reached");
    expect(couponProblem(coupon(), { ...ctx, usedByUser: 1 })).toBe("user_limit_reached");
    expect(couponProblem(coupon(), { ...ctx, isFirstOrder: false })).toBe("first_order_only");
    expect(couponProblem(coupon(), { ...ctx, subtotal: 19999 })).toBe("min_order");
    expect(couponProblem(coupon({ zoneIds: [], totalLimit: null, perUserLimit: null }), { ...ctx, usedByUser: 99 })).toBeNull();
  });
  it("works out the discount for each type, never more than the items", () => {
    expect(couponDiscount(coupon(), 25000)).toBe(5000);
    expect(couponDiscount(coupon(), 3000)).toBe(3000);
    expect(couponDiscount(coupon({ type: "percent", value: 10 }), 25999)).toBe(2599);
    expect(couponDiscount(coupon({ type: "percent", value: 10, maxDiscount: 1000 }), 25000)).toBe(1000);
    expect(couponDiscount(coupon({ type: "percent", value: 100 }), 777)).toBe(777);
    expect(couponDiscount(coupon({ type: "free_delivery", value: 0 }), 25000)).toBe(0);
  });
});
