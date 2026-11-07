import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, ZONE1, startFixture, type Fixture } from "./support/dev2-fixture.js";

/** Brand, food type, extra categories, badge, returnable flag and variant attributes (F04, F08). */
let f: Fixture;
beforeAll(async () => { f = await startFixture("catalog_taxonomy_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const brand = (body: Record<string, unknown>) => f.send("post", "/admin/brands", body);
const category = async (name: string) => (await f.send("post", "/admin/categories", { name })).body.data.id as string;
const SKU = (() => { let n = 0; return () => `SKU-${++n}`; })();
async function product(over: Record<string, unknown> = {}) {
  const categoryId = (over.categoryId as string | undefined) ?? (await category(`Cat ${SKU()}`));
  const res = await f.send("post", "/admin/products", {
    name: `Item ${SKU()}`, categoryId, type: "packaged", stockMode: "per_variant", status: "active",
    variants: [{ label: "1 pack", weightGrams: 500, sku: SKU() }], ...over,
  });
  return res;
}

describe("brands", () => {
  it("creates, lists, edits and switches a brand off, with unique names", async () => {
    const amul = await brand({ name: "Amul" });
    expect(amul.status, JSON.stringify(amul.body)).toBe(201);
    expect(amul.body.data).toMatchObject({ name: "Amul", slug: "amul", isActive: true, logoMediaId: null });
    expect((await brand({ name: "AMUL" })).status).toBe(409);
    await brand({ name: "Cadbury", sortOrder: 1 });
    expect((await f.get("/admin/brands")).body.data.map((b: { name: string }) => b.name)).toEqual(["Amul", "Cadbury"]);
    const off = await f.send("put", `/admin/brands/${amul.body.data.id}`, { isActive: false, name: "Amul India" });
    expect(off.body.data).toMatchObject({ name: "Amul India", isActive: false });
    expect((await f.send("put", `/admin/brands/${"f".repeat(24)}`, { name: "X" })).status).toBe(404);
    expect((await f.send("put", `/admin/brands/${amul.body.data.id}`, { colour: "red" })).status).toBe(400);
    expect((await brand({ name: "" })).status).toBe(400);
  });

  it("cannot be deleted while a product uses it, and can be once it is free", async () => {
    const b = (await brand({ name: "Tata" })).body.data.id as string;
    const p = await product({ brandId: b });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect((await f.send("delete", `/admin/brands/${b}`)).status).toBe(409);
    expect((await f.send("put", `/admin/products/${p.body.data.id}`, { brandId: null })).body.data.brand).toBeNull();
    expect((await f.send("delete", `/admin/brands/${b}`)).status).toBe(200);
    expect((await f.get("/admin/brands")).body.data).toEqual([]);
  });

  it("needs catalog permissions", async () => {
    const viewer = { "X-Test-Actor": "viewer" };
    expect((await f.get("/admin/brands", viewer)).status).toBe(200);
    expect((await f.send("post", "/admin/brands", { name: "Nope" }, viewer)).status).toBe(403);
    expect((await f.get("/admin/brands", {})).status).toBe(401);
  });
});

describe("product fields", () => {
  it("reads back the defaults for a plain product", async () => {
    const res = await product();
    expect(res.body.data).toMatchObject({ brandId: null, brand: null, foodType: "not_applicable", extraCategoryIds: [], badge: null, isReturnable: true });
    expect(res.body.data.variants[0].attributes).toEqual([]);
  });

  it("stores brand, food type, extra categories, badge, returnable flag and variant attributes", async () => {
    const b = (await brand({ name: "Amul" })).body.data.id as string;
    const dairy = await category("Dairy"), healthy = await category("Healthy");
    const res = await product({
      categoryId: dairy, brandId: b, foodType: "veg", extraCategoryIds: [healthy], badge: "bestseller", isReturnable: false,
      variants: [{ label: "Chocolate 200 ml", weightGrams: 200, sku: SKU(), attributes: [{ name: "Flavour", value: "Chocolate" }, { name: "Pack", value: "Tetra" }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ brandId: b, brand: { id: b, name: "Amul" }, foodType: "veg", extraCategoryIds: [healthy], badge: "bestseller", isReturnable: false });
    expect(res.body.data.variants[0].attributes).toEqual([{ name: "Flavour", value: "Chocolate" }, { name: "Pack", value: "Tetra" }]);
  });

  it("refuses bad values", async () => {
    const dairy = await category("Dairy");
    const off = (await brand({ name: "Old" })).body.data.id as string;
    await f.send("put", `/admin/brands/${off}`, { isActive: false });
    expect((await product({ brandId: "e".repeat(24) })).status).toBe(404);
    expect((await product({ brandId: off })).status).toBe(409);
    expect((await product({ categoryId: dairy, extraCategoryIds: [dairy] })).status).toBe(400);
    expect((await product({ extraCategoryIds: ["e".repeat(24)] })).status).toBe(404);
    const other = await category("Other");
    expect((await product({ extraCategoryIds: [other, other] })).status).toBe(400);
    expect((await product({ foodType: "halal" })).status).toBe(400);
    expect((await product({ badge: "cheap" })).status).toBe(400);
    const dup = await product({ variants: [{ label: "x", weightGrams: 1, sku: SKU(), attributes: [{ name: "Flavour", value: "A" }, { name: "flavour", value: "B" }] }] });
    expect(dup.status).toBe(400);
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `A${i}`, value: "x" }));
    expect((await product({ variants: [{ label: "x", weightGrams: 1, sku: SKU(), attributes: many }] })).status).toBe(400);
  });

  it("edits them, keeps the main category out of the extras, and edits variant attributes", async () => {
    const a = await category("A"), b = await category("B"), c = await category("C");
    const p = (await product({ categoryId: a, extraCategoryIds: [b, c] })).body.data;
    const moved = await f.send("put", `/admin/products/${p.id}`, { categoryId: b, foodType: "egg", badge: "new_launch", isReturnable: false });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data).toMatchObject({ categoryId: b, extraCategoryIds: [c], foodType: "egg", badge: "new_launch", isReturnable: false });
    const cleared = await f.send("put", `/admin/products/${p.id}`, { badge: null, extraCategoryIds: [] });
    expect(cleared.body.data).toMatchObject({ badge: null, extraCategoryIds: [] });
    const variant = await f.send("put", `/admin/products/${p.id}/variants/${p.variants[0].id}`, { attributes: [{ name: "Colour", value: "Red" }] });
    expect(variant.body.data.variants[0].attributes).toEqual([{ name: "Colour", value: "Red" }]);
    const added = await f.send("post", `/admin/products/${p.id}/variants`, { label: "Blue", weightGrams: 300, sku: SKU(), attributes: [{ name: "Colour", value: "Blue" }] });
    expect(added.body.data.variants).toHaveLength(2);
    expect((await f.send("put", `/admin/products/${p.id}`, { brandId: "e".repeat(24) })).status).toBe(404);
  });

  it("filters by brand, food type and either category, and protects a category used only as an extra", async () => {
    const b = (await brand({ name: "Amul" })).body.data.id as string;
    const dairy = await category("Dairy"), healthy = await category("Healthy");
    const milk = (await product({ name: "Milk", categoryId: dairy, brandId: b, foodType: "veg", extraCategoryIds: [healthy] })).body.data;
    await product({ name: "Chicken", categoryId: dairy, foodType: "non_veg" });
    const names = async (q: string) => (await f.get(`/admin/products?${q}`)).body.data.map((p: { name: string }) => p.name).sort();
    expect(await names(`brandId=${b}`)).toEqual(["Milk"]);
    expect(await names("foodType=non_veg")).toEqual(["Chicken"]);
    expect(await names(`categoryId=${healthy}`)).toEqual(["Milk"]);
    expect(await names(`categoryId=${dairy}`)).toEqual(["Chicken", "Milk"]);
    expect((await f.send("delete", `/admin/categories/${healthy}`)).status).toBe(409);
    await f.send("put", `/admin/products/${milk.id}`, { extraCategoryIds: [] });
    expect((await f.send("delete", `/admin/categories/${healthy}`)).status).toBe(200);
  });

  it("exports the new columns", async () => {
    const b = (await brand({ name: "Amul" })).body.data.id as string;
    await product({ name: "Milk", brandId: b, foodType: "veg", badge: "organic", isReturnable: false, variants: [{ label: "1 L", weightGrams: 1000, sku: SKU(), attributes: [{ name: "Fat", value: "Toned" }] }] });
    const csv = (await f.get("/admin/catalog/export")).text.split("\n");
    expect(csv[0]).toMatch(/brandId,foodType,badge,returnable,extraCategories,attributes$/);
    expect(csv[1]).toContain(`${b},veg,organic,false,,Fat: Toned`);
  });
});

describe("what customers see", () => {
  /** A product on sale in the zone, with the fields an admin sets. `attributes` go on its first size. */
  async function sell(name: string, over: Record<string, unknown> & { attributes?: unknown[] }) {
    const { attributes, ...fields } = over;
    const p = await f.packagedProduct(name, SKU());
    await f.packagedOffer(W1, p, [20, 20]);
    expect((await f.send("put", `/admin/products/${p.id}`, fields)).status).toBe(200);
    if (attributes) expect((await f.send("put", `/admin/products/${p.id}/variants/${p.v1}`, { attributes })).status).toBe(200);
    return p;
  }
  const guest = {};
  const shop = (q = "") => f.get(`/catalog/products?zoneId=${ZONE1}${q}`, guest);

  it("shows brand, food type, badge, categories and attributes on products, and filters on them", async () => {
    const b = (await brand({ name: "Amul" })).body.data.id as string;
    const dairy = await category("Dairy"), healthy = await category("Healthy");
    const milk = await sell("Almond Milk", {
      categoryId: dairy, brandId: b, foodType: "vegan", badge: "trending", extraCategoryIds: [healthy], isReturnable: false,
      attributes: [{ name: "Flavour", value: "Plain" }],
    });
    await sell("Chicken Salami", { categoryId: dairy, foodType: "non_veg" });

    const all = (await shop()).body.data as { id: string; brand: unknown; foodType: string; badge: string | null; isReturnable: boolean; categoryIds: string[]; variants: { attributes: unknown[] }[] }[];
    expect(all).toHaveLength(2);
    const card = all.find(p => p.id === milk.id)!;
    expect(card).toMatchObject({ brand: { id: b, name: "Amul" }, foodType: "vegan", badge: "trending", isReturnable: false, categoryIds: [dairy, healthy] });
    expect(card.variants.some(v => JSON.stringify(v.attributes) === JSON.stringify([{ name: "Flavour", value: "Plain" }]))).toBe(true);

    expect((await shop(`&brandId=${b}`)).body.data.map((p: { id: string }) => p.id)).toEqual([milk.id]);
    expect((await shop("&foodType=non_veg")).body.data).toHaveLength(1);
    expect((await shop("&foodType=veg")).body.data).toHaveLength(0);
    expect((await shop(`&categoryId=${healthy}`)).body.data.map((p: { id: string }) => p.id)).toEqual([milk.id]);
    expect((await shop(`&categoryId=${dairy}`)).body.data).toHaveLength(2);
    expect((await f.get(`/catalog/products/${milk.id}?zoneId=${ZONE1}`, guest)).body.data).toMatchObject({ brand: { name: "Amul" }, foodType: "vegan", badge: "trending" });
    expect((await f.get(`/catalog/search?zoneId=${ZONE1}&q=amul`, guest)).body.data.map((p: { id: string }) => p.id)).toEqual([milk.id]);
    const tree = (await f.get(`/catalog/categories?zoneId=${ZONE1}`, guest)).body.data.map((c: { id: string }) => c.id);
    expect(tree).toContain(healthy);
  });

  it("lists the brands that sell something in the zone, and hides a switched-off brand", async () => {
    const amul = (await brand({ name: "Amul" })).body.data.id as string;
    await brand({ name: "Unused" });
    await sell("Milk", { brandId: amul });
    await sell("Curd", { brandId: amul });
    const list = (await f.get(`/catalog/brands?zoneId=${ZONE1}`, guest)).body.data;
    expect(list).toEqual([{ id: amul, name: "Amul", slug: "amul", logoUrl: null, productCount: 2 }]);
    await f.send("put", `/admin/brands/${amul}`, { isActive: false });
    expect((await f.get(`/catalog/brands?zoneId=${ZONE1}`, guest)).body.data).toEqual([]);
    expect((await shop()).body.data.every((p: { brand: unknown }) => p.brand === null)).toBe(true);
  });
});
