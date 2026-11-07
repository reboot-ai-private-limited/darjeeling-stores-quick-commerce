import { describe, expect, it } from "vitest";
import {
  assertDistinctSkus, assertExtraCategories, assertTypeMatchesStockMode, assertVariantAttributes, buildTree, nameKey, similarNames, slugify, toCsv, wouldCreateCycle,
  type Category, type Product,
} from "../src/modules/catalog/domain/product.js";

const at = new Date("2026-11-05T00:00:00Z");
const cat = (id: string, parentId: string | null, name = id, sortOrder = 0): Category =>
  ({ id, name, slug: id, parentId, imageMediaId: null, sortOrder, isActive: true, createdAt: at, updatedAt: at });

describe("slugify and nameKey", () => {
  it("makes URL-safe slugs and strips accents", () => {
    expect(slugify("Fresh Tomato (Local)")).toBe("fresh-tomato-local");
    expect(slugify("  Café   Crème!! ")).toBe("cafe-creme");
  });
  it("rejects names with nothing usable", () => {
    expect(() => slugify("!!!")).toThrow("letters or digits");
    expect(() => slugify("दूध")).toThrow("letters or digits");
  });
  it("normalises names for duplicate detection", () => {
    expect(nameKey("Fresh Tomato (Local)")).toBe("freshtomatolocal");
  });
});

describe("product rules", () => {
  it("ties loose items to pooled weight and packaged to per-variant stock", () => {
    expect(() => assertTypeMatchesStockMode("loose", "pooled_weight")).not.toThrow();
    expect(() => assertTypeMatchesStockMode("packaged", "per_variant")).not.toThrow();
    expect(() => assertTypeMatchesStockMode("loose", "per_variant")).toThrow("pooled_weight");
    expect(() => assertTypeMatchesStockMode("packaged", "pooled_weight")).toThrow("per_variant");
  });
  it("rejects a repeated SKU inside one product", () => {
    expect(() => assertDistinctSkus([{ sku: "A" }, { sku: "B" }])).not.toThrow();
    expect(() => assertDistinctSkus([{ sku: "A" }, { sku: "A" }])).toThrow("SKU A");
  });
  it("treats equal or containing names as similar, but not short fragments", () => {
    expect(similarNames("freshtomato", "freshtomatolocal")).toBe(true);
    expect(similarNames("tomato", "tomato")).toBe(true);
    expect(similarNames("tom", "tomato")).toBe(false);
    expect(similarNames("carrot", "tomato")).toBe(false);
    expect(similarNames("", "tomato")).toBe(false);
  });
});

describe("category tree", () => {
  const all = [cat("veg", null, "Vegetables", 2), cat("fruit", null, "Fruits", 1), cat("leafy", "veg", "Leafy"), cat("root", "veg", "Roots", 1)];
  it("nests children and orders siblings by sortOrder then name", () => {
    const tree = buildTree(all);
    expect(tree.map(node => node.id)).toEqual(["fruit", "veg"]);
    expect(tree[1]?.children.map(node => node.id)).toEqual(["leafy", "root"]);
  });
  it("detects a move that would create a cycle", () => {
    expect(wouldCreateCycle(all, "veg", "leafy")).toBe(true);
    expect(wouldCreateCycle(all, "veg", "veg")).toBe(true);
    expect(wouldCreateCycle(all, "leafy", "fruit")).toBe(false);
    expect(wouldCreateCycle(all, "leafy", null)).toBe(false);
  });
});

describe("CSV export", () => {
  const product: Product = {
    id: "p1", vendorId: null, name: "=cmd|' /C calc'!A0", nameKey: "x", slug: "x", description: "", categoryId: "veg",
    type: "loose", stockMode: "pooled_weight", tags: [], highlights: [], keyInfo: [], nutrition: null, infoSections: [], images: [], gstRate: 0, hsnCode: null, status: "active", sortOrder: 0,
    brandId: null, foodType: "not_applicable", extraCategoryIds: [], badge: null, isReturnable: true,
    createdAt: at, updatedAt: at,
    variants: [{ id: "v1", label: "500 g, fresh", weightGrams: 500, sku: "TOM-500", barcode: null, isActive: true, attributes: [] }],
  };
  it("quotes commas and neutralises spreadsheet formulas", () => {
    const csv = toCsv([cat("veg", null, "Vegetables")], [product]);
    const [header, row] = csv.trim().split("\n");
    expect(header).toContain("productId,name,category");
    expect(row).toContain("'=cmd|' /C calc'!A0");
    expect(row).toContain('"500 g, fresh"');
    expect(row?.startsWith("p1,")).toBe(true);
  });
});

describe("variant attributes and extra categories", () => {
  it("allows a few distinct attributes and rejects a repeated name in any case", () => {
    expect(() => assertVariantAttributes([])).not.toThrow();
    expect(() => assertVariantAttributes([{ name: "Flavour", value: "Chocolate" }, { name: "Pack", value: "Tetra" }])).not.toThrow();
    expect(() => assertVariantAttributes([{ name: "Flavour", value: "A" }, { name: " flavour ", value: "B" }])).toThrow(/twice/);
    expect(() => assertVariantAttributes(Array.from({ length: 6 }, (_, i) => ({ name: `n${i}`, value: "v" })))).toThrow(/at most 5/);
  });
  it("keeps extra categories distinct, few, and away from the main category", () => {
    expect(() => assertExtraCategories("a", ["b", "c"])).not.toThrow();
    expect(() => assertExtraCategories("a", [])).not.toThrow();
    expect(() => assertExtraCategories("a", ["a"])).toThrow(/main category/);
    expect(() => assertExtraCategories("a", ["b", "b"])).toThrow(/twice/);
    expect(() => assertExtraCategories("a", ["b", "c", "d", "e", "f", "g"])).toThrow(/at most 5/);
  });
});
