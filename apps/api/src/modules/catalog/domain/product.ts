import { validation } from "./errors.js";

export type ProductType = "loose" | "packaged";
export type StockMode = "pooled_weight" | "per_variant";
export type ProductStatus = "active" | "inactive" | "archived";

/** What a customer must show on a food product by law in India (the green or brown mark), and a filter ("Pure veg"). Non-food items use not_applicable. */
export type FoodType = "veg" | "non_veg" | "egg" | "vegan" | "not_applicable";
export const FOOD_TYPES: readonly FoodType[] = ["veg", "non_veg", "egg", "vegan", "not_applicable"];
/** The pill shown on a product card. Chosen by staff; the app styles each one. */
export type Badge = "bestseller" | "trending" | "new_launch" | "imported" | "organic";
export const BADGES: readonly Badge[] = ["bestseller", "trending", "new_launch", "imported", "organic"];
/** One way a variant differs beyond weight, for example Flavour: Chocolate or Colour: Red. */
export interface VariantAttribute { name: string; value: string }
export const MAX_VARIANT_ATTRIBUTES = 5;
export const MAX_EXTRA_CATEGORIES = 5;

export interface Variant { id: string; label: string; weightGrams: number; sku: string; barcode: string | null; isActive: boolean; attributes: VariantAttribute[] }
export interface Brand {
  id: string; name: string; slug: string; logoMediaId: string | null; sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
}
export interface ProductImage { mediaId: string; alt: string; sortOrder: number }
export interface KeyInfoRow { label: string; value: string }
export type NutritionUnit = "g" | "mg" | "mcg" | "kcal" | "kJ" | "ml";
export interface NutritionRow { name: string; amount: number; unit: NutritionUnit; dailyValuePercent: number | null }
export interface Nutrition { basis: "per_100g" | "per_100ml" | "per_serving"; servingSize: string | null; rows: NutritionRow[] }
export interface InfoSection { title: string; body: string }
export interface Category {
  id: string; name: string; slug: string; parentId: string | null; imageMediaId: string | null;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
}
export interface Product {
  id: string; vendorId: string | null; name: string; nameKey: string; slug: string; description: string;
  categoryId: string; type: ProductType; stockMode: StockMode; tags: string[]; images: ProductImage[];
  highlights: string[]; keyInfo: KeyInfoRow[]; nutrition: Nutrition | null; infoSections: InfoSection[];
  variants: Variant[]; gstRate: number; hsnCode: string | null; status: ProductStatus; sortOrder: number;
  /** Null when the product has no brand (loose vegetables, for example). */
  brandId: string | null; foodType: FoodType;
  /** The product shows under its main category and under these too. Never contains the main category. */
  extraCategoryIds: string[];
  badge: Badge | null;
  /** False for items that cannot come back once delivered (eggs, cut vegetables, personal care). A damaged or missing item is still refunded. */
  isReturnable: boolean;
  createdAt: Date; updatedAt: Date;
}
export interface CategoryNode extends Category { children: CategoryNode[] }

// shortcut: names with no Latin letters or digits cannot produce a slug; accept an explicit slug when such products are needed.
export function slugify(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  if (!slug) throw validation("Name must contain letters or digits");
  return slug;
}

/** Lower-case letters and digits only; used to spot duplicate or similar product names. */
export function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Loose items are sold from a gram pool; packaged items carry units on each variant. */
export function assertTypeMatchesStockMode(type: ProductType, stockMode: StockMode): void {
  const expected: StockMode = type === "loose" ? "pooled_weight" : "per_variant";
  if (stockMode !== expected) throw validation(`A ${type} product must use stockMode ${expected}`, { field: "stockMode" });
}

/** Labels and nutrient names compare without regard to case or spacing, so "Shelf life" and "shelf  LIFE" count as the same. */
const squash = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const same = (a: string, b: string) => squash(a) === squash(b);

