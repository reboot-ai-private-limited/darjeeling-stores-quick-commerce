import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W3, admin, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("product_info_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); });
beforeEach(async () => { await f.reset(); });

const info = {
  highlights: ["Grown on Darjeeling hill farms", "No added colour or wax"],
  keyInfo: [{ label: "Shelf life", value: "5 days" }, { label: "Storage", value: "Keep in a cool, dry place" }],
  nutrition: { basis: "per_100g", servingSize: null, rows: [{ name: "Energy", amount: 18, unit: "kcal", dailyValuePercent: null }, { name: "Protein", amount: 0.9, unit: "g", dailyValuePercent: 2 }] },
  infoSections: [{ title: "How to store", body: "Refrigerate after cutting." }],
};

let counter = 0;
async function create(extra: Record<string, unknown> = {}, who = admin) {
  counter++;
  return f.send("post", "/admin/products", {
    name: `Tomato ${counter}`, categoryId: await f.category(), type: "loose", stockMode: "pooled_weight",
    variants: [{ label: "500 g", weightGrams: 500, sku: `INFO-${counter}` }], ...extra,
  }, who);
}

describe("product information", () => {
  it("stores and returns highlights, key information, nutrition and info sections", async () => {
    const res = await create(info);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject(info);
    const got = await f.get(`/admin/products/${res.body.data.id}`);
    expect(got.body.data).toMatchObject(info);
    expect((await f.get("/admin/products")).body.data[0]).toMatchObject({ highlights: info.highlights });
  });

  it("returns empty values rather than missing fields when nothing is set", async () => {
    const res = await create();
    expect(res.body.data).toMatchObject({ highlights: [], keyInfo: [], nutrition: null, infoSections: [] });
  });

  it("reads back products stored before these fields existed with empty values", async () => {
    const res = await create(info);
    await f.h.connection.collection("products").updateOne({ _id: res.body.data.id as never }, { $unset: { highlights: "", keyInfo: "", nutrition: "", infoSections: "" } });
    const got = await f.get(`/admin/products/${res.body.data.id}`);
    expect(got.body.data).toMatchObject({ highlights: [], keyInfo: [], nutrition: null, infoSections: [] });
  });

  it("replaces a field when sent, keeps it when omitted, and clears it with null or an empty list", async () => {
    const id = (await create(info)).body.data.id;
    const keep = await f.send("put", `/admin/products/${id}`, { description: "New text" });
    expect(keep.body.data).toMatchObject(info);
    const replaced = await f.send("put", `/admin/products/${id}`, { keyInfo: [{ label: "Origin", value: "Darjeeling" }], highlights: [] });
    expect(replaced.body.data).toMatchObject({ keyInfo: [{ label: "Origin", value: "Darjeeling" }], highlights: [], nutrition: info.nutrition, infoSections: info.infoSections });
    const cleared = await f.send("put", `/admin/products/${id}`, { nutrition: null, infoSections: [] });
    expect(cleared.body.data).toMatchObject({ nutrition: null, infoSections: [] });
  });

  it("validates limits, units, repeated labels and serving size", async () => {
    const bad = async (extra: Record<string, unknown>) => (await create(extra)).status;
    expect(await bad({ highlights: Array(7).fill("x") })).toBe(400);
    expect(await bad({ highlights: ["x".repeat(121)] })).toBe(400);
    expect(await bad({ keyInfo: Array.from({ length: 16 }, (_, i) => ({ label: `L${i}`, value: "v" })) })).toBe(400);
    expect(await bad({ keyInfo: [{ label: "", value: "v" }] })).toBe(400);
    expect(await bad({ keyInfo: [{ label: "A", value: "x".repeat(201) }] })).toBe(400);
    expect(await bad({ keyInfo: [{ label: "Shelf life", value: "1" }, { label: "shelf life", value: "2" }] })).toBe(400);
    expect(await bad({ nutrition: { ...info.nutrition, rows: [{ name: "Energy", amount: 1, unit: "calories" }] } })).toBe(400);
    expect(await bad({ nutrition: { ...info.nutrition, rows: [{ name: "Energy", amount: -1, unit: "kcal" }] } })).toBe(400);
    expect(await bad({ nutrition: { ...info.nutrition, rows: Array.from({ length: 21 }, (_, i) => ({ name: `N${i}`, amount: 1, unit: "g" })) } })).toBe(400);
    expect(await bad({ nutrition: { ...info.nutrition, servingSize: "1 piece" } })).toBe(400);
    expect(await bad({ nutrition: { basis: "per_serving", rows: [] } })).toBe(400);
    expect(await bad({ infoSections: Array(16).fill({ title: "t", body: "b" }) })).toBe(400);
    expect(await bad({ infoSections: [{ title: "t", body: "b".repeat(1001) }] })).toBe(400);
    expect(await bad({ unknownField: 1 })).toBe(400);
    const ok = await create({ nutrition: { basis: "per_serving", servingSize: "1 piece (30 g)", rows: [] } });
    expect(ok.status).toBe(201);
    const id = (await create(info)).body.data.id;
    const dup = await f.send("put", `/admin/products/${id}`, { keyInfo: [{ label: "A", value: "1" }, { label: "a", value: "2" }] });
    expect(dup.status).toBe(400);
    const servingOnly = await f.send("put", `/admin/products/${id}`, { nutrition: { basis: "per_100g", servingSize: "x", rows: [] } });
    expect(servingOnly.status).toBe(400);
    expect((await f.get(`/admin/products/${id}`)).body.data.keyInfo).toEqual(info.keyInfo);
  });

  it("needs catalog:manage to write", async () => {
    expect((await create(info, viewer)).status).toBe(403);
  });

  it("gives offerings a new revision when the information changes", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W1, p, 1000);
    await f.send("put", `/admin/products/${p.id}`, { highlights: ["Fresh"] });
    expect((await f.get(`/admin/warehouse-products/${o.id}`)).body.data.rev).toBeGreaterThan(o.rev);
  });
});

