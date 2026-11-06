import { describe, expect, it } from "vitest";
import { categoryAndDescendants, hasQuantity, importedQuantity, markup, planLines } from "../src/modules/offerings/domain/import.js";
import type { Offering, ProductInfo } from "../src/modules/offerings/domain/stock.js";

const now = new Date("2026-11-05T10:00:00Z");
const line = (over = {}) => ({
  variantId: "v500", price: 3200, mrp: 4000, salePrice: null, saleStart: null, saleEnd: null, stock: null, maxQtyPerOrder: 10, isActive: true, ...over,
});
const source = (over: Partial<Offering> = {}): Offering => ({
  id: "o1", warehouseId: "w1", productId: "p1", zoneId: "z1", status: "active", stockGrams: 24000,
  variants: [line({ variantId: "v250", price: 1800, mrp: 2000 }), line()], isOutOfStockOverride: false, rev: 1, importedFrom: null, createdAt: now, updatedAt: now, ...over,
});
const loose: ProductInfo = {
  id: "p1", name: "Tomato", type: "loose", stockMode: "pooled_weight", categoryId: "c1", status: "active",
  variants: [{ id: "v250", label: "250 g", weightGrams: 250, isActive: true }, { id: "v500", label: "500 g", weightGrams: 500, isActive: true }],
};
const packaged: ProductInfo = {
  id: "p2", name: "Salt", type: "packaged", stockMode: "per_variant", categoryId: "c1", status: "active",
  variants: [{ id: "v1", label: "1 kg", weightGrams: 1000, isActive: true }, { id: "v2", label: "2 kg", weightGrams: 2000, isActive: false }],
};
const copy = { quantityMode: "copy" as const, markupPercent: 0, fixedQuantity: null };

describe("markup", () => {
  it("leaves prices alone at 0 percent and rounds to whole paise otherwise", () => {
    expect(markup(3200, 0)).toBe(3200);
    expect(markup(3200, 5)).toBe(3360);
    expect(markup(1999, 10)).toBe(2199);
    expect(markup(3200, -10)).toBe(2880);
  });
  it("never lets a rounded price pass a higher one", () => {
    for (const percent of [1, 3, 7, 12.5, 99]) expect(markup(1801, percent)).toBeLessThanOrEqual(markup(2000, percent));
  });
});

describe("imported quantity", () => {
  it("copies, zeroes or fixes the quantity", () => {
    expect(importedQuantity(copy, 24000)).toBe(24000);
    expect(importedQuantity({ ...copy, quantityMode: "zero" }, 24000)).toBe(0);
    expect(importedQuantity({ ...copy, quantityMode: "fixed", fixedQuantity: 500 }, 24000)).toBe(500);
  });
});

describe("planning the lines of an import", () => {
  it("copies a pooled offering: grams on the offering and no stock on the variants", () => {
    const plan = planLines(source(), loose, copy, now);
    expect(plan.stockGrams).toBe(24000);
    expect(plan.variants.map(v => [v.variantId, v.label, v.price, v.mrp, v.stock])).toEqual([["v250", "250 g", 1800, 2000, null], ["v500", "500 g", 3200, 4000, null]]);
    expect(hasQuantity(plan)).toBe(true);
  });

  it("copies a per-variant offering and leaves out sizes switched off in the master product or the source", () => {
    const offering = source({ stockGrams: null, variants: [line({ variantId: "v1", stock: 12 }), line({ variantId: "v2", stock: 4 }), line({ variantId: "v3", stock: 1, isActive: false })] });
    const plan = planLines(offering, packaged, copy, now);
    expect(plan.stockGrams).toBeNull();
    expect(plan.variants.map(v => [v.variantId, v.stock])).toEqual([["v1", 12]]);
  });

  it("applies the markup to price, MRP and sale price, and the quantity mode to every quantity", () => {
    const offering = source({ stockGrams: null, variants: [line({ variantId: "v1", stock: 12, salePrice: 3000, saleEnd: new Date("2026-11-07T00:00:00Z") })] });
    const plan = planLines(offering, packaged, { quantityMode: "fixed", markupPercent: 10, fixedQuantity: 3 }, now);
    expect(plan.variants[0]).toMatchObject({ price: 3520, mrp: 4400, salePrice: 3300, stock: 3 });
    expect(plan.variants[0]!.saleEnd).toEqual(new Date("2026-11-07T00:00:00Z"));
    expect(hasQuantity(planLines(source(), loose, { ...copy, quantityMode: "zero" }, now))).toBe(false);
  });

  it("does not copy a sale that has already ended", () => {
    const offering = source({ variants: [line({ salePrice: 3000, saleStart: new Date("2026-11-01T00:00:00Z"), saleEnd: new Date("2026-11-04T00:00:00Z") })] });
    expect(planLines(offering, loose, copy, now).variants[0]).toMatchObject({ salePrice: null, saleStart: null, saleEnd: null });
  });
});

describe("category selection", () => {
  it("includes the category and everything below it", () => {
    const categories = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }, { id: "d", parentId: null }];
    expect([...categoryAndDescendants(categories, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...categoryAndDescendants(categories, "d")]).toEqual(["d"]);
  });
});
