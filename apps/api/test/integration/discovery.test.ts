import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDev2Modules } from "../../src/composition/dev2.js";
import { CUSTOMER_A, W1, W2, W3, ZONE1, ZONE2, admin, asPrincipal, customer, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { LOC1, LOC2, LOC_OFF } from "./support/fake-geography.js";
import { api } from "./support/harness.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("discovery_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const col = (name: string) => f.h.connection.collection(name);
/** Browsing needs no login, so every catalog read here is sent with no headers at all. */
const guest = (path: string) => f.get(path, {});
const q1 = `zoneId=${ZONE1}`;
const catalogRev = async () => ((await col("catalog_revisions").findOne({ _id: "catalogRev" as never })) as { value?: number } | null)?.value ?? 0;

async function category(name: string, parentId: string | null = null, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await f.send("post", "/admin/categories", { name, parentId, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
}
async function pooled(categoryId: string, name: string, extra: Record<string, unknown> = {}) {
  const sku = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "X";
  const res = await f.send("post", "/admin/products", {
    name, categoryId, type: "loose", stockMode: "pooled_weight", status: "active", tags: [],
    variants: [{ label: "250 g", weightGrams: 250, sku: `${sku}-250` }, { label: "500 g", weightGrams: 500, sku: `${sku}-500` }], ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [a, b] = res.body.data.variants;
  return { id: res.body.data.id as string, v250: a.id as string, v500: b.id as string };
}
async function packaged(categoryId: string, name: string) {
  const sku = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "X";
  const res = await f.send("post", "/admin/products", {
    name, categoryId, type: "packaged", stockMode: "per_variant", status: "active",
    variants: [{ label: "500 g", weightGrams: 500, sku: `${sku}-500` }, { label: "1 kg", weightGrams: 1000, sku: `${sku}-1000` }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [a, b] = res.body.data.variants;
  return { id: res.body.data.id as string, v1: a.id as string, v2: b.id as string };
}
/** Edits an offering with the right revision. */
async function editOffering(offeringId: string, body: Record<string, unknown>) {
  const current = (await f.get(`/admin/warehouse-products/${offeringId}`)).body.data;
  const res = await f.send("put", `/admin/warehouse-products/${offeringId}`, { rev: current.rev, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}
const listAll = async (query = "") => (await guest(`/catalog/products?${q1}&limit=100${query}`)).body.data as { id: string; name: string; available: boolean; availability: string }[];
const keysOf = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : []);

describe("every call needs a zone", () => {
  const paths = ["/catalog/home", "/catalog/categories", "/catalog/products", `/catalog/products/${"a".repeat(24)}`, "/catalog/search?q=to", "/catalog/changes?since=0", "/store/status", "/banners"];

  it("refuses a call with no zone or a malformed one: no zone, no prices", async () => {
    for (const path of paths) {
      const glue = path.includes("?") ? "&" : "?";
      expect((await guest(path)).status, path).toBe(400);
      expect((await guest(`${path}${glue}zoneId=zone_1`)).status, path).toBe(400);
    }
  });

  it("answers 404 for a zone that does not exist or is switched off", async () => {
    f.geo.disableZone(ZONE2);
    for (const path of paths) {
      const glue = path.includes("?") ? "&" : "?";
      for (const zone of ["9".repeat(24), ZONE2]) {
        const res = await guest(`${path}${glue}zoneId=${zone}`);
        expect(res.status, `${path} ${zone}`).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("needs no login", async () => {
    expect((await guest(`/catalog/home?${q1}`)).status).toBe(200);
    expect((await guest(`/store/status?${q1}`)).status).toBe(200);
    expect((await guest(`/banners?${q1}`)).status).toBe(200);
  });
});

describe("the home screen", () => {
  it("brings the zone, store state, notices, banners, category shortcuts, product sections and the sync starting point", async () => {
    const image = await f.send("post", "/media/upload-url", { kind: "category_image", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal("admin"));
    f.storage.upload(image.body.data.upload.fields.key);
    await f.send("post", "/media/complete", { mediaId: image.body.data.mediaId }, asPrincipal("admin"));
    const veg = await category("Vegetables", null, { imageMediaId: image.body.data.mediaId, sortOrder: 1 });
    const dairy = await category("Dairy", null, { sortOrder: 2 });
    await category("Empty shelf", null, { sortOrder: 3 });
    const tomato = await pooled(veg, "Fresh Tomato (Local)");
    const milk = await packaged(dairy, "Milk");
    await f.pooledOffer(W1, tomato, 24000);
    await f.packagedOffer(W1, milk, [30, 12]);
    f.banners.push({ id: "ban_1", title: "Free delivery above ₹399", imageMediaId: image.body.data.mediaId, link: { type: "category", id: veg } }, { id: "ban_2", title: "No picture", imageMediaId: null, link: null });

    const res = await guest(`/catalog/home?${q1}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const home = res.body.data;
    expect(home.zone).toEqual({ id: ZONE1, name: "Mall Road & Chowrasta" });
    expect(home.status).toEqual({ accepting: true, etaMinMinutes: 15, etaMaxMinutes: 20 });
    expect(home.notices).toEqual([{ type: "rain", label: "Rain mode: +₹15 delivery fee, +10 min" }]);
    expect(home.banners).toEqual([
      { id: "ban_1", title: "Free delivery above ₹399", image: { mediaId: image.body.data.mediaId, urls: expect.objectContaining({ "640": expect.stringContaining("/640.webp") }) }, link: { type: "category", id: veg } },
      { id: "ban_2", title: "No picture", image: null, link: null },
    ]);
    expect(home.categories).toEqual([
      { id: veg, name: "Vegetables", imageUrl: `https://cdn.fake.test/${image.body.data.upload.fields.key}/320.webp` },
      { id: dairy, name: "Dairy", imageUrl: null },
    ]);
    expect(home.sections.map((s: { title: string; categoryId: string; products: unknown[] }) => [s.title, s.categoryId, s.products.length])).toEqual([["Vegetables", veg, 1], ["Dairy", dairy, 1]]);
    expect(home.sections[0].products[0]).toMatchObject({ id: tomato.id, name: "Fresh Tomato (Local)", available: true, availability: "in_stock" });
    expect(home.rev).toBe(await catalogRev());
  });

  it("limits the sections to six categories of ten products, and skips a category with nothing to sell", async () => {
    const roots: string[] = [];
    for (let i = 1; i <= 7; i++) roots.push(await category(`Aisle ${i}`, null, { sortOrder: i }));
    for (let i = 0; i < 12; i++) await f.pooledOffer(W1, await pooled(roots[0]!, `Item ${String(i).padStart(2, "0")}`), 1000);
    for (const root of roots.slice(1, 6)) await f.pooledOffer(W1, await pooled(root, `In ${root.slice(-4)}`), 1000);
    await pooled(roots[6]!, "Never offered");
    const home = (await guest(`/catalog/home?${q1}`)).body.data;
    expect(home.categories).toHaveLength(6);
    expect(home.sections).toHaveLength(6);
    expect(home.sections[0].products).toHaveLength(10);
    expect(home.sections.slice(1).every((s: { products: unknown[] }) => s.products.length === 1)).toBe(true);
  });

  it("says the store is not accepting orders when the zone is paused or every warehouse is closed", async () => {
    const veg = await category("Vegetables");
    await f.pooledOffer(W1, await pooled(veg, "Tomato"), 5000);
    expect((await guest(`/catalog/home?${q1}`)).body.data.status.accepting).toBe(true);
    f.geo.closeWarehouse(W1); f.geo.closeWarehouse(W2);
    const closed = (await guest(`/catalog/home?${q1}`)).body.data;
    expect(closed.status.accepting).toBe(false);
    expect(closed.sections[0].products[0].availability).toBe("closed");
    f.geo.openWarehouse(W1);
    expect((await guest(`/catalog/home?${q1}`)).body.data.status.accepting).toBe(true);
    f.geo.pauseZone(ZONE1);
    const paused = (await guest(`/catalog/home?${q1}`)).body.data;
    expect(paused.status.accepting).toBe(false);
    expect(paused.sections).toHaveLength(1);
  });

  it("is empty, not broken, for a zone that sells nothing yet", async () => {
    const home = (await guest(`/catalog/home?zoneId=${ZONE2}`)).body.data;
    expect(home).toMatchObject({ categories: [], sections: [], banners: [], zone: { id: ZONE2 } });
  });
});

describe("categories", () => {
  it("lists only categories that have something to sell in the zone, nested, in shelf order", async () => {
    const veg = await category("Vegetables", null, { sortOrder: 2 });
    const leafy = await category("Leafy Greens", veg, { sortOrder: 1 });
    const roots = await category("Root Vegetables", veg, { sortOrder: 2 });
    const dairy = await category("Dairy", null, { sortOrder: 1 });
    await category("Bakery", null, { sortOrder: 3 });
    const farAway = await category("Only in zone two", null, { sortOrder: 4 });
    await f.pooledOffer(W1, await pooled(leafy, "Spinach"), 3000);
    await f.packagedOffer(W1, await packaged(dairy, "Milk"), [5, 5]);
    await f.pooledOffer(W3, await pooled(farAway, "Tea"), 3000);
    await pooled(roots, "Unsold carrot");

    const res = await guest(`/catalog/categories?${q1}`);
    expect(res.status).toBe(200);
    const shape = (nodes: { name: string; children: unknown[] }[]): unknown[] => nodes.map(n => [n.name, shape(n.children as never)]);
    expect(shape(res.body.data)).toEqual([["Dairy", []], ["Vegetables", [["Leafy Greens", []]]]]);
    expect(res.body.data[0]).toEqual({ id: dairy, name: "Dairy", imageUrl: null, children: [] });
    expect(shape((await guest(`/catalog/categories?zoneId=${ZONE2}`)).body.data)).toEqual([["Only in zone two", []]]);
  });

  it("hides a category when its last product goes, and when the category or a parent is switched off", async () => {
    const veg = await category("Vegetables");
    const leafy = await category("Leafy", veg);
    const spinach = await pooled(leafy, "Spinach");
    await f.pooledOffer(W1, spinach, 3000);
    const names = async () => (await guest(`/catalog/categories?${q1}`)).body.data.map((c: { name: string }) => c.name);
    expect(await names()).toEqual(["Vegetables"]);
    expect((await f.send("put", `/admin/categories/${veg}`, { isActive: false })).status).toBe(200);
    expect(await names()).toEqual([]);
    await f.send("put", `/admin/categories/${veg}`, { isActive: true });
    expect(await names()).toEqual(["Vegetables"]);
    await f.send("post", `/admin/products/${spinach.id}/archive`);
    expect(await names()).toEqual([]);
  });
});

describe("what a customer sees for a product", () => {
  async function tomato(grams = 24000) {
    const veg = await category("Vegetables");
    const p = await pooled(veg, "Fresh Tomato (Local)", { tags: ["fresh", "local"] });
    const offer = await f.pooledOffer(W1, p, grams, { v250: 1800, v500: 3200 });
    return { veg, p, offer };
  }
  const one = async () => (await guest(`/catalog/products/${(await listAll())[0]!.id}?${q1}`)).body.data;

  it("shows one entry per product with sizes, prices, discounts and availability, and never stock or warehouses", async () => {
    const { p } = await tomato();
    const res = await guest(`/catalog/products?${q1}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ nextCursor: null });
    expect(res.body.data).toEqual([{
      id: p.id, name: "Fresh Tomato (Local)", slug: "fresh-tomato-local", categoryId: expect.any(String), type: "loose", tags: ["fresh", "local"], images: [],
      variants: [
        { variantId: p.v250, label: "250 g", weightGrams: 250, price: 1800, mrp: 2000, discountAmount: 200, discountPercent: 10, onSale: false, saleEndsAt: null, available: true, maxQty: null },
        { variantId: p.v500, label: "500 g", weightGrams: 500, price: 3200, mrp: 4000, discountAmount: 800, discountPercent: 20, onSale: false, saleEndsAt: null, available: true, maxQty: null },
      ],
      available: true, availability: "in_stock", rev: expect.any(Number),
    }]);
    const banned = ["stock", "stockGrams", "warehouseId", "warehouse", "offeringId", "zoneId", "isOutOfStockOverride"];
    expect(keysOf(res.body.data).filter(k => banned.includes(k))).toEqual([]);
  });

  it("shows one entry, not one per warehouse, when several warehouses of the zone sell it", async () => {
    const { p } = await tomato();
    await f.pooledOffer(W2, p, 5000, { v250: 1800, v500: 3200 });
    expect(await listAll()).toHaveLength(1);
  });

  it("applies a running sale price and says when it ends; a sale that has not started or has ended is not shown", async () => {
    const { offer, p } = await tomato();
    const hour = 3_600_000;
    const sale = (start: number, end: number) => editOffering(offer.id, { variants: [{ variantId: p.v500, salePrice: 3000, saleStart: new Date(Date.now() + start).toISOString(), saleEnd: new Date(Date.now() + end).toISOString() }] });
    const variant = async () => (await one()).variants[1];

    const end = Date.now() + 2 * hour;
    await editOffering(offer.id, { variants: [{ variantId: p.v500, salePrice: 3000, saleStart: new Date(Date.now() - hour).toISOString(), saleEnd: new Date(end).toISOString() }] });
    expect(await variant()).toMatchObject({ price: 3000, mrp: 4000, discountAmount: 1000, discountPercent: 25, onSale: true, saleEndsAt: new Date(end).toISOString() });
    await sale(hour, 2 * hour);
    expect(await variant()).toMatchObject({ price: 3200, discountPercent: 20, onSale: false, saleEndsAt: null });
    await sale(-3 * hour, -hour);
    expect(await variant()).toMatchObject({ price: 3200, onSale: false, saleEndsAt: null });
  });

  it("is available when any open warehouse has stock, and says out of stock or closed otherwise", async () => {
    const { p } = await tomato(0);
    await f.pooledOffer(W2, p, 5000, { v250: 1800, v500: 3200 });
    expect((await one()).availability).toBe("in_stock");
    f.geo.closeWarehouse(W2);
    expect(await one()).toMatchObject({ available: false, availability: "out_of_stock" });
    f.geo.closeWarehouse(W1);
    expect(await one()).toMatchObject({ available: false, availability: "closed" });
    f.geo.openWarehouse(W2);
    expect((await one()).availability).toBe("in_stock");
  });

  it("works out availability per size from the gram pool or the unit count", async () => {
    const veg = await category("Vegetables");
    const p = await pooled(veg, "Potato");
    await f.pooledOffer(W1, p, 300);
    const sizes = (await listAll().then(l => guest(`/catalog/products/${l[0]!.id}?${q1}`))).body.data.variants.map((v: { available: boolean }) => v.available);
    expect(sizes).toEqual([true, false]);
    const salt = await packaged(veg, "Salt");
    await f.packagedOffer(W1, salt, [0, 4]);
    const saltEntry = (await guest(`/catalog/products/${salt.id}?${q1}`)).body.data;
    expect(saltEntry.variants.map((v: { available: boolean }) => v.available)).toEqual([false, true]);
    expect(saltEntry).toMatchObject({ available: true, availability: "in_stock" });
  });

  it("treats a switched-off size, an out-of-stock override and a size removed from the master product as not sellable", async () => {
    const { offer, p } = await tomato();
    await editOffering(offer.id, { variants: [{ variantId: p.v250, isActive: false }] });
    expect((await one()).variants.map((v: { label: string }) => v.label)).toEqual(["500 g"]);
    await editOffering(offer.id, { isOutOfStockOverride: true });
    expect(await one()).toMatchObject({ available: false, availability: "out_of_stock" });
    await editOffering(offer.id, { isOutOfStockOverride: false });
    expect((await f.send("delete", `/admin/products/${p.id}/variants/${p.v500}`)).status).toBe(200);
    expect((await listAll())).toEqual([]);
  });

  it("sends the tighter of the offering's limit and nothing when there is none", async () => {
    const { offer, p } = await tomato();
    expect((await one()).variants.map((v: { maxQty: number | null }) => v.maxQty)).toEqual([null, null]);
    await editOffering(offer.id, { variants: [{ variantId: p.v500, maxQtyPerOrder: 4 }, { variantId: p.v250, maxQtyPerOrder: 10 }] });
    await f.pooledOffer(W2, p, 5000, { v250: 1800, v500: 3200 });
    expect((await one()).variants.map((v: { maxQty: number | null }) => v.maxQty)).toEqual([10, 4]);
  });

  it("leaves out whatever the zone does not sell", async () => {
    const veg = await category("Vegetables");
    const sold = await pooled(veg, "Sold");
    const inactive = await pooled(veg, "Inactive product", { status: "inactive" });
    const archived = await pooled(veg, "Archived");
    const off = await pooled(veg, "Offering off");
    const disabledShop = await pooled(veg, "Disabled shop");
    const elsewhere = await pooled(veg, "Other zone");
    await f.pooledOffer(W1, sold, 1000);
    await f.pooledOffer(W1, inactive, 1000);
    const archivedOffer = await f.pooledOffer(W1, archived, 1000);
    const offOffer = await f.pooledOffer(W1, off, 1000);
    await f.pooledOffer(W3, elsewhere, 1000);
    await f.pooledOffer(W2, disabledShop, 1000);
    await f.send("post", `/admin/products/${archived.id}/archive`);
    await editOffering(offOffer.id, { status: "inactive" });
    f.geo.disableWarehouse(W2);
    expect((await listAll()).map(p => p.name)).toEqual(["Sold"]);
    expect(archivedOffer.id).toBeTruthy();
    expect((await guest(`/catalog/products?zoneId=${ZONE2}`)).body.data.map((p: { name: string }) => p.name)).toEqual(["Other zone"]);
  });

  it("returns pictures for each size, in order", async () => {
    const { p } = await tomato();
    const upload = async () => {
      const r = await f.send("post", "/media/upload-url", { kind: "product_image", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal("admin"));
      f.storage.upload(r.body.data.upload.fields.key);
      await f.send("post", "/media/complete", { mediaId: r.body.data.mediaId }, asPrincipal("admin"));
      return { id: r.body.data.mediaId as string, key: r.body.data.upload.fields.key as string };
    };
    const a = await upload();
    const b = await upload();
    for (const [img, alt] of [[a, "Front"], [b, "Cut open"]] as const) {
      expect((await f.send("post", `/admin/products/${p.id}/images`, { mediaId: img.id, alt }, { ...admin, ...asPrincipal("admin") })).status).toBe(201);
    }
    await f.send("put", `/admin/products/${p.id}/images/order`, { orderedMediaIds: [b.id, a.id] });
    const images = (await one()).images;
    expect(images.map((i: { alt: string }) => i.alt)).toEqual(["Cut open", "Front"]);
    expect(images[0]).toEqual({ mediaId: b.id, alt: "Cut open", urls: { "160": `https://cdn.fake.test/${b.key}/160.webp`, "320": `https://cdn.fake.test/${b.key}/320.webp`, "640": `https://cdn.fake.test/${b.key}/640.webp`, "1080": `https://cdn.fake.test/${b.key}/1080.webp` } });
  });
});

describe("listing products", () => {
  it("lists a category and everything under it, in shelf order, and 404s for a category that does not exist", async () => {
    const veg = await category("Vegetables");
    const leafy = await category("Leafy", veg);
    const dairy = await category("Dairy");
    const tomato = await pooled(veg, "Tomato", { sortOrder: 2 });
    const spinach = await pooled(leafy, "Spinach", { sortOrder: 1 });
    const apple = await pooled(veg, "Apple", { sortOrder: 2 });
    const milk = await packaged(dairy, "Milk");
    for (const p of [tomato, spinach, apple]) await f.pooledOffer(W1, p, 1000);
    await f.packagedOffer(W1, milk, [3, 3]);
    const names = async (query: string) => (await guest(`/catalog/products?${q1}${query}`)).body.data.map((p: { name: string }) => p.name);
    // Products with the same shelf position go by name; Milk has none set, so it comes first.
    expect(await names("")).toEqual(["Milk", "Spinach", "Apple", "Tomato"]);
    expect(await names(`&categoryId=${veg}`)).toEqual(["Spinach", "Apple", "Tomato"]);
    expect(await names(`&categoryId=${leafy}`)).toEqual(["Spinach"]);
    expect(await names(`&categoryId=${dairy}`)).toEqual(["Milk"]);
    expect((await guest(`/catalog/products?${q1}&categoryId=${"9".repeat(24)}`)).status).toBe(404);
    await f.send("put", `/admin/categories/${dairy}`, { isActive: false });
    expect((await guest(`/catalog/products?${q1}&categoryId=${dairy}`)).status).toBe(404);
  });

  it("pages with a cursor, 40 by default, and refuses a bad cursor or limit", async () => {
    const veg = await category("Vegetables");
    for (let i = 0; i < 5; i++) await f.pooledOffer(W1, await pooled(veg, `Item ${i}`, { sortOrder: i }), 1000);
    const first = await guest(`/catalog/products?${q1}&limit=2`);
    expect(first.body.data.map((p: { name: string }) => p.name)).toEqual(["Item 0", "Item 1"]);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    const second = await guest(`/catalog/products?${q1}&limit=2&cursor=${first.body.meta.nextCursor}`);
    expect(second.body.data.map((p: { name: string }) => p.name)).toEqual(["Item 2", "Item 3"]);
    const last = await guest(`/catalog/products?${q1}&limit=2&cursor=${second.body.meta.nextCursor}`);
    expect(last.body.data.map((p: { name: string }) => p.name)).toEqual(["Item 4"]);
    expect(last.body.meta.nextCursor).toBeNull();
    expect((await guest(`/catalog/products?${q1}&limit=5`)).body.meta.nextCursor).toBeNull();
    expect((await guest(`/catalog/products?${q1}&cursor=bm9wZQ`)).status).toBe(400);
    expect((await guest(`/catalog/products?${q1}&limit=0`)).status).toBe(400);
    expect((await guest(`/catalog/products?${q1}&limit=101`)).status).toBe(400);
    expect((await guest(`/catalog/products?${q1}&inStockOnly=maybe`)).status).toBe(400);
  });

  it("can show only what is in stock, and the store can choose never to list sold-out items", async () => {
    const veg = await category("Vegetables");
    await f.pooledOffer(W1, await pooled(veg, "Plenty"), 5000);
    await f.pooledOffer(W1, await pooled(veg, "Sold out"), 0);
    expect((await listAll()).map(p => [p.name, p.availability])).toEqual([["Plenty", "in_stock"], ["Sold out", "out_of_stock"]]);
    expect((await listAll("&inStockOnly=true")).map(p => p.name)).toEqual(["Plenty"]);
    expect((await listAll("&inStockOnly=false")).map(p => p.name)).toEqual(["Plenty", "Sold out"]);

    const strict = createDev2Modules({ connection: f.h.connection, geography: f.geo.geography, discoverySettings: { showOutOfStockItems: false, maxQtyPerItem: 3 }, storage: f.storage.provider });
    const app = f.h.appWith(strict.routes);
    const res = await request(app).get(`${api}/catalog/products?${q1}`);
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(["Plenty"]);
    expect(res.body.data[0].variants.map((v: { maxQty: number }) => v.maxQty)).toEqual([3, 3]);
    expect((await request(app).get(`${api}/catalog/search?${q1}&q=sold`)).body.data).toEqual([]);
  });
});

describe("one product", () => {
  it("adds the description and the product information, always present and empty when nothing is set", async () => {
    const veg = await category("Vegetables");
    const bare = await pooled(veg, "Bare");
    await f.pooledOffer(W1, bare, 1000);
    expect((await guest(`/catalog/products/${bare.id}?${q1}`)).body.data).toMatchObject({ description: "", highlights: [], keyInfo: [], nutrition: null, infoSections: [] });

    const full = await pooled(veg, "Fresh Tomato", {
      description: "Grown on Darjeeling hill farms.", highlights: ["Grown on Darjeeling hill farms"],
      keyInfo: [{ label: "Shelf life", value: "5 days" }, { label: "Storage", value: "Keep in a cool, dry place" }],
      nutrition: { basis: "per_100g", servingSize: null, rows: [{ name: "Energy", amount: 18, unit: "kcal", dailyValuePercent: null }] },
      infoSections: [{ title: "How to store", body: "Refrigerate after cutting." }],
    });
    await f.pooledOffer(W1, full, 1000);
    const res = await guest(`/catalog/products/${full.id}?${q1}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: full.id, name: "Fresh Tomato", description: "Grown on Darjeeling hill farms.", highlights: ["Grown on Darjeeling hill farms"],
      keyInfo: [{ label: "Shelf life", value: "5 days" }, { label: "Storage", value: "Keep in a cool, dry place" }],
      nutrition: { basis: "per_100g", servingSize: null, rows: [{ name: "Energy", amount: 18, unit: "kcal", dailyValuePercent: null }] },
      infoSections: [{ title: "How to store", body: "Refrigerate after cutting." }],
      variants: expect.any(Array), availability: "in_stock",
    });
  });

  it("leaves the extra information out of lists and search", async () => {
    const veg = await category("Vegetables");
    const p = await pooled(veg, "Tomato", { description: "Long text", highlights: ["x"] });
    await f.pooledOffer(W1, p, 1000);
    for (const list of [(await guest(`/catalog/products?${q1}`)).body.data, (await guest(`/catalog/search?${q1}&q=tomato`)).body.data, (await guest(`/catalog/home?${q1}`)).body.data.sections[0].products]) {
      expect(Object.keys(list[0])).not.toEqual(expect.arrayContaining(["description"]));
      expect(keysOf(list)).not.toContain("highlights");
    }
  });

  it("answers 404 when the zone does not sell it, whether unknown, other zone, archived or switched off", async () => {
    const veg = await category("Vegetables");
    const p = await pooled(veg, "Tomato");
    const offer = await f.pooledOffer(W3, p, 1000);
    expect((await guest(`/catalog/products/${p.id}?${q1}`)).status).toBe(404);
    expect((await guest(`/catalog/products/${p.id}?zoneId=${ZONE2}`)).status).toBe(200);
    expect((await guest(`/catalog/products/${"9".repeat(24)}?${q1}`)).status).toBe(404);
    expect((await guest(`/catalog/products/not-an-id?${q1}`)).status).toBe(404);
    await editOffering(offer.id, { status: "inactive" });
    expect((await guest(`/catalog/products/${p.id}?zoneId=${ZONE2}`)).status).toBe(404);
    await editOffering(offer.id, { status: "active" });
    await f.send("post", `/admin/products/${p.id}/archive`);
    expect((await guest(`/catalog/products/${p.id}?zoneId=${ZONE2}`)).status).toBe(404);
  });
});

describe("search", () => {
  async function shelf() {
    const veg = await category("Vegetables");
    const tomato = await pooled(veg, "Fresh Tomato (Local)", { tags: ["fresh", "salad"] });
    const cherry = await pooled(veg, "Cherry Tomato Pack");
    const paste = await pooled(veg, "Organic Tomato Paste");
    const cucumber = await pooled(veg, "Cucumber", { tags: ["tomato-friendly"] });
    const potato = await pooled(veg, "Potato");
    for (const p of [tomato, cherry, paste, cucumber, potato]) await f.pooledOffer(W1, p, 1000);
    return { tomato, cherry, paste, cucumber, potato };
  }
  const search = async (q: string, extra = "") => guest(`/catalog/search?${q1}&q=${encodeURIComponent(q)}${extra}`);

  it("finds products by name, tag or SKU, names starting with the text first", async () => {
    const { potato } = await shelf();
    const res = await search("tomato");
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(["Cherry Tomato Pack", "Fresh Tomato (Local)", "Organic Tomato Paste", "Cucumber"]);
    expect(res.body.meta).toEqual({ count: 4 });
    expect((await search("ChErRy")).body.data.map((p: { name: string }) => p.name)).toEqual(["Cherry Tomato Pack"]);
    expect((await search("salad")).body.data.map((p: { name: string }) => p.name)).toEqual(["Fresh Tomato (Local)"]);
    expect((await search("POTATO-5")).body.data.map((p: { id: string }) => p.id)).toEqual([potato.id]);
    expect((await search("fresh tom")).body.data.map((p: { name: string }) => p.name)).toEqual(["Fresh Tomato (Local)"]);
  });

  it("returns full product entries, limits the count, and returns an empty list for no match", async () => {
    await shelf();
    const res = await search("tomato", "&limit=2");
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ variants: expect.any(Array), availability: "in_stock", rev: expect.any(Number) });
    expect((await search("zzzz")).body).toEqual({ data: [], meta: { count: 0 } });
    expect((await search("!!")).body.data).toEqual([]);
  });

  it("only searches what the zone sells, and needs at least two characters", async () => {
    const { tomato } = await shelf();
    const far = await pooled(await category("Tea"), "Tomato tea");
    await f.pooledOffer(W3, far, 1000);
    expect((await search("tomato")).body.data.map((p: { name: string }) => p.name)).not.toContain("Tomato tea");
    expect((await guest(`/catalog/search?zoneId=${ZONE2}&q=tomato`)).body.data.map((p: { name: string }) => p.name)).toEqual(["Tomato tea"]);
    await f.send("post", `/admin/products/${tomato.id}/archive`);
    expect((await search("fresh")).body.data).toEqual([]);
    expect((await search("t")).status).toBe(400);
    expect((await guest(`/catalog/search?${q1}`)).status).toBe(400);
    expect((await search("ab", "&limit=51")).status).toBe(400);
  });
});

describe("changes since the last visit", () => {
  async function stocked() {
    const veg = await category("Vegetables");
    const tomato = await pooled(veg, "Tomato");
    const offer = await f.pooledOffer(W1, tomato, 24000, { v250: 1800, v500: 3200 });
    const since = await catalogRev();
    return { veg, tomato, offer, since };
  }
  const changes = async (since: number, zone = ZONE1) => (await guest(`/catalog/changes?zoneId=${zone}&since=${since}`)).body;

  it("sends nothing when nothing changed, and moves the starting point forward", async () => {
    const { since } = await stocked();
    const res = await guest(`/catalog/changes?${q1}&since=${since}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], meta: { cursor: since, fullResync: false } });
    expect((await changes(0)).meta.fullResync).toBe(false);
  });

  it("sends the whole current entry for a product whose price changed, then nothing the next time", async () => {
    const { tomato, offer, since } = await stocked();
    const updated = await editOffering(offer.id, { variants: [{ variantId: tomato.v500, price: 3300 }] });
    const res = await changes(since);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: tomato.id, name: "Tomato", rev: updated.rev, available: true, variants: [{ price: 1800 }, { price: 3300, discountAmount: 700 }] });
    expect(res.meta).toEqual({ cursor: updated.rev, fullResync: false });
    expect(await changes(res.meta.cursor)).toEqual({ data: [], meta: { cursor: updated.rev, fullResync: false } });
  });

  it("reports availability changes: sold out, and back again", async () => {
    const { tomato, since } = await stocked();
    await f.send("post", "/admin/stock/adjust", { warehouseId: W1, productId: tomato.id, variantId: null, delta: -24000, reason: "wastage" });
    const out = await changes(since);
    expect(out.data[0]).toMatchObject({ id: tomato.id, available: false, availability: "out_of_stock" });
    await f.send("post", "/admin/stock/adjust", { warehouseId: W1, productId: tomato.id, variantId: null, delta: 1000, reason: "purchase" });
    const back = await changes(out.meta.cursor);
    expect(back.data[0]).toMatchObject({ id: tomato.id, available: true, availability: "in_stock" });
  });

  it("reports a master-catalog edit such as a rename", async () => {
    const { tomato, since } = await stocked();
    expect((await f.send("put", `/admin/products/${tomato.id}`, { name: "Hill Tomato" })).status).toBe(200);
    expect((await changes(since)).data[0]).toMatchObject({ id: tomato.id, name: "Hill Tomato" });
  });

  it("sends a removal notice for a product that is archived, switched off or no longer sold", async () => {
    const { veg, tomato, offer, since } = await stocked();
    const other = await pooled(veg, "Carrot");
    const otherOffer = await f.pooledOffer(W1, other, 1000);
    const mid = await catalogRev();
    await f.send("post", `/admin/products/${tomato.id}/archive`);
    const archived = await changes(since);
    expect(archived.data).toContainEqual({ id: tomato.id, deleted: true, rev: expect.any(Number) });
    expect(archived.data).toContainEqual(expect.objectContaining({ id: other.id, name: "Carrot" }));

    await editOffering(otherOffer.id, { status: "inactive" });
    const off = await changes(mid);
    expect(off.data.find((e: { id: string }) => e.id === other.id)).toEqual({ id: other.id, deleted: true, rev: expect.any(Number) });
    await f.send("post", `/admin/products/${tomato.id}/restore`);
    await f.send("put", `/admin/products/${tomato.id}`, { status: "active" });
    const again = await changes(off.meta.cursor);
    expect(again.data.find((e: { id: string }) => e.id === tomato.id)).toMatchObject({ name: "Tomato", availability: "in_stock" });
    expect(offer.id).toBeTruthy();
  });

  it("sends a brand-new product in full", async () => {
    const { veg, since } = await stocked();
    const fresh = await pooled(veg, "Brand New", { tags: ["new"] });
    await f.pooledOffer(W1, fresh, 1000);
    const res = await changes(since);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: fresh.id, name: "Brand New", tags: ["new"], slug: "brand-new", type: "loose", variants: expect.any(Array) });
  });

  it("lists changes oldest first and sends a product once when several warehouses changed it together", async () => {
    const { veg, tomato, since } = await stocked();
    await f.pooledOffer(W2, tomato, 1000, { v250: 1800, v500: 3200 });
    const carrot = await pooled(veg, "Carrot");
    await f.pooledOffer(W1, carrot, 1000);
    const tomatoOffer = (await col("warehouse_products").findOne({ warehouseId: W1, productId: tomato.id }))!;
    const current = (await f.get(`/admin/warehouse-products/${tomatoOffer._id}`)).body.data;
    expect((await f.send("put", `/admin/warehouse-products/${current.id}`, { rev: current.rev, applyToWarehouseIds: [W2], variants: [{ variantId: tomato.v500, price: 3000 }] })).status).toBe(200);
    const res = await changes(since);
    expect(res.data.map((e: { name: string }) => e.name)).toEqual(["Carrot", "Tomato"]);
    expect(res.data.map((e: { rev: number }) => e.rev)).toEqual([...res.data.map((e: { rev: number }) => e.rev)].sort((a: number, b: number) => a - b));
    expect(res.data[1].variants[1].price).toBe(3000);
  });

  it("only reports the zone asked for", async () => {
    const { since } = await stocked();
    const tea = await pooled(await category("Tea"), "Tea");
    await f.pooledOffer(W3, tea, 1000);
    expect((await changes(since)).data).toEqual([]);
    expect((await changes(since, ZONE2)).data.map((e: { name: string }) => e.name)).toEqual(["Tea"]);
  });

  it("asks the app to reload everything when its cursor is ahead of the server, or far too much changed", async () => {
    const { veg, since } = await stocked();
    const ahead = await changes(since + 1000);
    expect(ahead).toEqual({ data: [], meta: { cursor: since, fullResync: true } });
    for (let i = 0; i < 7; i++) await f.pooledOffer(W1, await pooled(veg, `Bulk ${i}`), 1000);
    const flood = await changes(since);
    expect(flood.meta.fullResync).toBe(true);
    expect(flood.data).toEqual([]);
    expect(flood.meta.cursor).toBe(await catalogRev());
    // After reloading from home, the app starts again from home's revision with nothing to catch up.
    const home = (await guest(`/catalog/home?${q1}`)).body.data;
    expect(await changes(home.rev)).toEqual({ data: [], meta: { cursor: home.rev, fullResync: false } });
  });

  it("checks the inputs", async () => {
    expect((await guest(`/catalog/changes?${q1}`)).status).toBe(400);
    expect((await guest(`/catalog/changes?${q1}&since=abc`)).status).toBe(400);
    expect((await guest(`/catalog/changes?${q1}&since=-1`)).status).toBe(400);
    expect((await guest(`/catalog/changes?${q1}&since=1.5`)).status).toBe(400);
  });
});

describe("store status", () => {
  it("reports hours, pause, fees, the ETA and notices for the zone", async () => {
    const res = await guest(`/store/status?${q1}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      zoneId: ZONE1, accepting: true, open: true, paused: false, pauseMessage: null, opensAt: null, closesAt: "2026-11-05T14:30:00.000Z",
      afterHoursMode: "pre_order", preOrderAvailable: true, eta: { minMinutes: 15, maxMinutes: 20 }, minOrder: 10000, freeDeliveryAbove: 60000, smallOrderFee: 0,
      notices: [{ type: "rain", label: "Rain mode: +₹15 delivery fee, +10 min", amount: 1500, extraMinutes: 10 }],
    });
  });

  it("shows the pause message when paused and not accepting when closed, while browsing still works", async () => {
    f.geo.pauseZone(ZONE1);
    expect((await guest(`/store/status?${q1}`)).body.data).toMatchObject({ accepting: false, open: true, paused: true, pauseMessage: "Back at 9 AM" });
    expect((await guest(`/catalog/home?${q1}`)).status).toBe(200);
    f.geo.closeWarehouse(W1); f.geo.closeWarehouse(W2);
    expect((await guest(`/store/status?${q1}`)).body.data).toMatchObject({ accepting: false, open: false });
    f.geo.openWarehouse(W2);
    f.geo.disableWarehouse(W2);
    expect((await guest(`/store/status?${q1}`)).body.data.open).toBe(false);
  });
});

describe("banners", () => {
  it("is empty without banners, and resolves each image to its sizes", async () => {
    expect((await guest(`/banners?${q1}`)).body).toEqual({ data: [] });
    const r = await f.send("post", "/media/upload-url", { kind: "banner", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal("admin"));
    f.storage.upload(r.body.data.upload.fields.key);
    await f.send("post", "/media/complete", { mediaId: r.body.data.mediaId }, asPrincipal("admin"));
    f.banners.push(
      { id: "ban_1", title: "Free delivery above ₹399", imageMediaId: r.body.data.mediaId, link: { type: "category", id: "cat_1" } },
      { id: "ban_2", title: "Visit us", imageMediaId: null, link: { type: "url", url: "https://example.com" } },
    );
    const res = await guest(`/banners?${q1}`);
    expect(res.body.data).toEqual([
      { id: "ban_1", title: "Free delivery above ₹399", image: { mediaId: r.body.data.mediaId, urls: expect.objectContaining({ "640": expect.stringContaining("/640.webp"), "1080": expect.any(String) }) }, link: { type: "category", id: "cat_1" } },
      { id: "ban_2", title: "Visit us", image: null, link: { type: "url", url: "https://example.com" } },
    ]);
  });
});

describe("the waitlist", () => {
  const join = (body: Record<string, unknown>, who: Record<string, string> = {}) => f.send("post", "/waitlist", body, who);
  const entries = () => col("waitlist").find({}).toArray();
  const POINT = { lat: 27.4, lng: 88.4 };

  it("saves a guest's phone and place, normalising the number, and answers 201", async () => {
    const res = await join({ phone: "98765 43210", location: POINT, localityId: null });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { ok: true } });
    expect(await entries()).toEqual([expect.objectContaining({ userId: null, phone: "+919876543210", localityId: null, location: { type: "Point", coordinates: [88.4, 27.4] }, areaKey: "pt:27.40,88.40" })]);
  });

  it("answers the same way for the same phone and area again, saving it once", async () => {
    for (let i = 0; i < 3; i++) expect((await join({ phone: "+919876543210", location: { lat: 27.401, lng: 88.399 } })).status).toBe(201);
    expect(await entries()).toHaveLength(1);
    expect((await join({ phone: "+919876543210", location: { lat: 27.9, lng: 88.4 } })).status).toBe(201);
    expect((await join({ phone: "+919876543211", location: POINT })).status).toBe(201);
    expect(await entries()).toHaveLength(3);
    await Promise.all([1, 2, 3, 4].map(() => join({ phone: "+919800000099", localityId: LOC2 })));
    expect(await col("waitlist").countDocuments({ phone: "+919800000099" })).toBe(1);
  });

  it("uses a logged-in customer's own phone and remembers who they are", async () => {
    f.msg.person(CUSTOMER_A, "+919800000001", []);
    const res = await join({ location: POINT }, customer(CUSTOMER_A));
    expect(res.status).toBe(201);
    expect(await entries()).toEqual([expect.objectContaining({ userId: CUSTOMER_A, phone: "+919800000001" })]);
  });

  it("accepts a locality instead of a point, and checks it exists", async () => {
    expect((await join({ phone: "+919876543210", localityId: LOC2 })).status).toBe(201);
    expect(await entries()).toEqual([expect.objectContaining({ localityId: LOC2, location: null, areaKey: `loc:${LOC2}` })]);
    expect((await join({ phone: "+919876543210", localityId: "9".repeat(24) })).status).toBe(404);
    expect((await join({ phone: "+919876543210", localityId: LOC_OFF })).status).toBe(201);
    expect(LOC1).toBeTruthy();
  });

  it("needs a phone (for a guest) and a place, and checks their shape", async () => {
    expect((await join({ location: POINT })).status).toBe(400);
    f.msg.person(CUSTOMER_A, null, []);
    expect((await join({ location: POINT }, customer(CUSTOMER_A))).status).toBe(400);
    expect((await join({ phone: "+919876543210" })).status).toBe(400);
    expect((await join({ phone: "12345", location: POINT })).status).toBe(400);
    expect((await join({ phone: "+919876543210", location: { lat: 91, lng: 88 } })).status).toBe(400);
    expect((await join({ phone: "+919876543210", location: { lat: 27, lng: 181 } })).status).toBe(400);
    expect((await join({ phone: "+919876543210", location: POINT, extra: 1 })).status).toBe(400);
    expect((await join({ phone: "+919876543210", localityId: "short" })).status).toBe(400);
    expect(await entries()).toHaveLength(0);
  });
});
