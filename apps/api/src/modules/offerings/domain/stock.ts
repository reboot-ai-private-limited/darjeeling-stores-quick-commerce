export type OfferingStatus = "active" | "inactive" | "archived";

export interface OfferingVariant {
  variantId: string; price: number; mrp: number;
  salePrice: number | null; saleStart: Date | null; saleEnd: Date | null;
  /** Units, only for per-variant products. */
  stock: number | null; maxQtyPerOrder: number | null; isActive: boolean;
}

/** One warehouse's price and stock for one master product. */
export interface Offering {
  id: string; warehouseId: string; productId: string; zoneId: string; status: OfferingStatus;
  /** Gram pool, only for pooled-weight (loose) products. */
  stockGrams: number | null; variants: OfferingVariant[]; isOutOfStockOverride: boolean;
  rev: number; importedFrom: { warehouseId: string; at: Date; by: string } | null; createdAt: Date; updatedAt: Date;
}

/** The slice of the master product that stock and pricing rules need. */
export interface ProductInfo {
  id: string; name: string; type: "loose" | "packaged"; stockMode: "pooled_weight" | "per_variant";
  categoryId: string; status: "active" | "inactive" | "archived";
  variants: { id: string; label: string; weightGrams: number; isActive: boolean }[];
}

export interface StockThresholds { grams: number; units: number }

export function onSale(variant: OfferingVariant, now: Date): boolean {
  if (variant.salePrice === null) return false;
  if (variant.saleStart && now < variant.saleStart) return false;
  if (variant.saleEnd && now >= variant.saleEnd) return false;
  return true;
}

/** What the customer pays right now (sale price applied inside its window). */
export function effectivePrice(variant: OfferingVariant, now: Date): number {
  return onSale(variant, now) ? (variant.salePrice as number) : variant.price;
}

/** Rupees off the MRP in paise, never below zero. */
export function discountAmount(mrp: number, effective: number): number { return Math.max(0, mrp - effective); }

/** Whole-number percentage off the MRP, 0 to 100. */
export function discountPercent(mrp: number, effective: number): number {
  return mrp > 0 ? Math.min(100, Math.round((discountAmount(mrp, effective) / mrp) * 100)) : 0;
}

export function gramsFor(weightGrams: number, qty: number): number { return weightGrams * qty; }

function productVariant(product: ProductInfo, variantId: string) { return product.variants.find(v => v.id === variantId); }

/** False when the offering, product, variant or a manual out-of-stock switch blocks selling, regardless of stock. */
export function isSellable(product: ProductInfo, offering: Offering, variantId: string): boolean {
  const info = productVariant(product, variantId);
  const line = offering.variants.find(v => v.variantId === variantId);
  if (!info || !line || !info.isActive || !line.isActive) return false;
  return offering.status === "active" && product.status === "active" && !offering.isOutOfStockOverride;
}

/** How many whole units of the variant this warehouse can sell now (0 when it cannot be sold at all). */
export function unitsAvailable(product: ProductInfo, offering: Offering, variantId: string): number {
  if (!isSellable(product, offering, variantId)) return 0;
  const line = offering.variants.find(v => v.variantId === variantId)!;
  if (product.stockMode === "pooled_weight") return Math.floor((offering.stockGrams ?? 0) / productVariant(product, variantId)!.weightGrams);
  return Math.max(0, line.stock ?? 0);
}

export function availabilityByVariant(product: ProductInfo, offering: Offering): Map<string, number> {
  return new Map(offering.variants.map(line => [line.variantId, unitsAvailable(product, offering, line.variantId)]));
}

/** True when any variant went from unavailable to available (or back), which clients must hear about through delta sync. */
export function availabilityFlipped(before: Map<string, number>, after: Map<string, number>): boolean {
  for (const [variantId, units] of after) if ((before.get(variantId) ?? 0) > 0 !== units > 0) return true;
  return false;
}

export interface PricingInput { price: number; mrp: number; salePrice: number | null; saleStart: Date | null; saleEnd: Date | null }

export function pricingProblems(v: PricingInput): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(v.price) || v.price <= 0) problems.push("price must be a positive whole number of paise");
  if (!Number.isInteger(v.mrp) || v.mrp < v.price) problems.push("mrp must be a whole number of paise and not below price");
  if (v.salePrice !== null && (!Number.isInteger(v.salePrice) || v.salePrice <= 0 || v.salePrice >= v.price)) problems.push("salePrice must be a positive whole number below price");
  if (v.salePrice === null && (v.saleStart || v.saleEnd)) problems.push("saleStart and saleEnd need a salePrice");
  if (v.saleStart && v.saleEnd && v.saleEnd <= v.saleStart) problems.push("saleEnd must be after saleStart");
  return problems;
}

export interface PriceConflict { variantId: string; conflicts: { warehouseId: string; price: number }[] }

/**
 * Same product in several warehouses of one zone must sell at the same price, so customers see one price.
 * shortcut: compares today's effective price only; future sale windows are not compared. Revisit when scheduled sales go live.
 */
export function findPriceConflicts(variants: readonly OfferingVariant[], others: readonly Offering[], now: Date): PriceConflict[] {
  const result: PriceConflict[] = [];
  for (const variant of variants) {
    const mine = effectivePrice(variant, now);
    const conflicts: PriceConflict["conflicts"] = [];
    for (const other of others) {
      if (other.status === "archived") continue;
      const line = other.variants.find(v => v.variantId === variant.variantId && v.isActive);
      if (!line) continue;
      const theirs = effectivePrice(line, now);
      if (theirs !== mine) conflicts.push({ warehouseId: other.warehouseId, price: theirs });
    }
    if (conflicts.length > 0) result.push({ variantId: variant.variantId, conflicts });
  }
  return result;
}

export type BulkAction =
  | { type: "set_price" | "price_amount" | "price_percent" | "set_quantity" | "add_quantity"; value: number }
  | { type: "set_status"; value: OfferingStatus };

/** New base price after a price action. `null` means the action does not change prices. */
export function bulkPrice(action: BulkAction, price: number): number | null {
  switch (action.type) {
    case "set_price": return action.value;
    case "price_amount": return price + action.value;
    case "price_percent": return Math.round(price * (1 + action.value / 100));
    default: return null;
  }
}

/** Below threshold counts as low. Pooled stock is in grams, per-variant stock in units. */
export function isLow(product: ProductInfo, amount: number, thresholds: StockThresholds): boolean {
  return amount < (product.stockMode === "pooled_weight" ? thresholds.grams : thresholds.units);
}
