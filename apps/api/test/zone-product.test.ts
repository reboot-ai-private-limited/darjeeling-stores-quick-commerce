import { describe, expect, it } from "vitest";
import type { GeoWarehouse } from "../src/platform/geography.js";
import type { Product } from "../src/modules/catalog/catalog.public.js";
import { latestRev, resolveProduct, sellersOf, type ZoneContext } from "../src/modules/discovery/application/zone-product.js";
import type { Offering, OfferingVariant } from "../src/modules/offerings/offerings.public.js";

const now = new Date("2026-11-05T10:00:00Z");
const at = (iso: string) => new Date(iso);
const wh = (id: string, over: Partial<GeoWarehouse> = {}): GeoWarehouse => ({ id, zoneId: "z1", isEnabled: true, isOpenNow: true, ...over });
const ctx = (warehouses: GeoWarehouse[], over: Partial<ZoneContext> = {}): ZoneContext => ({
  warehouses: new Map(warehouses.map(w => [w.id, w])), zoneOpen: warehouses.some(w => w.isEnabled && w.isOpenNow), now, maxQtyPerItem: null, ...over,
});
const line = (variantId: string, over: Partial<OfferingVariant> = {}): OfferingVariant => ({
  variantId, price: 3200, mrp: 4000, salePrice: null, saleStart: null, saleEnd: null, stock: null, maxQtyPerOrder: null, isActive: true, ...over,
});
const offering = (warehouseId: string, over: Partial<Offering> = {}): Offering => ({
  id: `o-${warehouseId}`, warehouseId, productId: "p1", zoneId: "z1", status: "active", stockGrams: 5000, variants: [line("v500")], isOutOfStockOverride: false,
  rev: 10, importedFrom: null, createdAt: now, updatedAt: now, ...over,
});
const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", vendorId: null, name: "Tomato", nameKey: "tomato", slug: "tomato", description: "", categoryId: "c1", type: "loose", stockMode: "pooled_weight", tags: [],
  images: [], highlights: [], keyInfo: [], nutrition: null, infoSections: [], gstRate: 0, hsnCode: null, status: "active", sortOrder: 0,
  variants: [{ id: "v500", label: "500 g", weightGrams: 500, sku: "TOM-500", barcode: null, isActive: true }], createdAt: now, updatedAt: now, ...over,
});
const resolve = (p: Product, offerings: Offering[], c: ZoneContext) => resolveProduct(p, offerings, c, {});

describe("which offerings count as selling", () => {
  it("needs the offering switched on at a warehouse that is itself enabled", () => {
    const c = ctx([wh("a"), wh("b", { isEnabled: false })]);
    const list = [offering("a"), offering("b"), offering("a", { id: "x", status: "inactive" }), offering("zz")];
    expect(sellersOf(list, c).map(o => o.warehouseId)).toEqual(["a"]);
  });
});

