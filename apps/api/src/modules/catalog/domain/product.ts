import { validation } from "./errors.js";

export type ProductType = "loose" | "packaged";
export type StockMode = "pooled_weight" | "per_variant";
export type ProductStatus = "active" | "inactive" | "archived";

export interface Variant { id: string; label: string; weightGrams: number; sku: string; barcode: string | null; isActive: boolean }
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
  ]];
  for (const product of products) {
    for (const variant of product.variants) {
      rows.push([product.id, product.name, names.get(product.categoryId) ?? "", product.type, product.stockMode, product.status,
        variant.id, variant.label, variant.weightGrams, variant.sku, variant.barcode, variant.isActive, product.gstRate, product.hsnCode]);
    }
  }
  return `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}
