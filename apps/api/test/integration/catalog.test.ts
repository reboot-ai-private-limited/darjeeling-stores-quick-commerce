import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogModule, type MediaPort, type ProductUsagePort } from "../../src/modules/catalog/catalog.public.js";
import { actorFromHeader, api, startHarness, type Harness } from "./support/harness.js";

let h: Harness;
let app: ReturnType<Harness["appWith"]>;
let store: ReturnType<typeof createCatalogModule>["store"];
const usage = { offeringCount: vi.fn(async () => 0), canDelete: vi.fn(async () => false), touchOfferings: vi.fn(async () => undefined) } satisfies ProductUsagePort;
const media = {
  describe: vi.fn(async (id: string) => (id.startsWith("a") ? { urls: { "320": `https://cdn.test/${id}/320.webp` } } : null)),
  urls: vi.fn(async (ids: readonly string[]) => Object.fromEntries(ids.map(id => [id, { "320": `https://cdn.test/${id}/320.webp` }]))),
  remove: vi.fn(async () => undefined),
} satisfies MediaPort;

const admin = { "X-Test-Actor": "admin" };
const MEDIA_A = "a".repeat(24);
const MEDIA_B = "ab".repeat(12);
const MEDIA_MISSING = "f".repeat(24);

const get = (path: string, who: Record<string, string> = admin) => request(app).get(api + path).set(who);
const send = (method: "post" | "put" | "delete", path: string, body?: unknown, who: Record<string, string> = admin) => {
  const r = request(app)[method](api + path).set(who);
  return body === undefined ? r : r.send(body as object);
};
const tomato = (over: Record<string, unknown> = {}) => ({
  name: "Fresh Tomato (Local)", categoryId: "", type: "loose", stockMode: "pooled_weight", status: "active",
  variants: [{ label: "250 g", weightGrams: 250, sku: "tom-250" }, { label: "500 g", weightGrams: 500, sku: "TOM-500" }], ...over,
});
async function category(name = "Vegetables", extra: Record<string, unknown> = {}) {
  const res = await send("post", "/admin/categories", { name, ...extra });
  expect(res.status).toBe(201);
  return res.body.data as { id: string };
}
async function product(over: Record<string, unknown> = {}) {
  const cat = typeof over.categoryId === "string" && over.categoryId ? { id: over.categoryId } : await category(`Cat ${Math.random()}`);
  const res = await send("post", "/admin/products", tomato({ categoryId: cat.id, ...over }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; variants: { id: string; sku: string }[] };
}

beforeAll(async () => {
  h = await startHarness("catalog_integration_test");
  const mod = createCatalogModule({ connection: h.connection, auth: actorFromHeader, media, usage });
  store = mod.store;
  app = h.appWith(mod.routes);
}, 180_000);
afterAll(async () => { await h?.stop(); }, 60_000);
beforeEach(async () => {
  await h.reset();
  await store.ensureIndexes();
  vi.clearAllMocks();
  usage.offeringCount.mockResolvedValue(0);
  usage.canDelete.mockResolvedValue(false);
});

describe("access control", () => {
  it("answers 401 with the documented envelope when nobody is logged in", async () => {
    const res = await request(app).get(`${api}/admin/categories`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "UNAUTHORIZED", requestId: res.headers["x-request-id"] });
  });
  it("lets a read-only user read but not change the catalog", async () => {
    expect((await get("/admin/categories", { "X-Test-Actor": "viewer" })).status).toBe(200);
    const denied = await send("post", "/admin/categories", { name: "Nope" }, { "X-Test-Actor": "viewer" });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });
  it("returns 404 for a malformed id instead of querying", async () => {
    const res = await get("/admin/products/not-an-id");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("categories", () => {
  it("creates, nests and lists a category tree ordered by sortOrder", async () => {
    const veg = await category("Vegetables", { sortOrder: 2 });
    await category("Fruits", { sortOrder: 1 });
    await category("Leafy Greens", { parentId: veg.id });
    const tree = (await get("/admin/categories")).body.data;
    expect(tree.map((n: { name: string }) => n.name)).toEqual(["Fruits", "Vegetables"]);
    expect(tree[1].children.map((n: { name: string }) => n.name)).toEqual(["Leafy Greens"]);
  });
  it("rejects a duplicate name, an unknown parent and an invalid body", async () => {
    await category("Vegetables");
    const dup = await send("post", "/admin/categories", { name: "Vegetables" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: "CONFLICT", details: { field: "slug" } });
    expect((await send("post", "/admin/categories", { name: "X", parentId: MEDIA_A })).status).toBe(404);
    const bad = await send("post", "/admin/categories", { name: "", extra: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(bad.body.error.details)).toBe(true);
  });
  it("renames (new slug), toggles and refuses to move a category under itself", async () => {
    const veg = await category("Vegetables");
    const child = await category("Roots", { parentId: veg.id });
    const renamed = await send("put", `/admin/categories/${veg.id}`, { name: "Fresh Veg", isActive: false });
    expect(renamed.body.data).toMatchObject({ name: "Fresh Veg", slug: "fresh-veg", isActive: false });
    const cycle = await send("put", `/admin/categories/${veg.id}`, { parentId: child.id });
    expect(cycle.status).toBe(400);
    expect((await send("put", `/admin/categories/${MEDIA_MISSING}`, { name: "x" })).status).toBe(404);
  });
  it("reorders siblings and rejects a list that is not exactly the siblings", async () => {
    const a = await category("A"); const b = await category("B"); const c = await category("C");
    expect((await send("post", "/admin/categories/reorder", { parentId: null, orderedIds: [c.id, a.id, b.id] })).status).toBe(200);
    expect((await get("/admin/categories")).body.data.map((n: { name: string }) => n.name)).toEqual(["C", "A", "B"]);
    expect((await send("post", "/admin/categories/reorder", { parentId: null, orderedIds: [a.id, b.id] })).status).toBe(400);
    expect((await send("post", "/admin/categories/reorder", { parentId: null, orderedIds: [a.id, a.id, b.id] })).status).toBe(400);
  });
  it("deletes only an empty category", async () => {
    const veg = await category("Vegetables");
    await category("Roots", { parentId: veg.id });
    const withChild = await send("delete", `/admin/categories/${veg.id}`);
    expect(withChild.status).toBe(409);
    expect(withChild.body.error.details).toEqual({ reason: "has_children" });
    const full = await category("Fruits");
    await product({ categoryId: full.id });
    expect((await send("delete", `/admin/categories/${full.id}`)).body.error.details).toEqual({ reason: "has_products" });
    const empty = await category("Empty");
    expect((await send("delete", `/admin/categories/${empty.id}`)).status).toBe(200);
  });
});

describe("products", () => {
  it("creates a product with generated ids, an upper-cased SKU and the documented defaults", async () => {
    const cat = await category();
    const res = await send("post", "/admin/products", tomato({ categoryId: cat.id, status: undefined }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ slug: "fresh-tomato-local", status: "inactive", gstRate: 0, type: "loose", stockMode: "pooled_weight", images: [] });
    expect(res.body.data.variants.map((v: { sku: string }) => v.sku)).toEqual(["TOM-250", "TOM-500"]);
    expect(res.body.data.variants.every((v: { id: string; isActive: boolean }) => /^[a-f0-9]{24}$/.test(v.id) && v.isActive)).toBe(true);
    expect(res.body.data.nameKey).toBeUndefined();
  });
  it("rejects a loose product on per-variant stock, a repeated SKU and a missing category", async () => {
    const cat = await category();
    expect((await send("post", "/admin/products", tomato({ categoryId: cat.id, stockMode: "per_variant" }))).body.error.code).toBe("VALIDATION_ERROR");
    const twice = await send("post", "/admin/products", tomato({ categoryId: cat.id, variants: [{ label: "a", weightGrams: 1, sku: "SAME" }, { label: "b", weightGrams: 2, sku: "same" }] }));
    expect(twice.status).toBe(400);
    expect((await send("post", "/admin/products", tomato({ categoryId: MEDIA_A }))).status).toBe(404);
    expect((await send("post", "/admin/products", { ...tomato({ categoryId: cat.id }), unknownField: true })).status).toBe(400);
  });
  it("refuses a SKU already used by another product", async () => {
    const cat = await category();
    await product({ categoryId: cat.id });
    const dup = await send("post", "/admin/products", tomato({ name: "Other tomato", categoryId: cat.id }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: "CONFLICT", details: { field: "sku" } });
  });
  it("gets one product and lists with filters, search and cursor pagination", async () => {
    const cat = await category();
    const a = await product({ categoryId: cat.id, name: "Apple Fuji", variants: [{ label: "1 kg", weightGrams: 1000, sku: "APL-1" }], type: "packaged", stockMode: "per_variant" });
    await product({ categoryId: cat.id, name: "Banana", variants: [{ label: "1 kg", weightGrams: 1000, sku: "BAN-1" }] });
    await product({ categoryId: cat.id, name: "Carrot", status: "inactive", variants: [{ label: "1 kg", weightGrams: 1000, sku: "CAR-1" }] });
    expect((await get(`/admin/products/${a.id}`)).body.data.name).toBe("Apple Fuji");
    const first = await get("/admin/products?limit=2");
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    const second = await get(`/admin/products?limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.nextCursor).toBeNull();
    expect((await get("/admin/products?q=anan")).body.data.map((p: { name: string }) => p.name)).toEqual(["Banana"]);
    expect((await get("/admin/products?q=car-1")).body.data.map((p: { name: string }) => p.name)).toEqual(["Carrot"]);
    expect((await get("/admin/products?status=inactive")).body.data).toHaveLength(1);
    expect((await get("/admin/products?type=packaged")).body.data).toHaveLength(1);
    expect((await get("/admin/products?limit=500")).status).toBe(400);
    expect((await get("/admin/products?cursor=garbage")).status).toBe(400);
  });
  it("updates fields, regenerates the slug on rename and tells the offerings module", async () => {
    const p = await product();
    const res = await send("put", `/admin/products/${p.id}`, { name: "Hill Tomato", status: "inactive", tags: ["fresh"], gstRate: 5 });
    expect(res.body.data).toMatchObject({ name: "Hill Tomato", slug: "hill-tomato", status: "inactive", tags: ["fresh"], gstRate: 5 });
    expect(usage.touchOfferings).toHaveBeenCalledWith(p.id);
  });
  it("blocks changing type or stock mode once a warehouse sells the product", async () => {
    const p = await product();
    usage.offeringCount.mockResolvedValue(2);
    const res = await send("put", `/admin/products/${p.id}`, { type: "packaged", stockMode: "per_variant" });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "has_offerings" });
  });
  it("archives, restores to inactive and refuses a second restore", async () => {
    const p = await product();
    expect((await send("post", `/admin/products/${p.id}/archive`)).body.data.status).toBe("archived");
    expect((await send("put", `/admin/products/${p.id}`, { status: "active" })).status).toBe(409);
    expect((await send("post", `/admin/products/${p.id}/restore`)).body.data.status).toBe("inactive");
    expect((await send("post", `/admin/products/${p.id}/restore`)).status).toBe(409);
  });
  it("never hard-deletes by default, and deletes (with its images) only when the usage check allows it", async () => {
    const p = await product();
    const blocked = await send("delete", `/admin/products/${p.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toEqual({ reason: "in_use_or_unverified" });
    await send("post", `/admin/products/${p.id}/images`, { mediaId: MEDIA_A });
    usage.canDelete.mockResolvedValue(true);
    expect((await send("delete", `/admin/products/${p.id}`)).status).toBe(200);
    expect((await get(`/admin/products/${p.id}`)).status).toBe(404);
    expect(media.remove).toHaveBeenCalledWith(MEDIA_A, "product_deleted");
  });
});

describe("variants", () => {
  it("adds, edits and deactivates a variant", async () => {
    const p = await product();
    const added = await send("post", `/admin/products/${p.id}/variants`, { label: "1 kg", weightGrams: 1000, sku: "tom-1000" });
    expect(added.status).toBe(201);
    expect(added.body.data.variants).toHaveLength(3);
    const variantId = added.body.data.variants[2].id;
    const edited = await send("put", `/admin/products/${p.id}/variants/${variantId}`, { label: "1 kilo", barcode: "8901234" });
    expect(edited.body.data.variants[2]).toMatchObject({ label: "1 kilo", barcode: "8901234" });
    const off = await send("delete", `/admin/products/${p.id}/variants/${variantId}`);
    expect(off.body.data.variants[2].isActive).toBe(false);
    expect((await send("delete", `/admin/products/${p.id}/variants/${variantId}`)).status).toBe(200);
  });
  it("rejects duplicate SKUs, unknown variants and a weight change on a product that is for sale", async () => {
    const p = await product();
    expect((await send("post", `/admin/products/${p.id}/variants`, { label: "x", weightGrams: 5, sku: "TOM-250" })).status).toBe(400);
    expect((await send("put", `/admin/products/${p.id}/variants/${MEDIA_MISSING}`, { label: "x" })).status).toBe(404);
    usage.offeringCount.mockResolvedValue(1);
    const res = await send("put", `/admin/products/${p.id}/variants/${p.variants[0]!.id}`, { weightGrams: 300 });
    expect(res.status).toBe(409);
    expect((await send("put", `/admin/products/${p.id}/variants/${p.variants[0]!.id}`, { label: "Quarter kilo" })).status).toBe(200);
  });
  it("refuses a SKU owned by a different product", async () => {
    const p = await product();
    const other = await product({ name: "Potato", variants: [{ label: "1 kg", weightGrams: 1000, sku: "POT-1" }] });
    const res = await send("post", `/admin/products/${other.id}/variants`, { label: "x", weightGrams: 5, sku: "TOM-250" });
    expect(res.status).toBe(409);
    expect(p.id).not.toBe(other.id);
  });
});

describe("images", () => {
  it("attaches images with resolved URLs, reorders them and removes one", async () => {
    const p = await product();
    const first = await send("post", `/admin/products/${p.id}/images`, { mediaId: MEDIA_A, alt: "Tomatoes" });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ mediaId: MEDIA_A, alt: "Tomatoes", sortOrder: 0, urls: { "320": expect.stringContaining(MEDIA_A) } });
    expect((await send("post", `/admin/products/${p.id}/images`, { mediaId: MEDIA_B })).body.data.sortOrder).toBe(1);
    const order = await send("put", `/admin/products/${p.id}/images/order`, { orderedMediaIds: [MEDIA_B, MEDIA_A] });
    expect(order.body.data.images.map((i: { mediaId: string }) => i.mediaId)).toEqual([MEDIA_B, MEDIA_A]);
    expect((await send("delete", `/admin/products/${p.id}/images/${MEDIA_B}`)).status).toBe(200);
    expect(media.remove).toHaveBeenCalledWith(MEDIA_B, "product_image_removed");
    expect((await get(`/admin/products/${p.id}`)).body.data.images).toEqual([expect.objectContaining({ mediaId: MEDIA_A, sortOrder: 0 })]);
  });
  it("rejects unknown media, a repeated image, a bad order list and removing an image that is not attached", async () => {
    const p = await product();
    expect((await send("post", `/admin/products/${p.id}/images`, { mediaId: MEDIA_MISSING })).status).toBe(404);
    await send("post", `/admin/products/${p.id}/images`, { mediaId: MEDIA_A });
    expect((await send("post", `/admin/products/${p.id}/images`, { mediaId: MEDIA_A })).status).toBe(409);
    expect((await send("put", `/admin/products/${p.id}/images/order`, { orderedMediaIds: [MEDIA_B] })).status).toBe(400);
    expect((await send("delete", `/admin/products/${p.id}/images/${MEDIA_B}`)).status).toBe(404);
    expect(media.remove).not.toHaveBeenCalled();
  });
});

describe("duplicate check and export", () => {
  it("flags a similar name and an existing SKU", async () => {
    const p = await product();
    const res = await send("post", "/admin/products/check-duplicate", { name: "fresh tomato", skus: ["tom-500", "new-1"] });
    expect(res.status).toBe(200);
    expect(res.body.data.similar).toEqual([expect.objectContaining({ id: p.id, name: "Fresh Tomato (Local)" })]);
    expect((await send("post", "/admin/products/check-duplicate", { name: "Dragon fruit" })).body.data.similar).toEqual([]);
  });
  it("exports CSV and needs the manage permission", async () => {
    await product();
    const res = await get("/admin/catalog/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.split("\n")[0]).toContain("productId,name,category");
    expect(res.text).toContain("TOM-250");
    expect((await get("/admin/catalog/export", { "X-Test-Actor": "viewer" })).status).toBe(403);
  });
});
