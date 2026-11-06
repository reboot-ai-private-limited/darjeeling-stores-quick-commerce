import { describe, expect, it } from "vitest";
import { assertProductInfo, type Nutrition } from "../src/modules/catalog/domain/product.js";
import { discountAmount, discountPercent } from "../src/modules/offerings/domain/stock.js";

const nutrition = (patch: Partial<Nutrition> = {}): Nutrition => ({
  basis: "per_100g", servingSize: null, rows: [{ name: "Energy", amount: 18, unit: "kcal", dailyValuePercent: null }], ...patch,
});

describe("discount maths", () => {
  it("works out the amount and whole-number percentage off the MRP", () => {
    expect(discountAmount(4000, 3000)).toBe(1000);
    expect(discountPercent(4000, 3000)).toBe(25);
    expect(discountPercent(4000, 3200)).toBe(20);
    expect(discountPercent(2000, 1800)).toBe(10);
  });
  it("rounds to the nearest whole percent", () => {
    expect(discountPercent(300, 200)).toBe(33);
    expect(discountPercent(300, 100)).toBe(67);
  });
  it("is zero when there is no discount, and never negative or above 100", () => {
    expect(discountAmount(1000, 1000)).toBe(0);
    expect(discountPercent(1000, 1000)).toBe(0);
    expect(discountAmount(1000, 1200)).toBe(0);
    expect(discountPercent(1000, 1200)).toBe(0);
    expect(discountPercent(1000, 0)).toBe(100);
    expect(discountPercent(0, 0)).toBe(0);
  });
});

describe("product information rules", () => {
  it("accepts empty information and a valid table", () => {
    expect(() => assertProductInfo({ keyInfo: [], nutrition: null })).not.toThrow();
    expect(() => assertProductInfo({ keyInfo: [{ label: "Shelf life", value: "5 days" }], nutrition: nutrition() })).not.toThrow();
  });
  it("rejects a repeated key-information label, ignoring case and spacing", () => {
    expect(() => assertProductInfo({ keyInfo: [{ label: "Shelf life", value: "5 days" }, { label: "shelf  LIFE", value: "6" }], nutrition: null })).toThrow(/used twice/);
  });
  it("rejects a repeated nutrient name", () => {
    const rows = [{ name: "Energy", amount: 1, unit: "kcal" as const, dailyValuePercent: null }, { name: "energy", amount: 2, unit: "kJ" as const, dailyValuePercent: null }];
    expect(() => assertProductInfo({ keyInfo: [], nutrition: nutrition({ rows }) })).toThrow(/used twice/);
  });
  it("allows a serving size only, and always, for per-serving tables", () => {
    expect(() => assertProductInfo({ keyInfo: [], nutrition: nutrition({ servingSize: "1 piece" }) })).toThrow(/only allowed/);
    expect(() => assertProductInfo({ keyInfo: [], nutrition: nutrition({ basis: "per_serving" }) })).toThrow(/required/);
    expect(() => assertProductInfo({ keyInfo: [], nutrition: nutrition({ basis: "per_serving", servingSize: "1 piece (30 g)" }) })).not.toThrow();
  });
});
