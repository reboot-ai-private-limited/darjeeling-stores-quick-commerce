import { z } from "zod";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
/** Money is a whole number of paise. */
const paise = z.number().int().min(1).max(100_000_000);
const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const stockAmount = z.number().int().min(0).max(1_000_000_000);
const offeringStatus = z.enum(["active", "inactive", "archived"]);

const variantCreate = z.object({
  variantId: id, price: paise, mrp: paise, salePrice: paise.nullable().default(null),
  saleStart: instant.nullable().default(null), saleEnd: instant.nullable().default(null),
  stock: stockAmount.nullable().default(null), maxQtyPerOrder: z.number().int().min(1).max(1000).nullable().default(null),
}).strict();
export const createBody = z.object({
  warehouseId: id, productId: id, stockGrams: stockAmount.nullable().default(null), variants: z.array(variantCreate).min(1).max(20),
}).strict();

const variantPatch = z.object({
  variantId: id, price: paise.optional(), mrp: paise.optional(), salePrice: paise.nullable().optional(),
  saleStart: instant.nullable().optional(), saleEnd: instant.nullable().optional(), stock: stockAmount.nullable().optional(),
  maxQtyPerOrder: z.number().int().min(1).max(1000).nullable().optional(), isActive: z.boolean().optional(),
}).strict();
export const updateBody = z.object({
  rev: z.number().int().min(0), status: offeringStatus.optional(), stockGrams: stockAmount.optional(),
  isOutOfStockOverride: z.boolean().optional(), variants: z.array(variantPatch).max(20).optional(),
  applyToWarehouseIds: z.array(id).max(20).optional(),
}).strict();

export const bulkBody = z.object({
  ids: z.array(id).min(1).max(200),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("set_price"), value: paise }).strict(),
    z.object({ type: z.literal("price_amount"), value: z.number().int().min(-100_000_000).max(100_000_000) }).strict(),
    z.object({ type: z.literal("price_percent"), value: z.number().min(-90).max(500) }).strict(),
    z.object({ type: z.literal("set_quantity"), value: stockAmount }).strict(),
    z.object({ type: z.literal("add_quantity"), value: z.number().int().min(-1_000_000_000).max(1_000_000_000) }).strict(),
    z.object({ type: z.literal("set_status"), value: offeringStatus }).strict(),
  ]),
}).strict();

export const adjustBody = z.object({
  warehouseId: id, productId: id, variantId: id.nullable().default(null),
  delta: z.number().int().min(-1_000_000_000).max(1_000_000_000), reason: z.enum(["purchase", "wastage", "correction"]),
  note: z.string().trim().max(200).nullable().default(null),
}).strict();
export const countBody = z.object({
  warehouseId: id,
  counts: z.array(z.object({ productId: id, variantId: id.nullable().default(null), counted: stockAmount }).strict()).min(1).max(200),
}).strict();

const flag = z.enum(["true", "false"]).transform(value => value === "true");
const limit = z.coerce.number().int().min(1).max(100).default(50);
const cursor = z.string().max(100).optional();
export const listQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(), categoryId: id.optional(), status: offeringStatus.optional(),
  lowStock: flag.optional(), limit, cursor,
});
export const levelsQuery = z.object({ warehouseId: id.optional(), lowStock: flag.optional(), limit, cursor });
export const movementsQuery = z.object({
  warehouseId: id.optional(), productId: id.optional(),
  reason: z.enum(["order", "cancel", "return", "purchase", "correction", "wastage", "count", "import"]).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit, cursor,
});
export const historyQuery = z.object({
  warehouseId: id.optional(), productId: id.optional(), variantId: id.optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit, cursor,
});
