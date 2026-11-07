import type { ScopeHint, SettingsProvider } from "../platform/settings.js";
import type { CartSettings } from "../modules/cart/cart.public.js";
import type { HoursSettings } from "../modules/hours/hours.public.js";
import type { StockThresholds } from "../modules/offerings/offerings.public.js";
import type { PricingSettings } from "../modules/pricing/pricing.public.js";
import type { Group, ScopeRef, SettingsService } from "../modules/settings/settings.public.js";

const scopeOf = (hint?: ScopeHint): ScopeRef =>
  hint?.warehouseId ? { type: "warehouse", id: hint.warehouseId } : hint?.zoneId ? { type: "zone", id: hint.zoneId } : { type: "global", id: null };

/**
 * Live settings for the modules, read from the admin settings on each use, so a change an owner makes applies on the next request.
 * A warehouse value wins over its zone\x27s, which wins over the global one, which wins over the built-in default.
 */
export function createSettingsProviders(settings: SettingsService) {
  const read = (hint: ScopeHint | undefined, ...groups: Group[]) => Promise.all(groups.map(group => settings.effectiveValues(group, scopeOf(hint))));
  const num = (v: unknown) => Number(v);

  const cart: SettingsProvider<CartSettings> = async hint => {
    const [orders, eta, payments, tax, delivery] = await read(hint, "orders", "eta", "payments", "tax", "delivery");
    return {
      quoteValiditySeconds: num(orders!.quoteValiditySeconds), maxItemsPerOrder: num(orders!.maxItemsPerOrder), maxQtyPerItem: num(orders!.maxQtyPerItem),
      maxSplitsPerOrder: num(orders!.maxSplitsPerOrder), defaultMinOrder: num(orders!.defaultMinOrder), packMinutes: num(eta!.packMinutes),
      riderArrivalMinutes: num(eta!.riderArrivalMinutes), codMaxAmount: num(payments!.codMaxAmount), taxInclusive: tax!.taxInclusive === true,
      tipsEnabled: delivery!.tipsEnabled === true, tipMaxAmount: num(delivery!.tipMaxAmount), tipPresets: [num(delivery!.tipPreset1), num(delivery!.tipPreset2), num(delivery!.tipPreset3)],
    };
  };
  const pricing: SettingsProvider<PricingSettings> = async hint => {
    const [discounts] = await read(hint, "discounts");
    const cap = num(discounts!.surchargeCap);
    return { surchargeCap: cap === 0 ? null : cap, rainDefaults: { amount: num(discounts!.rainSurchargeAmount), extraMinutes: num(discounts!.rainExtraMinutes) } };
  };
  const stockThresholds: SettingsProvider<StockThresholds> = async hint => {
    const [stock] = await read(hint, "stock");
    return { grams: num(stock!.lowStockGrams), units: num(stock!.lowStockUnits) };
  };
  const priceConflictMode = async (): Promise<"block" | "warn"> => ((await settings.effectiveValues("stock")).zonePriceConflictMode === "warn" ? "warn" : "block");
  const hours: SettingsProvider<HoursSettings> = async hint => {
    const [hoursValues, preOrder] = await read(hint, "hours", "preOrder");
    return {
      lastOrderMinutesBeforeClose: num(hoursValues!.lastOrderMinutesBeforeClose), afterHoursMode: hoursValues!.afterHoursMode === "pre_order" ? "pre_order" : "closed",
      cutoffMinutesBeforeSlot: num(preOrder!.cutoffMinutesBeforeSlot), packLeadMinutes: num(preOrder!.packLeadMinutes),
    };
  };
  return { cart, pricing, stockThresholds, priceConflictMode, hours };
}

export type SettingsProviders = ReturnType<typeof createSettingsProviders>;
