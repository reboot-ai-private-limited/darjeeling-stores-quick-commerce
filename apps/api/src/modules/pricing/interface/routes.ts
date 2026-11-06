import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, guarded, parse, pathId, sendData, type AuthResolver, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { PricingService } from "../application/pricing-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const paise = z.number().int().min(0).max(100_000_000);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const tier = z.object({ from: z.number().int().min(0), to: z.number().int().min(0).nullable(), fee: paise }).strict();
const windowSchema = z.object({ start: clock, end: clock, tz: z.literal("Asia/Kolkata").default("Asia/Kolkata"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }).strict();
const zones = z.array(id).max(50);

const feeFields = {
  zoneIds: zones, isActive: z.boolean(), alwaysFree: z.boolean(), minOrder: paise.nullable(), feeBasis: z.enum(["afterDiscount", "beforeDiscount"]), tiers: z.array(tier).max(20),
};
const surchargeFields = {
  kind: z.enum(["rain", "late_night", "other"]), zoneIds: zones, isActive: z.boolean(), activeUntil: z.coerce.date().nullable(), window: windowSchema.nullable(),
  amount: paise, extraMinutes: z.number().int().min(0).max(240), waivedByFreeDelivery: z.boolean(),
};
export const ruleCreate = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delivery_fee"), zoneIds: feeFields.zoneIds, isActive: feeFields.isActive.default(true), alwaysFree: feeFields.alwaysFree.default(false), minOrder: feeFields.minOrder.default(null), feeBasis: feeFields.feeBasis.default("afterDiscount"), tiers: feeFields.tiers.default([]) }).strict(),
  z.object({
    type: z.literal("surcharge"), kind: surchargeFields.kind, zoneIds: surchargeFields.zoneIds.default([]), isActive: surchargeFields.isActive.default(true), activeUntil: surchargeFields.activeUntil.default(null),
    window: surchargeFields.window.default(null), amount: surchargeFields.amount, extraMinutes: surchargeFields.extraMinutes.default(0), waivedByFreeDelivery: surchargeFields.waivedByFreeDelivery.default(false),
  }).strict(),
]);
export const ruleUpdate = z.object({
  type: z.enum(["delivery_fee", "surcharge"]).optional(),
  zoneIds: zones.optional(), isActive: z.boolean().optional(), alwaysFree: z.boolean().optional(), minOrder: paise.nullable().optional(), feeBasis: feeFields.feeBasis.optional(), tiers: z.array(tier).max(20).optional(),
  kind: surchargeFields.kind.optional(), activeUntil: surchargeFields.activeUntil.optional(), window: windowSchema.nullable().optional(), amount: paise.optional(),
  extraMinutes: surchargeFields.extraMinutes.optional(), waivedByFreeDelivery: z.boolean().optional(),
}).strict().refine(b => Object.keys(b).length > 0, "Send at least one field to change");
export const rulesQuery = z.object({ zoneId: id.optional(), type: z.enum(["delivery_fee", "surcharge"]).optional(), isActive: z.enum(["true", "false"]).transform(v => v === "true").optional() });
export const previewBody = z.object({ zoneId: id, subtotal: paise, discount: paise.default(0), at: z.coerce.date().optional(), splitIntoWarehouses: z.number().int().min(1).max(5).default(1) }).strict();
export const rainBody = z.object({ on: z.boolean(), until: z.coerce.date().nullish(), zoneIds: zones.default([]) }).strict();

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, "Use 3 to 20 letters, digits, - or _");
const couponFields = {
  code, type: z.enum(["percent", "flat", "free_delivery"]), value: z.number().int().min(0).max(100_000_000), maxDiscount: paise.nullable(), minOrder: paise, perUserLimit: z.number().int().min(1).nullable(),
  totalLimit: z.number().int().min(1).nullable(), firstOrderOnly: z.boolean(), zoneIds: zones, warehouseIds: z.array(id).max(50), startsAt: z.coerce.date().nullable(), endsAt: z.coerce.date().nullable(),
  isActive: z.boolean(), description: z.string().trim().min(1).max(200).nullable(),
};
export const couponCreate = z.object({
  code: couponFields.code, type: couponFields.type, value: couponFields.value.default(0), maxDiscount: couponFields.maxDiscount.default(null), minOrder: couponFields.minOrder.default(0),
  perUserLimit: couponFields.perUserLimit.default(null), totalLimit: couponFields.totalLimit.default(null), firstOrderOnly: couponFields.firstOrderOnly.default(false), zoneIds: couponFields.zoneIds.default([]),
  warehouseIds: couponFields.warehouseIds.default([]), startsAt: couponFields.startsAt.default(null), endsAt: couponFields.endsAt.default(null), isActive: couponFields.isActive.default(true), description: couponFields.description.default(null),
}).strict().superRefine((b, ctx) => {
  if (b.type === "percent" && (b.value < 1 || b.value > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage is from 1 to 100" });
  if (b.type === "flat" && b.value < 1) ctx.addIssue({ code: "custom", path: ["value"], message: "A flat coupon needs an amount" });
  if (b.endsAt && b.startsAt && b.endsAt.getTime() <= b.startsAt.getTime()) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
});
export const couponUpdate = z.object({
  code: couponFields.code.optional(), type: couponFields.type.optional(), value: couponFields.value.optional(), maxDiscount: couponFields.maxDiscount.optional(), minOrder: couponFields.minOrder.optional(),
  perUserLimit: couponFields.perUserLimit.optional(), totalLimit: couponFields.totalLimit.optional(), firstOrderOnly: z.boolean().optional(), zoneIds: couponFields.zoneIds.optional(),
  warehouseIds: couponFields.warehouseIds.optional(), startsAt: couponFields.startsAt.optional(), endsAt: couponFields.endsAt.optional(), isActive: z.boolean().optional(), description: couponFields.description.optional(),
}).strict().refine(b => Object.keys(b).length > 0, "Send at least one field to change");
export const couponsQuery = z.object({ isActive: z.enum(["true", "false"]).transform(v => v === "true").optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional() });
export const availableQuery = z.object({ zoneId: id, subtotal: z.coerce.number().int().min(0).max(100_000_000).default(0) });
export const usageQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional() });

