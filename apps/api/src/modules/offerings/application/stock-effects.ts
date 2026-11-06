import {
  availabilityByVariant, availabilityFlipped, isLow, unitsAvailable, type Offering, type ProductInfo, type StockThresholds,
} from "../domain/stock.js";
import type { OfferingsTx, StockEvent } from "./ports.js";

/** The offering as it would be with one stock figure changed. `variantId` is null for the pooled gram stock. */
export function withStock(offering: Offering, variantId: string | null, stock: number): Offering {
  if (variantId === null) return { ...offering, stockGrams: stock };
  return { ...offering, variants: offering.variants.map(v => (v.variantId === variantId ? { ...v, stock } : v)) };
}

export function withZeroStock(product: ProductInfo, offering: Offering): Offering {
  return product.stockMode === "pooled_weight"
    ? { ...offering, stockGrams: 0 }
    : { ...offering, variants: offering.variants.map(v => ({ ...v, stock: 0 })) };
}

/**
 * Work that must follow any stock or availability change, inside the same transaction:
 *  - bump the delta-sync revision when a variant flips between available and unavailable (unless the caller already did),
 *  - note zone-level "back in stock" and low-stock events. Events are only published after the transaction commits.
 */
export async function stockSideEffects(
  tx: OfferingsTx, thresholds: StockThresholds, product: ProductInfo, before: Offering, after: Offering,
  events: StockEvent[], options: { revAlreadyBumped?: boolean } = {},
): Promise<void> {
  const beforeMap = availabilityByVariant(product, before);
  const afterMap = availabilityByVariant(product, after);
  if (!options.revAlreadyBumped && availabilityFlipped(beforeMap, afterMap)) await tx.setRev(after.id, await tx.nextRevision());

  let othersTotals: Map<string, number> | undefined;
  for (const [variantId, units] of afterMap) {
    if (units > 0 && (beforeMap.get(variantId) ?? 0) === 0) {
      if (!othersTotals) {
        othersTotals = new Map();
        for (const other of (await tx.listByZoneProduct(after.zoneId, after.productId)).filter(o => o.id !== after.id)) {
          for (const id of after.variants.map(v => v.variantId)) othersTotals.set(id, (othersTotals.get(id) ?? 0) + unitsAvailable(product, other, id));
        }
      }
      if ((othersTotals.get(variantId) ?? 0) === 0) events.push({ type: "stock.zone_availability_changed", zoneId: after.zoneId, productId: after.productId, variantId });
    }
  }

  if (product.stockMode === "pooled_weight") {
    const [from, to] = [before.stockGrams ?? 0, after.stockGrams ?? 0];
    if (!isLow(product, from, thresholds) && isLow(product, to, thresholds)) {
      events.push({ type: "stock.low", warehouseId: after.warehouseId, productId: after.productId, variantId: null, stock: to, threshold: thresholds.grams });
    }
  } else {
    for (const line of after.variants) {
      const from = before.variants.find(v => v.variantId === line.variantId)?.stock ?? 0;
      const to = line.stock ?? 0;
      if (!isLow(product, from, thresholds) && isLow(product, to, thresholds)) {
        events.push({ type: "stock.low", warehouseId: after.warehouseId, productId: after.productId, variantId: line.variantId, stock: to, threshold: thresholds.units });
      }
    }
  }
}