export function assertProductInfo(info: { keyInfo: readonly KeyInfoRow[]; nutrition: Nutrition | null }): void {
  info.keyInfo.forEach((row, i) => {
    if (info.keyInfo.findIndex(other => same(other.label, row.label)) !== i) throw validation(`Key information label "${row.label}" is used twice`, { field: "keyInfo", label: row.label });
  });
  const { nutrition } = info;
  if (!nutrition) return;
  if (nutrition.servingSize !== null && nutrition.basis !== "per_serving") throw validation("servingSize is only allowed when basis is per_serving", { field: "nutrition.servingSize" });
  if (nutrition.basis === "per_serving" && nutrition.servingSize === null) throw validation("servingSize is required when basis is per_serving", { field: "nutrition.servingSize" });
  nutrition.rows.forEach((row, i) => {
    if (nutrition.rows.findIndex(other => same(other.name, row.name)) !== i) throw validation(`Nutrient "${row.name}" is used twice`, { field: "nutrition.rows", name: row.name });
  });
}

/** Attribute names are compared without regard to case; a variant may not list one twice. */
export function assertVariantAttributes(attributes: readonly VariantAttribute[]): void {
  if (attributes.length > MAX_VARIANT_ATTRIBUTES) throw validation(`A variant has at most ${MAX_VARIANT_ATTRIBUTES} attributes`, { field: "attributes" });
  const seen = new Set<string>();
  for (const { name } of attributes) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) throw validation(`Attribute ${name} is listed twice`, { field: "attributes", name });
    seen.add(key);
  }
}

/** Extra categories must be distinct and must not repeat the main one. */
export function assertExtraCategories(primaryId: string, extraIds: readonly string[]): void {
  if (extraIds.length > MAX_EXTRA_CATEGORIES) throw validation(`A product can show in at most ${MAX_EXTRA_CATEGORIES} extra categories`, { field: "extraCategoryIds" });
  if (new Set(extraIds).size !== extraIds.length) throw validation("An extra category is listed twice", { field: "extraCategoryIds" });
  if (extraIds.includes(primaryId)) throw validation("The main category does not need to be listed again", { field: "extraCategoryIds" });
}

export function assertDistinctSkus(variants: readonly { sku: string }[]): void {
  const seen = new Set<string>();
  for (const { sku } of variants) {
    if (seen.has(sku)) throw validation(`SKU ${sku} is used twice in this product`, { field: "sku", sku });
    seen.add(sku);
  }
}

function byOrder(a: Category, b: Category) { return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name); }

export function buildTree(categories: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(categories.map(category => [category.id, { ...category, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const category of [...categories].sort(byOrder)) {
    const node = nodes.get(category.id)!;
    const parent = category.parentId ? nodes.get(category.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** True when moving `id` under `newParentId` would make a category its own ancestor. */
export function wouldCreateCycle(categories: readonly Category[], id: string, newParentId: string | null): boolean {
  const parents = new Map(categories.map(category => [category.id, category.parentId]));
  for (let cursor = newParentId; cursor; cursor = parents.get(cursor) ?? null) {
    if (cursor === id) return true;
  }
  return false;
}

/** Equal or containing names count as similar (length 4+ to avoid noise). */
export function similarNames(candidateKey: string, existingKey: string): boolean {
  if (!candidateKey || !existingKey) return false;
  if (candidateKey === existingKey) return true;
  const [short, long] = candidateKey.length <= existingKey.length ? [candidateKey, existingKey] : [existingKey, candidateKey];
  return short.length >= 4 && long.includes(short);
}

/** Spreadsheet formulas can run when a cell starts with these characters, so prefix them. */
function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(categories: readonly Category[], products: readonly Product[]): string {
  const names = new Map(categories.map(category => [category.id, category.name]));
  const rows: (string | number | boolean | null)[][] = [[
    "productId", "name", "category", "type", "stockMode", "status", "variantId", "variantLabel",
    "weightGrams", "sku", "barcode", "variantActive", "gstRate", "hsnCode",
    "brandId", "foodType", "badge", "returnable", "extraCategories", "attributes",
  ]];
  for (const product of products) {
    for (const variant of product.variants) {
      rows.push([product.id, product.name, names.get(product.categoryId) ?? "", product.type, product.stockMode, product.status,
        variant.id, variant.label, variant.weightGrams, variant.sku, variant.barcode, variant.isActive, product.gstRate, product.hsnCode,
        product.brandId, product.foodType, product.badge, product.isReturnable, product.extraCategoryIds.map(id => names.get(id) ?? id).join("; "),
        variant.attributes.map(a => `${a.name}: ${a.value}`).join("; ")]);
    }
  }
  return `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}