const link = z.discriminatedUnion("type", [
  z.object({ type: z.literal("category"), id }).strict(), z.object({ type: z.literal("product"), id }).strict(),
  z.object({ type: z.literal("url"), url: z.url().refine(v => v.startsWith("https://"), "Use an HTTPS link") }).strict(),
]);
const bannerFields = {
  title: z.string().trim().min(1).max(120), imageMediaId: id.nullable(), link: link.nullable(), zoneId: id.nullable(), sortOrder: z.number().int().min(0).max(10_000),
  startsAt: z.coerce.date().nullable(), endsAt: z.coerce.date().nullable(), isActive: z.boolean(),
};
export const bannerCreate = z.object({
  title: bannerFields.title, imageMediaId: bannerFields.imageMediaId.default(null), link: bannerFields.link.default(null), zoneId: bannerFields.zoneId.default(null), sortOrder: bannerFields.sortOrder.default(0),
  startsAt: bannerFields.startsAt.default(null), endsAt: bannerFields.endsAt.default(null), isActive: bannerFields.isActive.default(true),
}).strict();
export const bannerUpdate = z.object({
  title: bannerFields.title.optional(), imageMediaId: bannerFields.imageMediaId.optional(), link: bannerFields.link.optional(), zoneId: bannerFields.zoneId.optional(), sortOrder: bannerFields.sortOrder.optional(),
  startsAt: bannerFields.startsAt.optional(), endsAt: bannerFields.endsAt.optional(), isActive: z.boolean().optional(),
}).strict().refine(b => Object.keys(b).length > 0, "Send at least one field to change");

/** Looks up customer names for the usage list (identity module). */
export type CustomerNames = (userIds: readonly string[]) => Promise<Map<string, string>>;