describe("one entry for a zone", () => {
  it("is not sold when nothing sells it, the product is off, or it has no usable size", () => {
    const c = ctx([wh("a")]);
    expect(resolve(product(), [], c)).toBeNull();
    expect(resolve(product(), [offering("a", { status: "inactive" })], c)).toBeNull();
    expect(resolve(product({ status: "inactive" }), [offering("a")], c)).toBeNull();
    expect(resolve(product({ status: "archived" }), [offering("a")], c)).toBeNull();
    expect(resolve(product(), [offering("a", { variants: [line("v500", { isActive: false })] })], c)).toBeNull();
    expect(resolve(product({ variants: [{ id: "v500", label: "500 g", weightGrams: 500, sku: "T", barcode: null, isActive: false }] }), [offering("a")], c)).toBeNull();
  });

  it("is available when an open warehouse has stock, with prices worked out on the server", () => {
    const entry = resolve(product(), [offering("a")], ctx([wh("a")]))!;
    expect(entry).toMatchObject({ id: "p1", available: true, availability: "in_stock", rev: 10 });
    expect(entry.variants).toEqual([{ variantId: "v500", label: "500 g", weightGrams: 500, price: 3200, mrp: 4000, discountAmount: 800, discountPercent: 20, onSale: false, saleEndsAt: null, available: true, maxQty: null }]);
  });

  it("shows the sale price while it runs, with the end time, and the plain price otherwise", () => {
    const sale = (start: string | null, end: string | null) => offering("a", { variants: [line("v500", { salePrice: 3000, saleStart: start ? at(start) : null, saleEnd: end ? at(end) : null })] });
    const during = resolve(product(), [sale("2026-11-05T00:00:00Z", "2026-11-07T00:00:00Z")], ctx([wh("a")]))!.variants[0]!;
    expect(during).toMatchObject({ price: 3000, discountAmount: 1000, discountPercent: 25, onSale: true, saleEndsAt: "2026-11-07T00:00:00.000Z" });
    expect(resolve(product(), [sale(null, null)], ctx([wh("a")]))!.variants[0]).toMatchObject({ price: 3000, onSale: true, saleEndsAt: null });
    expect(resolve(product(), [sale("2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z")], ctx([wh("a")]))!.variants[0]).toMatchObject({ price: 3200, onSale: false });
    expect(resolve(product(), [sale("2026-11-01T00:00:00Z", "2026-11-05T10:00:00Z")], ctx([wh("a")]))!.variants[0]).toMatchObject({ price: 3200, onSale: false, saleEndsAt: null });
  });

  it("takes the price from a warehouse that can actually deliver, falling back to the lowest price when none can", () => {
    const cheapButEmpty = offering("a", { stockGrams: 0, variants: [line("v500", { price: 3000 })] });
    const dearButStocked = offering("b", { variants: [line("v500", { price: 3200 })] });
    expect(resolve(product(), [cheapButEmpty, dearButStocked], ctx([wh("a"), wh("b")]))!.variants[0]!.price).toBe(3200);
    const noneAvailable = [offering("a", { stockGrams: 0, variants: [line("v500", { price: 3300 })] }), offering("b", { stockGrams: 0, variants: [line("v500", { price: 3100 })] })];
    const entry = resolve(product(), noneAvailable, ctx([wh("a"), wh("b")]))!;
    expect(entry.variants[0]).toMatchObject({ price: 3100, available: false });
    expect(entry).toMatchObject({ available: false, availability: "out_of_stock" });
  });

  it("tells sold out from closed: closed only when no warehouse of the zone is taking orders", () => {
    const empty = offering("a", { stockGrams: 0 });
    expect(resolve(product(), [empty], ctx([wh("a"), wh("b")]))!.availability).toBe("out_of_stock");
    expect(resolve(product(), [offering("a")], ctx([wh("a", { isOpenNow: false }), wh("b")]))!.availability).toBe("out_of_stock");
    const closed = resolve(product(), [offering("a")], ctx([wh("a", { isOpenNow: false }), wh("b", { isOpenNow: false })]))!;
    expect(closed).toMatchObject({ available: false, availability: "closed" });
    expect(closed.variants[0]!.available).toBe(false);
  });

  it("does not count stock at a closed warehouse, an out-of-stock switch, or too little for one pack", () => {
    expect(resolve(product(), [offering("a")], ctx([wh("a", { isOpenNow: false }), wh("b")]))!.available).toBe(false);
    expect(resolve(product(), [offering("a", { isOutOfStockOverride: true })], ctx([wh("a")]))!.available).toBe(false);
    expect(resolve(product(), [offering("a", { stockGrams: 499 })], ctx([wh("a")]))!.available).toBe(false);
    expect(resolve(product(), [offering("a", { stockGrams: 500 })], ctx([wh("a")]))!.available).toBe(true);
  });

  it("reads units for a per-variant product", () => {
    const salt = product({ type: "packaged", stockMode: "per_variant", variants: [{ id: "v1", label: "1 kg", weightGrams: 1000, sku: "S", barcode: null, isActive: true }] });
    const o = (stock: number) => offering("a", { stockGrams: null, variants: [line("v1", { stock })] });
    expect(resolve(salt, [o(3)], ctx([wh("a")]))!.available).toBe(true);
    expect(resolve(salt, [o(0)], ctx([wh("a")]))!.available).toBe(false);
  });

  it("limits how many a customer may add to the lowest limit set, among the warehouses that can supply it", () => {
    const capped = (warehouseId: string, cap: number | null) => offering(warehouseId, { variants: [line("v500", { maxQtyPerOrder: cap })] });
    const c = ctx([wh("a"), wh("b")]);
    expect(resolve(product(), [capped("a", 4), capped("b", 10)], c)!.variants[0]!.maxQty).toBe(4);
    expect(resolve(product(), [capped("a", null), capped("b", null)], c)!.variants[0]!.maxQty).toBeNull();
    expect(resolve(product(), [capped("a", null)], ctx([wh("a")], { maxQtyPerItem: 6 }))!.variants[0]!.maxQty).toBe(6);
    expect(resolve(product(), [capped("a", 4)], ctx([wh("a")], { maxQtyPerItem: 6 }))!.variants[0]!.maxQty).toBe(4);
    expect(resolve(product(), [capped("a", 9)], ctx([wh("a")], { maxQtyPerItem: 6 }))!.variants[0]!.maxQty).toBe(6);
  });

  it("orders the pictures, fills in their sizes, and never reveals stock or warehouses", () => {
    const withPictures = product({ images: [{ mediaId: "m2", alt: "Cut", sortOrder: 1 }, { mediaId: "m1", alt: "Whole", sortOrder: 0 }] });
    const entry = resolveProduct(withPictures, [offering("a")], ctx([wh("a")]), { m1: { "320": "https://x/m1/320.webp" } })!;
    expect(entry.images).toEqual([{ mediaId: "m1", alt: "Whole", urls: { "320": "https://x/m1/320.webp" } }, { mediaId: "m2", alt: "Cut", urls: {} }]);
    const text = JSON.stringify(entry);
    for (const word of ["stockGrams", "warehouseId", "isOutOfStockOverride", '"stock"']) expect(text).not.toContain(word);
  });

  it("takes the newest revision of any offering of the product, including ones now switched off", () => {
    const list = [offering("a", { rev: 10 }), offering("b", { rev: 42, status: "inactive" }), offering("zz", { rev: 7 })];
    expect(resolve(product(), list, ctx([wh("a"), wh("b")]))!.rev).toBe(42);
    expect(latestRev(list)).toBe(42);
    expect(latestRev([])).toBe(0);
  });
});
