import type { GeoWarehouse } from "../../../platform/geography.js";
import type { Badge, FoodType, Product, VariantAttribute } from "../../catalog/catalog.public.js";
import { discountAmount, discountPercent, effectivePrice, onSale, unitsAvailable, type Offering, type OfferingVariant, type ProductInfo } from "../../offerings/offerings.public.js";

export interface ZoneContext {
  warehouses: ReadonlyMap<string, GeoWarehouse>;
  /** Active brands by id, for the name on a product card. */
  brands: ReadonlyMap<string, { id: string; name: string }>;
  /** At least one warehouse of the zone is taking orders now. */
  zoneOpen: boolean;
  now: Date;
  maxQtyPerItem: number | null;
}

export interface ZoneVariant {
  variantId: string; label: string; weightGrams: number; attributes: VariantAttribute[]; price: number; mrp: number; discountAmount: number; discountPercent: number;
  onSale: boolean; saleEndsAt: string | null; available: boolean; maxQty: number | null;
}
export interface ZoneProduct {
  id: string; name: string; slug: string; categoryId: string; type: string; tags: string[];
  /** The main category first, then the extra ones the product also shows under. */
  categoryIds: string[];
  brand: { id: string; name: string } | null; foodType: FoodType; badge: Badge | null;
  /** False when the item cannot be sent back once delivered (a damaged or missing item is still refunded). */
  isReturnable: boolean;
  images: { mediaId: string; alt: string; urls: Record<string, string> }[];
  variants: ZoneVariant[]; available: boolean; availability: "in_stock" | "out_of_stock" | "closed"; rev: number;
}

const infoOf = (p: Product): ProductInfo => ({
  id: p.id, name: p.name, type: p.type, stockMode: p.stockMode, categoryId: p.categoryId, status: p.status,
  variants: p.variants.map(v => ({ id: v.id, label: v.label, weightGrams: v.weightGrams, isActive: v.isActive })),
});

/** The offerings that actually sell this product in the zone: switched on, at a warehouse that is itself enabled. */
export function sellersOf(offerings: readonly Offering[], ctx: ZoneContext): Offering[] {
  return offerings.filter(o => o.status === "active" && ctx.warehouses.get(o.warehouseId)?.isEnabled === true);
}

/**
 * What a customer sees for a product in a zone, or null when the zone does not sell it. The zone's warehouses are merged into
 * one entry: the same-zone price rule means they agree on the price, a size is available if any open warehouse has stock, and
 * no stock figure or warehouse is ever shown.
 */
export function resolveProduct(product: Product, offerings: readonly Offering[], ctx: ZoneContext, urls: Record<string, Record<string, string>>): ZoneProduct | null {
  const sellers = sellersOf(offerings, ctx);
  if (product.status !== "active" || sellers.length === 0) return null;
  const info = infoOf(product);
  const variants: ZoneVariant[] = [];

  for (const variant of product.variants.filter(v => v.isActive)) {
    const lines = sellers.flatMap(offering => {
      const line = offering.variants.find(l => l.variantId === variant.id && l.isActive);
      return line ? [{ offering, line }] : [];
    });
    if (lines.length === 0) continue;
    const available = lines.filter(({ offering }) => ctx.warehouses.get(offering.warehouseId)!.isOpenNow && unitsAvailable(info, offering, variant.id) > 0);
    // Customers pay the same everywhere in the zone; when the rule is briefly out of step, show the lowest price they could get.
    const pool = available.length > 0 ? available : lines;
    const best = pool.reduce((a, b) => (effectivePrice(b.line, ctx.now) < effectivePrice(a.line, ctx.now) ? b : a)).line;
    const price = effectivePrice(best, ctx.now);
    const caps = pool.map(({ line }) => line.maxQtyPerOrder).filter((n): n is number => n !== null);
    const limits = [...caps, ...(ctx.maxQtyPerItem !== null ? [ctx.maxQtyPerItem] : [])];
    variants.push({
      variantId: variant.id, label: variant.label, weightGrams: variant.weightGrams, attributes: variant.attributes, price, mrp: best.mrp,
      discountAmount: discountAmount(best.mrp, price), discountPercent: discountPercent(best.mrp, price),
      onSale: onSale(best, ctx.now), saleEndsAt: onSale(best, ctx.now) ? (best.saleEnd?.toISOString() ?? null) : null,
      available: available.length > 0, maxQty: limits.length > 0 ? Math.min(...limits) : null,
    });
  }
  if (variants.length === 0) return null;

  const available = variants.some(v => v.available);
  return {
    id: product.id, name: product.name, slug: product.slug, categoryId: product.categoryId, type: product.type, tags: product.tags,
    categoryIds: [product.categoryId, ...product.extraCategoryIds],
    brand: (product.brandId ? ctx.brands.get(product.brandId) : undefined) ?? null, foodType: product.foodType, badge: product.badge, isReturnable: product.isReturnable,
    images: [...product.images].sort((a, b) => a.sortOrder - b.sortOrder).map(i => ({ mediaId: i.mediaId, alt: i.alt, urls: urls[i.mediaId] ?? {} })),
    variants, available, availability: available ? "in_stock" : ctx.zoneOpen ? "out_of_stock" : "closed",
    // The newest change to anything that sells this product here, including offerings now switched off.
    rev: offerings.reduce((max, o) => Math.max(max, o.rev), 0),
  };
}

/** The highest revision among a product's offerings in the zone, for a removal notice. */
export const latestRev = (offerings: readonly Offering[]) => offerings.reduce((max, o) => Math.max(max, o.rev), 0);

export type { OfferingVariant };