/** The 19 endpoints of docs/api/F11-delivery-fees-and-surcharges.md and F12-coupons-and-offers.md. Paths are relative to the API prefix. */
export function pricingRoutes(service: PricingService, staff: AuthResolver, customer: CustomerResolver, names: CustomerNames): Route[] {
  const rules = (h: Parameters<typeof guarded>[2]) => guarded(staff, "delivery_rules:manage", h);
  const ops = (h: Parameters<typeof guarded>[2]) => guarded(staff, "ops_mode:manage", h);
  const pricing = (h: Parameters<typeof guarded>[2]) => guarded(staff, "pricing:manage", h);
  return [
    // `/admin/delivery-rules/preview` must come before `/admin/delivery-rules/:id`.
    { method: "post", path: "/admin/delivery-rules/preview", handler: rules(async (ctx, req, res) => {
      const body = parse(previewBody, req.body);
      sendData(res, await service.preview(ctx, { ...body, at: body.at ?? new Date() }));
    }) },
    { method: "get", path: "/admin/delivery-rules", handler: rules(async (ctx, req, res) => {
      const data = await service.listRules(ctx, parse(rulesQuery, req.query));
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "post", path: "/admin/delivery-rules", handler: rules(async (ctx, req, res) => sendData(res, await service.createRule(ctx, parse(ruleCreate, req.body) as never), 201)) },
    { method: "get", path: "/admin/delivery-rules/:id", handler: rules(async (ctx, req, res) => sendData(res, await service.getRule(ctx, pathId(req, "id", "Rule")))) },
    { method: "put", path: "/admin/delivery-rules/:id", handler: rules(async (ctx, req, res) => sendData(res, await service.updateRule(ctx, pathId(req, "id", "Rule"), parse(ruleUpdate, req.body) as never))) },
    { method: "delete", path: "/admin/delivery-rules/:id", handler: rules(async (ctx, req, res) => sendData(res, await service.deactivateRule(ctx, pathId(req, "id", "Rule")))) },
    { method: "post", path: "/admin/ops/rain", handler: ops(async (ctx, req, res) => {
      const body = parse(rainBody, req.body);
      sendData(res, await service.setRain(ctx, { on: body.on, until: body.until ?? null, zoneIds: body.zoneIds }));
    }) },

    { method: "get", path: "/coupons/available", handler: customerGuarded(customer, async (who, req, res) => {
      const data = await service.available(who.userId, parse(availableQuery, req.query));
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "get", path: "/admin/coupons", handler: pricing(async (ctx, req, res) => {
      const result = await service.listCoupons(ctx, parse(couponsQuery, req.query));
      sendData(res, result.data, 200, { nextCursor: result.nextCursor });
    }) },
    { method: "post", path: "/admin/coupons", handler: pricing(async (ctx, req, res) => sendData(res, await service.createCoupon(ctx, parse(couponCreate, req.body)), 201)) },
    { method: "get", path: "/admin/coupons/:id", handler: pricing(async (ctx, req, res) => sendData(res, await service.getCoupon(ctx, pathId(req, "id", "Coupon")))) },
    { method: "put", path: "/admin/coupons/:id", handler: pricing(async (ctx, req, res) => sendData(res, await service.updateCoupon(ctx, pathId(req, "id", "Coupon"), parse(couponUpdate, req.body) as never))) },
    { method: "post", path: "/admin/coupons/:id/deactivate", handler: pricing(async (ctx, req, res) => sendData(res, await service.deactivateCoupon(ctx, pathId(req, "id", "Coupon")))) },
    { method: "get", path: "/admin/coupons/:id/usage", handler: pricing(async (ctx, req, res) => {
      const result = await service.usage(ctx, pathId(req, "id", "Coupon"), parse(usageQuery, req.query), names);
      sendData(res, result.data, 200, { nextCursor: result.nextCursor, totalDiscount: result.totalDiscount });
    }) },

    { method: "get", path: "/admin/banners", handler: pricing(async (_ctx, _req, res) => sendData(res, await service.listBanners())) },
    { method: "post", path: "/admin/banners", handler: pricing(async (ctx, req, res) => sendData(res, await service.createBanner(ctx, parse(bannerCreate, req.body) as never), 201)) },
    { method: "put", path: "/admin/banners/:id", handler: pricing(async (ctx, req, res) => sendData(res, await service.updateBanner(ctx, pathId(req, "id", "Banner"), parse(bannerUpdate, req.body) as never))) },
    { method: "delete", path: "/admin/banners/:id", handler: pricing(async (ctx, req, res) => sendData(res, await service.deleteBanner(ctx, pathId(req, "id", "Banner")))) },
  ];
}
