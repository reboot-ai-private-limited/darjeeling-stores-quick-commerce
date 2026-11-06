/** Money is whole paise. Everything here is a pure function so a bill is exact and can be previewed without saving anything. */

export interface Tier { from: number; to: number | null; fee: number }
export interface FeeRule {
  id: string; type: "delivery_fee"; zoneIds: string[]; isActive: boolean; alwaysFree: boolean; minOrder: number | null;
  feeBasis: "afterDiscount" | "beforeDiscount"; tiers: Tier[]; createdAt: Date; updatedAt: Date;
}
export interface Window { start: string; end: string; tz: "Asia/Kolkata"; days: number[] }
export interface SurchargeRule {
  id: string; type: "surcharge"; kind: "rain" | "late_night" | "other"; zoneIds: string[]; isActive: boolean;
  activeUntil: Date | null; window: Window | null; amount: number; extraMinutes: number; waivedByFreeDelivery: boolean; createdAt: Date; updatedAt: Date;
}
export type Rule = FeeRule | SurchargeRule;

export interface Charge { type: "delivery_fee" | "surcharge_rain" | "surcharge_late_night" | "surcharge_other"; label: string; amount: number; ruleId: string }
export interface Bill {
  charges: Charge[]; surchargeCapApplied: boolean; extraMinutes: number; total: number; nextFreeDeliveryAt: number | null;
  /** The delivery fee split between the deliveries of a split order, the first taking any odd paise. */
  feeShares: number[];
}

/** Tiers must start at 0, leave no gap and end open. Returns the first problem, or null. */
export function tierProblem(tiers: readonly Tier[]): string | null {
  if (tiers.length === 0) return "Add at least one tier";
  if (tiers[0]!.from !== 0) return "The first tier must start at 0";
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    const last = i === tiers.length - 1;
    if (tier.fee < 0) return "A fee cannot be negative";
    if (last && tier.to !== null) return "The last tier must be open-ended (to: null)";
    if (!last) {
      if (tier.to === null) return "Only the last tier can be open-ended";
      if (tier.to < tier.from) return "A tier cannot end before it starts";
      if (tiers[i + 1]!.from !== tier.to + 1) return "Tiers must follow each other with no gap or overlap";
    }
  }
  return null;
}

const IST_MS = 5.5 * 3_600_000;
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
export const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Is this moment inside a window that is read in Indian time and may cross midnight? Days are those on which the window starts. */
export function inWindow(window: Window, at: Date): boolean {
  const ist = new Date(at.getTime() + IST_MS);
  const day = ist.getUTCDay();
  const now = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const start = minutes(window.start);
  const end = minutes(window.end);
  if (start === end) return window.days.includes(day);
  if (start < end) return window.days.includes(day) && now >= start && now < end;
  return (now >= start && window.days.includes(day)) || (now < end && window.days.includes((day + 6) % 7));
}

export const surchargeIsOn = (rule: SurchargeRule, at: Date): boolean => {
  if (!rule.isActive) return false;
  if (rule.activeUntil && at.getTime() >= rule.activeUntil.getTime()) return false;
  if (rule.window && !inWindow(rule.window, at)) return false;
  return true;
};

export function feeFor(rule: FeeRule | null, amount: number): number {
  if (!rule || rule.alwaysFree) return 0;
  const tier = rule.tiers.find(t => amount >= t.from && (t.to === null || amount <= t.to));
  return tier?.fee ?? 0;
}

/** The smallest amount at which delivery becomes free, if the customer is not there yet. */
export function nextFreeAt(rule: FeeRule | null, amount: number): number | null {
  if (!rule || rule.alwaysFree) return null;
  const free = rule.tiers.find(t => t.fee === 0 && t.from > amount);
  return free && feeFor(rule, amount) > 0 ? free.from : null;
}

const SURCHARGE_TYPE = { rain: "surcharge_rain", late_night: "surcharge_late_night", other: "surcharge_other" } as const;
const SURCHARGE_LABEL = { rain: "Rain surcharge", late_night: "Late-night fee", other: "Surcharge" } as const;

export interface BillInput {
  zoneId: string; subtotal: number; discount: number; at: Date; rules: readonly Rule[]; surchargeCap: number | null;
  /** A free-delivery coupon is applied. */ freeDelivery?: boolean; deliveries?: number;
}

/** The delivery fee and surcharges for a bill. A rule applies to a zone when its `zoneIds` is empty or contains it. */
export function computeBill(input: BillInput): Bill {
  const here = (r: Rule) => r.isActive && (r.zoneIds.length === 0 || r.zoneIds.includes(input.zoneId));
  const feeRule = (input.rules.find(r => r.type === "delivery_fee" && here(r)) as FeeRule | undefined) ?? null;
  const basis = feeRule?.feeBasis === "beforeDiscount" ? input.subtotal : Math.max(0, input.subtotal - input.discount);
  const fee = input.freeDelivery ? 0 : feeFor(feeRule, basis);
  const charges: Charge[] = [];
  if (feeRule && fee > 0) charges.push({ type: "delivery_fee", label: "Delivery fee", amount: fee, ruleId: feeRule.id });
  const free = fee === 0;

  let extraMinutes = 0;
  let surcharges: { rule: SurchargeRule; amount: number }[] = [];
  for (const rule of input.rules) {
    if (rule.type !== "surcharge" || !here(rule) || !surchargeIsOn(rule, input.at)) continue;
    if (free && rule.waivedByFreeDelivery) continue;
    surcharges.push({ rule, amount: rule.amount });
  }
  // All surcharges together never exceed the cap; the later ones are trimmed first.
  let capApplied = false;
  if (input.surchargeCap !== null) {
    let room = input.surchargeCap;
    surcharges = surcharges.map(s => {
      const amount = Math.min(s.amount, room);
      if (amount < s.amount) capApplied = true;
      room -= amount;
      return { ...s, amount };
    }).filter(s => s.amount > 0);
  }
  for (const s of surcharges) {
    charges.push({ type: SURCHARGE_TYPE[s.rule.kind], label: SURCHARGE_LABEL[s.rule.kind], amount: s.amount, ruleId: s.rule.id });
    extraMinutes += s.rule.extraMinutes;
  }
  const deliveries = Math.max(1, input.deliveries ?? 1);
  const share = Math.floor(fee / deliveries);
  const feeShares = Array.from({ length: deliveries }, (_, i) => (i === 0 ? fee - share * (deliveries - 1) : share));
  return {
    charges, surchargeCapApplied: capApplied, extraMinutes, total: charges.reduce((sum, c) => sum + c.amount, 0),
    nextFreeDeliveryAt: input.freeDelivery ? null : nextFreeAt(feeRule, basis), feeShares,
  };
}

