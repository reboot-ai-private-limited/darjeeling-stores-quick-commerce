import { describe, expect, it } from "vitest";
import {
  availabilityByVariant, availabilityFlipped, bulkPrice, effectivePrice, findPriceConflicts, gramsFor, isLow,
  onSale, pricingProblems, unitsAvailable, type Offering, type OfferingVariant, type ProductInfo,
} from "../src/modules/offerings/domain/stock.js";

const now = new Date("2026-11-05T10:00:00Z");
const variant = (over: Partial<OfferingVariant> = {}): OfferingVariant => ({
  variantId: "v500", price: 3200, mrp: 4000, salePrice: null, saleStart: null, saleEnd: null,
  stock: null, maxQtyPerOrder: null, isActive: true, ...over,
});
const offering = (over: Partial<Offering> = {}): Offering => ({
  id: "o1", warehouseId: "w1", productId: "p1", zoneId: "z1", status: "active", stockGrams: 2000,
  variants: [variant({ variantId: "v250" }), variant()], isOutOfStockOverride: false, rev: 1, importedFrom: null,
  createdAt: now, updatedAt: now, ...over,
});
const loose: ProductInfo = {
  id: "p1", name: "Tomato", type: "loose", stockMode: "pooled_weight", categoryId: "c1", status: "active",
  variants: [{ id: "v250", label: "250 g", weightGrams: 250, isActive: true }, { id: "v500", label: "500 g", weightGrams: 500, isActive: true }],
};
const packaged: ProductInfo = {
  id: "p2", name: "Salt", type: "packaged", stockMode: "per_variant", categoryId: "c1", status: "active",
  variants: [{ id: "v1", label: "1 kg", weightGrams: 1000, isActive: true }],
};

describe("effective price", () => {
  it("applies the sale price only inside its window", () => {
    const v = variant({ salePrice: 3000, saleStart: new Date("2026-11-05T00:00:00Z"), saleEnd: new Date("2026-11-07T00:00:00Z") });
    expect(effectivePrice(v, now)).toBe(3000);
    expect(effectivePrice(v, new Date("2026-11-04T23:59:59Z"))).toBe(3200);
    expect(effectivePrice(v, new Date("2026-11-07T00:00:00Z"))).toBe(3200);
    expect(onSale(variant(), now)).toBe(false);
    expect(effectivePrice(variant({ salePrice: 3000 }), now)).toBe(3000);
  });
});

describe("pricing validation", () => {
  it("accepts a sound price", () => {
    expect(pricingProblems({ price: 3200, mrp: 4000, salePrice: null, saleStart: null, saleEnd: null })).toEqual([]);
  });
  it("rejects bad prices, mrp below price, sale not below price and reversed windows", () => {
    const base = { price: 3200, mrp: 4000, salePrice: null, saleStart: null, saleEnd: null };
    expect(pricingProblems({ ...base, price: 0 }).join()).toMatch(/positive whole number of paise/);
    expect(pricingProblems({ ...base, price: 12.5 }).join()).toMatch(/whole number/);
    expect(pricingProblems({ ...base, mrp: 3000 }).join()).toMatch(/mrp/);
    expect(pricingProblems({ ...base, salePrice: 3200 }).join()).toMatch(/salePrice/);
    expect(pricingProblems({ ...base, saleStart: now }).join()).toMatch(/need a salePrice/);
    expect(pricingProblems({ ...base, salePrice: 3000, saleStart: now, saleEnd: now }).join()).toMatch(/after saleStart/);
  });
});

describe("availability", () => {
  it("derives whole units from the gram pool for loose items", () => {
    expect(gramsFor(500, 3)).toBe(1500);
    expect(unitsAvailable(loose, offering({ stockGrams: 1200 }), "v500")).toBe(2);
    expect(unitsAvailable(loose, offering({ stockGrams: 1200 }), "v250")).toBe(4);
    expect(unitsAvailable(loose, offering({ stockGrams: 499 }), "v500")).toBe(0);
  });
  it("reads units straight from the variant for packaged items", () => {
    const o = offering({ stockGrams: null, variants: [variant({ variantId: "v1", stock: 7 })] });
    expect(unitsAvailable(packaged, o, "v1")).toBe(7);
  });
  it("reports zero when the offering, product, variant or override blocks selling", () => {
    expect(unitsAvailable(loose, offering({ status: "inactive" }), "v500")).toBe(0);
    expect(unitsAvailable({ ...loose, status: "archived" }, offering(), "v500")).toBe(0);
    expect(unitsAvailable(loose, offering({ isOutOfStockOverride: true }), "v500")).toBe(0);
    expect(unitsAvailable(loose, offering({ variants: [variant({ isActive: false })] }), "v500")).toBe(0);
    expect(unitsAvailable(loose, offering(), "unknown")).toBe(0);
  });
  it("notices when any variant flips between available and unavailable", () => {
    const before = availabilityByVariant(loose, offering({ stockGrams: 300 }));
    const same = availabilityByVariant(loose, offering({ stockGrams: 400 }));
    const flipped = availabilityByVariant(loose, offering({ stockGrams: 600 }));
    expect(availabilityFlipped(before, same)).toBe(false);
    expect(availabilityFlipped(before, flipped)).toBe(true);
  });
});

describe("same-zone price rule", () => {
  const other = (over: Partial<Offering> = {}) => offering({ id: "o2", warehouseId: "w2", ...over });
  it("finds no conflict when prices match", () => {
    expect(findPriceConflicts([variant()], [other()], now)).toEqual([]);
  });
  it("reports each other warehouse that sells the variant at a different price", () => {
    const result = findPriceConflicts([variant({ price: 3300, mrp: 4000 })], [other()], now);
    expect(result).toEqual([{ variantId: "v500", conflicts: [{ warehouseId: "w2", price: 3200 }] }]);
  });
  it("compares effective prices, so a sale at one warehouse conflicts", () => {
    const sale = other({ variants: [variant({ salePrice: 3000 })] });
    expect(findPriceConflicts([variant()], [sale], now)).toHaveLength(1);
  });
  it("ignores archived offerings, inactive variants and variants the other warehouse does not sell", () => {
    expect(findPriceConflicts([variant({ price: 9000, mrp: 9000 })], [other({ status: "archived" })], now)).toEqual([]);
    expect(findPriceConflicts([variant({ price: 9000, mrp: 9000 })], [other({ variants: [variant({ isActive: false })] })], now)).toEqual([]);
    expect(findPriceConflicts([variant({ variantId: "new" })], [other()], now)).toEqual([]);
  });
});

describe("bulk price and low stock", () => {
  it("computes the new price for each price action and none for the others", () => {
    expect(bulkPrice({ type: "set_price", value: 5000 }, 3200)).toBe(5000);
    expect(bulkPrice({ type: "price_amount", value: -200 }, 3200)).toBe(3000);
    expect(bulkPrice({ type: "price_percent", value: 5 }, 3200)).toBe(3360);
    expect(bulkPrice({ type: "price_percent", value: -10 }, 3333)).toBe(3000);
    expect(bulkPrice({ type: "set_quantity", value: 5 }, 3200)).toBeNull();
    expect(bulkPrice({ type: "set_status", value: "inactive" }, 3200)).toBeNull();
  });
  it("uses grams for pooled stock and units for per-variant stock", () => {
    const thresholds = { grams: 5000, units: 5 };
    expect(isLow(loose, 4999, thresholds)).toBe(true);
    expect(isLow(loose, 5000, thresholds)).toBe(false);
    expect(isLow(packaged, 4, thresholds)).toBe(true);
    expect(isLow(packaged, 5, thresholds)).toBe(false);
  });
});