describe("price and discount fields", () => {
  it("computes effective price, sale flag, discount amount and percentage on every read", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 10000);
    const lines = (await f.get(`/admin/warehouse-products/${o.id}`)).body.data.variants;
    expect(lines[0]).toMatchObject({ price: 1800, mrp: 2000, effectivePrice: 1800, onSale: false, discountAmount: 200, discountPercent: 10 });
    expect(lines[1]).toMatchObject({ price: 3200, mrp: 4000, effectivePrice: 3200, onSale: false, discountAmount: 800, discountPercent: 20 });
    const sale = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, salePrice: 3000, saleStart: "2026-01-01T00:00:00Z", saleEnd: "2099-01-01T00:00:00Z" }] });
    expect(sale.body.data.variants[1]).toMatchObject({ price: 3200, salePrice: 3000, effectivePrice: 3000, onSale: true, discountAmount: 1000, discountPercent: 25 });
  });

  it("falls back to the regular price when the sale has ended or not yet started", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 10000);
    const ended = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, salePrice: 3000, saleStart: "2020-01-01T00:00:00Z", saleEnd: "2020-02-01T00:00:00Z" }] });
    expect(ended.body.data.variants[1]).toMatchObject({ onSale: false, effectivePrice: 3200, discountAmount: 800, discountPercent: 20 });
    const later = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: ended.body.data.rev, variants: [{ variantId: p.v500, salePrice: 3000, saleStart: "2098-01-01T00:00:00Z", saleEnd: "2099-01-01T00:00:00Z" }] });
    expect(later.body.data.variants[1]).toMatchObject({ onSale: false, effectivePrice: 3200 });
  });

  it("rejects computed fields sent by a client", async () => {
    const p = await f.pooledProduct();
    const res = await f.send("post", "/admin/warehouse-products", { warehouseId: W3, productId: p.id, stockGrams: 1000, variants: [{ variantId: p.v500, price: 3200, mrp: 4000, discountPercent: 90 }] });
    expect(res.status).toBe(400);
  });

  it("gives the catalog port the discount and the sale end", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 10000);
    const zone2 = "2".repeat(24);
    const [plain] = await f.mods.stock.resolveLines({ zoneId: zone2, lines: [{ productId: p.id, variantId: p.v500, qty: 1 }] });
    expect(plain).toMatchObject({ unitPrice: 3200, mrp: 4000, discountAmount: 800, discountPercent: 20, onSale: false, saleEndsAt: null });
    await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, salePrice: 3000, saleStart: "2026-01-01T00:00:00Z", saleEnd: "2099-01-01T00:00:00Z" }] });
    const [sale] = await f.mods.stock.resolveLines({ zoneId: zone2, lines: [{ productId: p.id, variantId: p.v500, qty: 1 }] });
    expect(sale).toMatchObject({ unitPrice: 3000, discountAmount: 1000, discountPercent: 25, onSale: true, saleEndsAt: new Date("2099-01-01T00:00:00Z") });
    const [none] = await f.mods.stock.resolveLines({ zoneId: zone2, lines: [{ productId: "9".repeat(24), variantId: "8".repeat(24), qty: 1 }] });
    expect(none).toMatchObject({ discountAmount: 0, discountPercent: 0, saleEndsAt: null });
  });
});