// ------------------------------------------------------------------ coupons

export type CouponType = "percent" | "flat" | "free_delivery";
export interface Coupon {
  id: string; code: string; type: CouponType; value: number; maxDiscount: number | null; minOrder: number; perUserLimit: number | null; totalLimit: number | null;
  usedCount: number; firstOrderOnly: boolean; zoneIds: string[]; warehouseIds: string[]; startsAt: Date | null; endsAt: Date | null; isActive: boolean;
  description: string | null; createdAt: Date; updatedAt: Date;
}
export type CouponReason = "not_found" | "inactive" | "expired" | "not_started" | "min_order" | "first_order_only" | "limit_reached" | "user_limit_reached" | "not_applicable";

export interface CouponContext { zoneId: string; subtotal: number; now: Date; isFirstOrder: boolean; usedByUser: number; warehouseIds?: readonly string[] }

/** Why a coupon cannot be used right now, or null when it can. */
export function couponProblem(c: Coupon, ctx: CouponContext): CouponReason | null {
  if (!c.isActive) return "inactive";
  if (c.endsAt && ctx.now.getTime() >= c.endsAt.getTime()) return "expired";
  if (c.startsAt && ctx.now.getTime() < c.startsAt.getTime()) return "not_started";
  if (c.zoneIds.length > 0 && !c.zoneIds.includes(ctx.zoneId)) return "not_applicable";
  if (c.warehouseIds.length > 0 && ctx.warehouseIds && !ctx.warehouseIds.some(w => c.warehouseIds.includes(w))) return "not_applicable";
  if (c.totalLimit !== null && c.usedCount >= c.totalLimit) return "limit_reached";
  if (c.perUserLimit !== null && ctx.usedByUser >= c.perUserLimit) return "user_limit_reached";
  if (c.firstOrderOnly && !ctx.isFirstOrder) return "first_order_only";
  if (ctx.subtotal < c.minOrder) return "min_order";
  return null;
}

/** The money off the items. A free-delivery coupon takes nothing off the items; the bill waives the fee instead. */
export function couponDiscount(c: Coupon, subtotal: number): number {
  if (c.type === "free_delivery") return 0;
  if (c.type === "flat") return Math.min(c.value, subtotal);
  const raw = Math.floor((subtotal * c.value) / 100);
  return Math.min(c.maxDiscount === null ? raw : Math.min(raw, c.maxDiscount), subtotal);
}

export const couponView = (c: Coupon) => ({
  id: c.id, code: c.code, type: c.type, value: c.value, maxDiscount: c.maxDiscount, minOrder: c.minOrder, perUserLimit: c.perUserLimit, totalLimit: c.totalLimit,
  usedCount: c.usedCount, firstOrderOnly: c.firstOrderOnly, zoneIds: c.zoneIds, warehouseIds: c.warehouseIds,
  startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null, isActive: c.isActive, description: c.description,
});

export const describeCoupon = (c: Coupon): string =>
  c.description ?? (c.type === "free_delivery" ? "Free delivery" : c.type === "flat" ? `₹${c.value / 100} off` : `${c.value}% off${c.maxDiscount ? ` up to ₹${c.maxDiscount / 100}` : ""}`);

export const ruleView = (r: Rule) => (r.type === "delivery_fee"
  ? { id: r.id, type: r.type, zoneIds: r.zoneIds, isActive: r.isActive, alwaysFree: r.alwaysFree, minOrder: r.minOrder, feeBasis: r.feeBasis, tiers: r.tiers }
  : {
    id: r.id, type: r.type, kind: r.kind, zoneIds: r.zoneIds, isActive: r.isActive, activeUntil: r.activeUntil?.toISOString() ?? null, window: r.window,
    amount: r.amount, extraMinutes: r.extraMinutes, waivedByFreeDelivery: r.waivedByFreeDelivery,
  });

export interface Banner {
  id: string; title: string; imageMediaId: string | null; link: { type: "category" | "product" | "url"; id?: string; url?: string } | null; zoneId: string | null;
  sortOrder: number; startsAt: Date | null; endsAt: Date | null; isActive: boolean; createdAt: Date; updatedAt: Date;
}
export const bannerView = (b: Banner) => ({
  id: b.id, title: b.title, imageMediaId: b.imageMediaId, link: b.link, zoneId: b.zoneId, sortOrder: b.sortOrder,
  startsAt: b.startsAt?.toISOString() ?? null, endsAt: b.endsAt?.toISOString() ?? null, isActive: b.isActive,
});
