import type { Offering, ProductInfo } from "./stock.js";

export type QuantityMode = "copy" | "zero" | "fixed";

export interface PlanOptions { quantityMode: QuantityMode; markupPercent: number; fixedQuantity: number | null }
export interface PlannedVariant {
  variantId: string; label: string; price: number; mrp: number; salePrice: number | null; saleStart: Date | null; saleEnd: Date | null;
  stock: number | null; maxQtyPerOrder: number | null;
}
export interface PlannedLines { stockGrams: number | null; variants: PlannedVariant[] }

/** Apply a percentage to a price in paise. A rounded price never crosses a higher one, so price stays at or below MRP. */
export function markup(paise: number, percent: number): number {
  return percent === 0 ? paise : Math.round(paise * (1 + percent / 100));
}

/** The quantity a new offering starts with, given how the admin chose to carry quantities over. */
export function importedQuantity(options: PlanOptions, sourceQuantity: number): number {
  if (options.quantityMode === "zero") return 0;
  if (options.quantityMode === "fixed") return options.fixedQuantity ?? 0;
  return sourceQuantity;
}

/**
 * What the target warehouse would get from a source offering: only variants that are still active in both the master
 * product and the source, prices with the markup applied, sales that have already ended left out, quantities per the mode.
 */
export function planLines(source: Offering, product: ProductInfo, options: PlanOptions, now: Date): PlannedLines {
  const pooled = product.stockMode === "pooled_weight";
  const variants: PlannedVariant[] = [];
  for (const line of source.variants) {
    const info = product.variants.find(v => v.id === line.variantId);
    if (!line.isActive || !info?.isActive) continue;
    const saleOver = line.saleEnd !== null && line.saleEnd <= now;
    const hasSale = line.salePrice !== null && !saleOver;
    variants.push({
      variantId: line.variantId, label: info.label, price: markup(line.price, options.markupPercent), mrp: markup(line.mrp, options.markupPercent),
      salePrice: hasSale ? markup(line.salePrice as number, options.markupPercent) : null,
      saleStart: hasSale ? line.saleStart : null, saleEnd: hasSale ? line.saleEnd : null,
      stock: pooled ? null : importedQuantity(options, line.stock ?? 0), maxQtyPerOrder: line.maxQtyPerOrder,
    });
  }
  return { stockGrams: pooled ? importedQuantity(options, source.stockGrams ?? 0) : null, variants };
}

/** True when the plan starts the target with any stock; the admin must confirm those quantities. */
export function hasQuantity(lines: PlannedLines): boolean {
  return (lines.stockGrams ?? 0) > 0 || lines.variants.some(v => (v.stock ?? 0) > 0);
}

/** `categoryId` and every category below it. */
export function categoryAndDescendants(categories: readonly { id: string; parentId: string | null }[], categoryId: string): Set<string> {
  const found = new Set<string>([categoryId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const category of categories) {
      if (category.parentId !== null && found.has(category.parentId) && !found.has(category.id)) { found.add(category.id); grew = true; }
    }
  }
  return found;
}
