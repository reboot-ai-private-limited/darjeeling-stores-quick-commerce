import { z } from "zod";

export const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const name = z.string().trim().min(1).max(120);
const sku = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, "SKU must be 2-40 letters, digits, dots, dashes or underscores");

export const categoryCreate = z.object({
  name, parentId: id.nullable().default(null), imageMediaId: id.nullable().default(null), sortOrder: z.number().int().min(0).default(0),
}).strict();
export const categoryUpdate = z.object({
  name: name.optional(), parentId: id.nullable().optional(), imageMediaId: id.nullable().optional(),
  sortOrder: z.number().int().min(0).optional(), isActive: z.boolean().optional(),
}).strict();
export const reorderBody = z.object({ parentId: id.nullable(), orderedIds: z.array(id).max(500) }).strict();

const attribute = z.object({ name: z.string().trim().min(1).max(30), value: z.string().trim().min(1).max(60) }).strict();
const attributes = z.array(attribute).max(5);
const variantFields = {
  label: z.string().trim().min(1).max(40), weightGrams: z.number().int().min(1).max(100_000), sku,
  barcode: z.string().trim().min(1).max(40).nullable(),
};
export const variantCreate = z.object({ ...variantFields, barcode: variantFields.barcode.default(null), attributes: attributes.default([]) }).strict();
export const variantUpdate = z.object({
  label: variantFields.label.optional(), weightGrams: variantFields.weightGrams.optional(), sku: sku.optional(),
  barcode: variantFields.barcode.optional(), isActive: z.boolean().optional(), attributes: attributes.optional(),
}).strict();

const keyInfoRow = z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(200) }).strict();
const nutritionRow = z.object({
  name: z.string().trim().min(1).max(60), amount: z.number().min(0).max(1_000_000), unit: z.enum(["g", "mg", "mcg", "kcal", "kJ", "ml"]),
  dailyValuePercent: z.number().min(0).max(1000).nullable().default(null),
}).strict();
const nutrition = z.object({
  basis: z.enum(["per_100g", "per_100ml", "per_serving"]), servingSize: z.string().trim().min(1).max(40).nullable().default(null),
  rows: z.array(nutritionRow).max(20),
}).strict().nullable();
const infoSection = z.object({ title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(1000) }).strict();
const productInfo = {
  highlights: z.array(z.string().trim().min(1).max(120)).max(6),
  keyInfo: z.array(keyInfoRow).max(15), nutrition, infoSections: z.array(infoSection).max(15),
};

const productFields = {
  description: z.string().trim().max(2000), categoryId: id, type: z.enum(["loose", "packaged"]),
  stockMode: z.enum(["pooled_weight", "per_variant"]), tags: z.array(z.string().trim().min(1).max(30)).max(20),
  gstRate: z.number().min(0).max(28), hsnCode: z.string().trim().regex(/^\d{4,8}$/, "HSN must be 4-8 digits").nullable(),
  status: z.enum(["active", "inactive"]), sortOrder: z.number().int().min(0),
  brandId: id.nullable(), foodType: z.enum(["veg", "non_veg", "egg", "vegan", "not_applicable"]), extraCategoryIds: z.array(id).max(5),
  badge: z.enum(["bestseller", "trending", "new_launch", "imported", "organic"]).nullable(), isReturnable: z.boolean(),
};
export const productCreate = z.object({
  name, description: productFields.description.default(""), categoryId: productFields.categoryId,
  type: productFields.type, stockMode: productFields.stockMode, tags: productFields.tags.default([]),
  highlights: productInfo.highlights.default([]), keyInfo: productInfo.keyInfo.default([]),
  nutrition: productInfo.nutrition.default(null), infoSections: productInfo.infoSections.default([]),
  variants: z.array(z.object({ ...variantFields, barcode: variantFields.barcode.default(null), attributes: attributes.default([]) }).strict()).min(1).max(20),
  gstRate: productFields.gstRate.default(0), hsnCode: productFields.hsnCode.default(null),
  status: productFields.status.default("inactive"), sortOrder: productFields.sortOrder.default(0),
  brandId: productFields.brandId.default(null), foodType: productFields.foodType.default("not_applicable"), extraCategoryIds: productFields.extraCategoryIds.default([]),
  badge: productFields.badge.default(null), isReturnable: productFields.isReturnable.default(true),
}).strict();
export const productUpdate = z.object({
  name: name.optional(), description: productFields.description.optional(), categoryId: productFields.categoryId.optional(),
  type: productFields.type.optional(), stockMode: productFields.stockMode.optional(), tags: productFields.tags.optional(),
  highlights: productInfo.highlights.optional(), keyInfo: productInfo.keyInfo.optional(),
  nutrition: productInfo.nutrition.optional(), infoSections: productInfo.infoSections.optional(),
  gstRate: productFields.gstRate.optional(), hsnCode: productFields.hsnCode.optional(),
  status: productFields.status.optional(), sortOrder: productFields.sortOrder.optional(),
  brandId: productFields.brandId.optional(), foodType: productFields.foodType.optional(), extraCategoryIds: productFields.extraCategoryIds.optional(),
  badge: productFields.badge.optional(), isReturnable: productFields.isReturnable.optional(),
}).strict();

export const productListQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(), categoryId: id.optional(), brandId: id.optional(),
  foodType: z.enum(["veg", "non_veg", "egg", "vegan", "not_applicable"]).optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(), type: z.enum(["loose", "packaged"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(100).optional(),
});

export const brandCreate = z.object({ name, logoMediaId: id.nullable().default(null), sortOrder: z.number().int().min(0).default(0) }).strict();
export const brandUpdate = z.object({ name: name.optional(), logoMediaId: id.nullable().optional(), sortOrder: z.number().int().min(0).optional(), isActive: z.boolean().optional() }).strict();

export const imageAttach = z.object({ mediaId: id, alt: z.string().trim().max(200).default("") }).strict();
export const imageOrder = z.object({ orderedMediaIds: z.array(id).max(20) }).strict();
export const duplicateCheck = z.object({ name, skus: z.array(sku).max(20).default([]) }).strict();
