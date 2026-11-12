import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, W3, ZONE2, admin, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("import_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const count = (collection: string, filter: Record<string, unknown> = {}) => f.h.connection.collection(collection).countDocuments(filter);
const one = (collection: string, filter: Record<string, unknown>) => f.h.connection.collection(collection).findOne(filter);

async function category(name: string, parentId: string | null = null): Promise<string> {
  const res = await f.send("post", "/admin/categories", { name, parentId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
}
async function pooledIn(categoryId: string, name: string, sku: string) {
  const res = await f.send("post", "/admin/products", {
    name, categoryId, type: "loose", stockMode: "pooled_weight", status: "active",
    variants: [{ label: "250 g", weightGrams: 250, sku: `${sku}-250` }, { label: "500 g", weightGrams: 500, sku: `${sku}-500` }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [a, b] = res.body.data.variants;
  return { id: res.body.data.id as string, v250: a.id as string, v500: b.id as string };
}
const preview = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/import/preview", body, who);
const commit = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/import/commit", body, who);
const rowFor = (res: { body: any }, productId: string) => res.body.data.rows.find((r: { productId: string }) => r.productId === productId);

describe("the warehouse product tree", () => {
  it("shows category > product > variants, nested by category, and leaves out categories with nothing in them", async () => {
    const veg = await category("Vegetables");
    const leafy = await category("Leafy Greens", veg);
    const dairy = await category("Dairy");
    await category("Empty shelf");
    const spinach = await pooledIn(leafy, "Spinach", "SPI");
    const tomato = await pooledIn(veg, "Tomato", "TOM");
    const milk = await pooledIn(dairy, "Milk", "MLK");
    const other = await pooledIn(dairy, "Cheese", "CHZ");
    await f.pooledOffer(W1, spinach, 8000);
    const t = await f.pooledOffer(W1, tomato, 24000);
    await f.pooledOffer(W1, milk, 100);
    await f.pooledOffer(W2, other, 5000);

    const res = await f.get(`/admin/warehouses/${W1}/tree`);
    expect(res.status).toBe(200);
    const tree = res.body.data;
    expect(tree.warehouseId).toBe(W1);
    expect(tree.categories.map((c: { name: string }) => c.name)).toEqual(["Dairy", "Vegetables"]);
    const vegetables = tree.categories[1];
    expect(vegetables.products).toEqual([{
      offeringId: t.id, productId: tomato.id, name: "Tomato", status: "active", rev: t.rev, stockGrams: 24000,
      variants: [
        { variantId: tomato.v250, label: "250 g", price: 1800, mrp: 2000, salePrice: null, stock: null, isActive: true },
        { variantId: tomato.v500, label: "500 g", price: 3200, mrp: 4000, salePrice: null, stock: null, isActive: true },
      ],
    }]);
    expect(vegetables.children).toHaveLength(1);
    expect(vegetables.children[0]).toMatchObject({ name: "Leafy Greens", children: [], products: [{ name: "Spinach" }] });
    expect(tree.categories[0].products.map((p: { name: string }) => p.name)).toEqual(["Milk"]);
  });

  it("filters by name, status and low stock, and returns an empty tree for a warehouse with nothing", async () => {
    const cat = await category("Vegetables");
    const a = await pooledIn(cat, "Tomato", "TOM");
    const b = await pooledIn(cat, "Potato", "POT");
    await f.pooledOffer(W1, a, 24000);
    const lowOffer = await f.pooledOffer(W1, b, 100);
    const names = (res: { body: any }) => res.body.data.categories.flatMap((c: { products: { name: string }[] }) => c.products.map(p => p.name));

    expect(names(await f.get(`/admin/warehouses/${W1}/tree?q=tom`))).toEqual(["Tomato"]);
    expect(names(await f.get(`/admin/warehouses/${W1}/tree?q=nothing`))).toEqual([]);
    expect(names(await f.get(`/admin/warehouses/${W1}/tree?lowStock=true`))).toEqual(["Potato"]);
    expect((await f.send("put", `/admin/warehouse-products/${lowOffer.id}`, { rev: lowOffer.rev, status: "inactive" })).status).toBe(200);
    expect(names(await f.get(`/admin/warehouses/${W1}/tree?status=inactive`))).toEqual(["Potato"]);
    expect(names(await f.get(`/admin/warehouses/${W1}/tree?status=active`))).toEqual(["Tomato"]);
    expect((await f.get(`/admin/warehouses/${W2}/tree`)).body.data.categories).toEqual([]);
  });

  it("serves per-variant products with their unit stock, and enforces permission, scope and input checks", async () => {
    const salt = await f.packagedProduct("Salt");
    await f.packagedOffer(W1, salt, [30, 12]);
    const tree = (await f.get(`/admin/warehouses/${W1}/tree`)).body.data;
    expect(tree.categories[0].products[0]).toMatchObject({ stockGrams: null, variants: [{ stock: 30 }, { stock: 12 }] });

    expect((await f.get(`/admin/warehouses/${W1}/tree`, viewer)).status).toBe(200);
    expect((await f.get(`/admin/warehouses/${W1}/tree`, scoped(W1))).status).toBe(200);
    expect((await f.get(`/admin/warehouses/${W2}/tree`, scoped(W1))).status).toBe(403);
    expect((await f.get(`/admin/warehouses/not-an-id/tree`)).status).toBe(404);
    expect((await f.get(`/admin/warehouses/${W1}/tree?status=bad`)).status).toBe(400);
    expect((await f.get(`/admin/warehouses/${W1}/tree?lowStock=maybe`)).status).toBe(400);
  });
});

describe("previewing an import", () => {
  it("copies prices and quantity into a warehouse of another zone, saves nothing and leaves the source alone", async () => {
    const tomato = await f.pooledProduct("Fresh Tomato (Local)");
    const carrot = await f.pooledProduct("Darjeeling Carrot");
    await f.pooledOffer(W1, tomato, 24000, { v250: 1800, v500: 3200 });
    const carrotSource = await f.pooledOffer(W1, carrot, 6000);
    await f.pooledOffer(W3, carrot, 500, { v250: 1900, v500: 3300 });

    const res = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id, carrot.id], categoryId: null, selectAll: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.previewId).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.data.summary).toEqual({ create: 1, overwrite: 0, skip: 1, conflicts: 0 });
    expect(rowFor(res, tomato.id)).toMatchObject({
      name: "Fresh Tomato (Local)", alreadyInTarget: false, action: "create", stockGrams: 24000, conflicts: [],
      warnings: [{ code: "QUANTITY_COPIED" }],
      variants: [
        { variantId: tomato.v250, label: "250 g", price: 1800, mrp: 2000, salePrice: null, stock: null },
        { variantId: tomato.v500, label: "500 g", price: 3200, mrp: 4000, salePrice: null, stock: null },
      ],
    });
    expect(rowFor(res, carrot.id)).toMatchObject({ alreadyInTarget: true, action: "skip", variants: [], warnings: [], conflicts: [] });
    expect(rowFor(res, carrot.id)).not.toHaveProperty("stockGrams");

    expect(await count("warehouse_products", { warehouseId: W3 })).toBe(1);
    expect(await count("stock_movements", { reason: "import" })).toBe(0);
    const unchanged = (await f.get(`/admin/warehouse-products/${carrotSource.id}`)).body.data;
    expect(unchanged).toMatchObject({ stockGrams: 6000, rev: carrotSource.rev });
  });

  it("applies the quantity mode and the markup to every row", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const salt = await f.packagedProduct("Salt");
    await f.pooledOffer(W1, tomato, 24000);
    await f.packagedOffer(W1, salt, [30, 12]);
    const body = { sourceWarehouseId: W1, targetWarehouseId: W3, selectAll: true };

    const zero = await preview({ ...body, options: { quantityMode: "zero" } });
    expect(rowFor(zero, tomato.id)).toMatchObject({ stockGrams: 0, warnings: [] });
    expect(rowFor(zero, salt.id).variants.map((v: { stock: number }) => v.stock)).toEqual([0, 0]);

    const fixed = await preview({ ...body, options: { quantityMode: "fixed", fixedQuantity: 7 } });
    expect(rowFor(fixed, tomato.id).stockGrams).toBe(7);
    expect(rowFor(fixed, salt.id).variants.map((v: { stock: number }) => v.stock)).toEqual([7, 7]);
    expect(rowFor(fixed, salt.id).warnings).toEqual([expect.objectContaining({ code: "QUANTITY_SET" })]);

    const marked = await preview({ ...body, options: { markupPercent: 10 } });
    expect(rowFor(marked, tomato.id).variants.map((v: { price: number; mrp: number }) => [v.price, v.mrp])).toEqual([[1980, 2200], [3520, 4400]]);
    expect(rowFor(marked, salt.id).variants.map((v: { price: number; mrp: number }) => [v.price, v.mrp])).toEqual([[5500, 6600], [9900, 11000]]);
  });

  it("chooses create, overwrite or skip for products already in the target", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const carrot = await f.pooledProduct("Carrot");
    await f.pooledOffer(W1, tomato, 24000);
    await f.pooledOffer(W1, carrot, 6000);
    await f.pooledOffer(W3, carrot, 500);
    const body = { sourceWarehouseId: W1, targetWarehouseId: W3, selectAll: true };

    const skip = await preview(body);
    expect(skip.body.data.summary).toEqual({ create: 1, overwrite: 0, skip: 1, conflicts: 0 });
    const over = await preview({ ...body, options: { onConflict: "overwrite" } });
    expect(over.body.data.summary).toEqual({ create: 1, overwrite: 1, skip: 0, conflicts: 0 });
    expect(rowFor(over, carrot.id)).toMatchObject({ alreadyInTarget: true, action: "overwrite", warnings: expect.arrayContaining([expect.objectContaining({ code: "STOCK_REPLACED" })]) });
  });

  it("selects by product list, by category with its sub-categories, or all", async () => {
    const veg = await category("Vegetables");
    const leafy = await category("Leafy", veg);
    const dairy = await category("Dairy");
    const tomato = await pooledIn(veg, "Tomato", "TOM");
    const spinach = await pooledIn(leafy, "Spinach", "SPI");
    const milk = await pooledIn(dairy, "Milk", "MLK");
    for (const p of [tomato, spinach, milk]) await f.pooledOffer(W1, p, 1000);
    const base = { sourceWarehouseId: W1, targetWarehouseId: W3 };
    const names = (res: { body: any }) => res.body.data.rows.map((r: { name: string }) => r.name);

    expect(names(await preview({ ...base, productIds: [milk.id] }))).toEqual(["Milk"]);
    expect(names(await preview({ ...base, categoryId: veg }))).toEqual(["Spinach", "Tomato"]);
    expect(names(await preview({ ...base, categoryId: dairy }))).toEqual(["Milk"]);
    expect(names(await preview({ ...base, selectAll: true }))).toEqual(["Milk", "Spinach", "Tomato"]);
  });

  it("only offers products an active size can be copied from, and skips archived or sizeless products with a reason", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const salt = await f.packagedProduct("Salt");
    await f.pooledOffer(W1, tomato, 24000);
    await f.packagedOffer(W1, salt, [5, 5]);
    expect((await f.send("post", `/admin/products/${tomato.id}/archive`)).status).toBe(200);
    for (const variantId of [salt.v1, salt.v2]) expect((await f.send("delete", `/admin/products/${salt.id}/variants/${variantId}`)).status).toBe(200);

    const res = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id, salt.id] });
    expect(rowFor(res, tomato.id)).toMatchObject({ action: "skip", warnings: [{ code: "PRODUCT_ARCHIVED" }] });
    expect(rowFor(res, salt.id)).toMatchObject({ action: "skip", warnings: [{ code: "NO_ACTIVE_VARIANTS" }] });
  });

  it("reports same-zone price conflicts, and allows different prices in another zone", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const body = { sourceWarehouseId: W1, targetWarehouseId: W2, productIds: [tomato.id] };

    const same = await preview(body);
    expect(rowFor(same, tomato.id).conflicts).toEqual([]);
    expect(same.body.data.summary.conflicts).toBe(0);

    const marked = await preview({ ...body, options: { markupPercent: 5 } });
    expect(rowFor(marked, tomato.id).conflicts).toEqual([
      { variantId: tomato.v250, conflicts: [{ warehouseId: W1, price: 1800 }] },
      { variantId: tomato.v500, conflicts: [{ warehouseId: W1, price: 3200 }] },
    ]);
    expect(marked.body.data.summary.conflicts).toBe(1);

    const otherZone = await preview({ ...body, targetWarehouseId: W3, options: { markupPercent: 5 } });
    expect(rowFor(otherZone, tomato.id).conflicts).toEqual([]);
  });

  it("flags a price the markup makes invalid", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const { id, rev } = await f.pooledOffer(W1, tomato, 1000);
    expect((await f.send("put", `/admin/warehouse-products/${id}`, { rev, variants: [{ variantId: tomato.v250, salePrice: 1799 }] })).status).toBe(200);
    const res = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id], options: { markupPercent: -90 } });
    expect(rowFor(res, tomato.id).warnings.map((w: { code: string }) => w.code)).toContain("INVALID_PRICE");
  });

  it("rejects bad requests: selectors, options, same warehouse, unknown things, scope and permission", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const other = await f.pooledProduct("Other");
    await f.pooledOffer(W1, tomato, 1000);
    const base = { sourceWarehouseId: W1, targetWarehouseId: W3 };

    expect((await preview(base)).status).toBe(400);
    expect((await preview({ ...base, productIds: [tomato.id], selectAll: true })).status).toBe(400);
    expect((await preview({ ...base, productIds: [tomato.id], categoryId: "a".repeat(24) })).status).toBe(400);
    expect((await preview({ ...base, productIds: [tomato.id], options: { quantityMode: "fixed" } })).status).toBe(400);
    expect((await preview({ ...base, productIds: [tomato.id], options: { quantityMode: "lots" } })).status).toBe(400);
    expect((await preview({ ...base, productIds: [tomato.id], options: { markupPercent: 1000 } })).status).toBe(400);
    expect((await preview({ ...base, productIds: [tomato.id], extra: 1 })).status).toBe(400);
    expect((await preview({ ...base, targetWarehouseId: W1, productIds: [tomato.id] })).status).toBe(400);

    const missing = await preview({ ...base, productIds: [tomato.id, other.id] });
    expect(missing.status).toBe(404);
    expect(missing.body.error.details).toEqual({ productIds: [other.id] });
    expect((await preview({ ...base, productIds: ["b".repeat(24)] })).status).toBe(404);
    expect((await preview({ ...base, categoryId: "b".repeat(24) })).status).toBe(404);
    expect((await preview({ ...base, targetWarehouseId: "d".repeat(24), productIds: [tomato.id] })).status).toBe(404);
    expect((await preview({ ...base, sourceWarehouseId: "d".repeat(24), productIds: [tomato.id] })).status).toBe(404);

    expect((await preview({ ...base, productIds: [tomato.id] }, viewer)).status).toBe(403);
    expect((await preview({ ...base, productIds: [tomato.id] }, scoped(W1))).status).toBe(403);
    expect((await preview({ sourceWarehouseId: W1, targetWarehouseId: W2, productIds: [tomato.id] }, scoped(W1))).status).toBe(403);
  });
});

describe("committing an import", () => {
  it("creates the offerings with their history and a revision, never touches the source, and works only once", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const salt = await f.packagedProduct("Salt");
    const carrot = await f.pooledProduct("Carrot");
    const sourceTomato = await f.pooledOffer(W1, tomato, 24000);
    await f.packagedOffer(W1, salt, [30, 12]);
    await f.pooledOffer(W3, carrot, 100);
    await f.pooledOffer(W1, carrot, 4000);
    f.events.length = 0;

    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, selectAll: true });
    const previewId = pre.body.data.previewId;
    const rows = pre.body.data.rows.filter((r: { action: string }) => r.action === "create");
    expect(rows).toHaveLength(2);

    const refused = await commit({ previewId, confirmQuantities: false, rows });
    expect(refused.status).toBe(400);
    expect(refused.body.error.details).toEqual({ field: "confirmQuantities" });
    expect(await count("warehouse_products", { warehouseId: W3 })).toBe(1);

    const res = await commit({ previewId, confirmQuantities: true, rows });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ created: 2, overwritten: 0, skipped: 1 });
    expect(res.body.data.offeringIds).toHaveLength(2);

    const created = (await f.get(`/admin/warehouse-products/${res.body.data.offeringIds[0]}`)).body.data;
    expect(created).toMatchObject({ warehouseId: W3, zoneId: ZONE2, status: "active", importedFrom: { warehouseId: W1 } });
    expect(created.importedFrom.at).toEqual(expect.any(String));
    expect(created.importedFrom.by).toBe("000000000000000000000001");
    expect(created.rev).toBeGreaterThan(sourceTomato.rev);

    const tomatoCopy = (await f.get(`/admin/warehouses/${W3}/products?q=tomato`)).body.data[0];
    expect(tomatoCopy).toMatchObject({ stockGrams: 24000, variants: [{ price: 1800, mrp: 2000 }, { price: 3200, mrp: 4000 }] });
    const saltCopy = (await f.get(`/admin/warehouses/${W3}/products?q=salt`)).body.data[0];
    expect(saltCopy.variants.map((v: { stock: number }) => v.stock)).toEqual([30, 12]);

    expect(await count("stock_movements", { reason: "import", warehouseId: W3 })).toBe(3);
    expect(await one("stock_movements", { reason: "import", productId: tomato.id })).toMatchObject({ delta: 24000, balanceAfter: 24000, mode: "grams", by: "000000000000000000000001" });
    expect(await count("price_history", { warehouseId: W3, productId: { $in: [tomato.id, salt.id] }, oldPrice: 0 })).toBe(4);
    expect(f.events.filter(e => e.type === "stock.zone_availability_changed")).toHaveLength(4);

    const source = (await f.get(`/admin/warehouse-products/${sourceTomato.id}`)).body.data;
    expect(source).toMatchObject({ stockGrams: 24000, rev: sourceTomato.rev, importedFrom: null });
    expect(await count("stock_movements", { warehouseId: W1, reason: "import" })).toBe(0);

    expect((await commit({ previewId, confirmQuantities: true, rows })).status).toBe(404);
    expect(await count("warehouse_products", { warehouseId: W3 })).toBe(3);
  });

  it("uses the edited prices and quantities from the rows", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id] });
    const res = await commit({
      previewId: pre.body.data.previewId, confirmQuantities: true,
      rows: [{ productId: tomato.id, action: "create", stockGrams: 5000, variants: [{ variantId: tomato.v500, price: 3300, mrp: 4000, salePrice: 3000, maxQtyPerOrder: 4 }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const offering = (await f.get(`/admin/warehouse-products/${res.body.data.offeringIds[0]}`)).body.data;
    expect(offering.stockGrams).toBe(5000);
    expect(offering.variants).toHaveLength(1);
    expect(offering.variants[0]).toMatchObject({ variantId: tomato.v500, price: 3300, mrp: 4000, salePrice: 3000, maxQtyPerOrder: 4 });
    expect(await one("stock_movements", { reason: "import", productId: tomato.id })).toMatchObject({ delta: 5000 });
  });

  it("needs no quantity confirmation when no stock is carried over", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id], options: { quantityMode: "zero" } });
    f.events.length = 0;
    const res = await commit({ previewId: pre.body.data.previewId, rows: pre.body.data.rows });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await f.get(`/admin/warehouse-products/${res.body.data.offeringIds[0]}`)).body.data.stockGrams).toBe(0);
    expect(await count("stock_movements", { reason: "import" })).toBe(0);
    expect(f.events).toEqual([]);
  });

  it("overwrites an existing offering, recording the stock change and the price change", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000, { v250: 1800, v500: 3200 });
    const target = await f.pooledOffer(W3, tomato, 1000, { v250: 1500, v500: 2800 });
    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id], options: { onConflict: "overwrite" } });
    expect(rowFor(pre, tomato.id).action).toBe("overwrite");

    const res = await commit({ previewId: pre.body.data.previewId, confirmQuantities: true, rows: pre.body.data.rows });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ created: 0, overwritten: 1, skipped: 0, offeringIds: [target.id] });
    const after = (await f.get(`/admin/warehouse-products/${target.id}`)).body.data;
    expect(after).toMatchObject({ stockGrams: 24000, importedFrom: { warehouseId: W1 } });
    expect(after.rev).toBeGreaterThan(target.rev);
    expect(after.variants.map((v: { price: number }) => v.price)).toEqual([1800, 3200]);
    expect(await one("stock_movements", { reason: "import", productId: tomato.id })).toMatchObject({ delta: 23000, balanceAfter: 24000 });
    expect(await count("price_history", { warehouseId: W3, oldPrice: 1500, newPrice: 1800 })).toBe(1);
    expect(await count("warehouse_products", { warehouseId: W3 })).toBe(1);
  });

  it("refuses with PRICE_CONFLICT when a same-zone price would differ, saves nothing, and accepts the corrected rows with the same preview", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const salt = await f.packagedProduct("Salt");
    await f.pooledOffer(W1, tomato, 24000);
    await f.packagedOffer(W1, salt, [5, 5]);
    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W2, selectAll: true, options: { markupPercent: 5, quantityMode: "zero" } });
    expect(pre.body.data.summary.conflicts).toBe(2);

    const res = await commit({ previewId: pre.body.data.previewId, rows: pre.body.data.rows });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRICE_CONFLICT");
    expect(res.body.error.details).toMatchObject({ canApplyToOthers: false, conflicts: [{ warehouseId: W1 }] });
    expect(res.body.error.details.variants).toHaveLength(4);
    expect(await count("warehouse_products", { warehouseId: W2 })).toBe(0);
    expect(await count("price_history", { warehouseId: W2 })).toBe(0);

    const fixed = pre.body.data.rows.map((row: any) => ({
      productId: row.productId, action: row.action,
      variants: row.variants.map((v: any) => ({ variantId: v.variantId, price: Math.round(v.price / 1.05), mrp: Math.round(v.mrp / 1.05) })),
    }));
    const retry = await commit({ previewId: pre.body.data.previewId, rows: fixed });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(await count("warehouse_products", { warehouseId: W2 })).toBe(2);
  });

  it("detects a conflict created after the preview was made", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id], options: { quantityMode: "zero" } });
    // Another warehouse in the target's zone starts selling it at a different price.
    await f.pooledOffer(W3, tomato, 100, { v250: 1800, v500: 3200 });
    const stale = await commit({ previewId: pre.body.data.previewId, rows: pre.body.data.rows });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "target_changed" } });
  });

  it("rejects rows that do not match the preview", async () => {
    const tomato = await f.pooledProduct("Tomato");
    const carrot = await f.pooledProduct("Carrot");
    const salt = await f.packagedProduct("Salt");
    await f.pooledOffer(W1, tomato, 24000);
    await f.pooledOffer(W1, carrot, 6000);
    await f.pooledOffer(W3, carrot, 10);
    await f.packagedOffer(W1, salt, [5, 5]);
    const pre = await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, selectAll: true });
    const previewId = pre.body.data.previewId;
    const t = rowFor(pre, tomato.id);
    const good = { productId: tomato.id, action: "create", variants: t.variants.map((v: any) => ({ variantId: v.variantId, price: v.price, mrp: v.mrp })) };
    const bad = async (rows: unknown[], status = 400) => {
      const res = await commit({ previewId, confirmQuantities: true, rows });
      expect(res.status, JSON.stringify(rows)).toBe(status);
      return res;
    };

    await bad([{ ...good, action: "overwrite" }]);
    await bad([{ productId: carrot.id, action: "create", variants: good.variants }]);
    await bad([{ productId: carrot.id, action: "overwrite", variants: [] }]);
    await bad([{ productId: "e".repeat(24), action: "create", variants: good.variants }]);
    await bad([good, good]);
    await bad([{ ...good, variants: [{ variantId: "f".repeat(24), price: 100, mrp: 200 }] }]);
    await bad([{ ...good, variants: [good.variants[0], good.variants[0]] }]);
    await bad([{ ...good, variants: [{ ...good.variants[0], mrp: good.variants[0].price - 1 }] }]);
    await bad([{ ...good, variants: [{ ...good.variants[0], salePrice: good.variants[0].price }] }]);
    await bad([{ ...good, variants: [{ ...good.variants[0], stock: 5 }] }]);
    await bad([{ ...good, stockGrams: null }]);
    await bad([{ ...good, stockGrams: -1 }]);
    await bad([{ ...good, variants: [{ ...good.variants[0], price: 0 }] }]);
    const saltRow = rowFor(pre, salt.id);
    await bad([{ productId: salt.id, action: "create", stockGrams: 5, variants: saltRow.variants.map((v: any) => ({ variantId: v.variantId, price: v.price, mrp: v.mrp })) }]);
    await bad([{ productId: salt.id, action: "create", variants: saltRow.variants.map((v: any) => ({ variantId: v.variantId, price: v.price, mrp: v.mrp, stock: null })) }]);
    expect((await commit({ previewId, confirmQuantities: true, rows: [good], extra: true })).status).toBe(400);
    expect(await count("warehouse_products", { warehouseId: W3 })).toBe(1);

    // A skip row, or leaving a product out, counts as skipped.
    const ok = await commit({ previewId, confirmQuantities: true, rows: [good, { productId: salt.id, action: "skip" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toMatchObject({ created: 1, overwritten: 0, skipped: 2 });
  });

  it("treats an unknown, expired, foreign or already-used preview as NOT_FOUND, and checks permission and scope", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const make = async (who = admin, source = W1, target = W3) => (await preview({ sourceWarehouseId: source, targetWarehouseId: target, productIds: [tomato.id], options: { quantityMode: "zero" } }, who)).body.data;
    const send = (data: any, who = admin) => commit({ previewId: data.previewId, rows: data.rows }, who);

    expect((await commit({ previewId: "9".repeat(24), rows: [] })).status).toBe(404);
    const expired = await make();
    await f.h.connection.collection("import_previews").updateOne({ _id: expired.previewId as never }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await send(expired)).status).toBe(404);

    const mine = await make();
    expect((await send(mine, viewer)).status).toBe(403);
    expect((await send(mine, scoped(W1))).status).toBe(404);
    expect((await commit({ previewId: mine.previewId, rows: mine.rows }, scoped(W3))).status).toBe(404);
    expect((await send(mine)).status).toBe(201);
    expect((await send(mine)).status).toBe(404);
  });

  it("lets only one of two simultaneous commits of the same preview through", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const pre = (await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id], options: { quantityMode: "zero" } })).body.data;
    const results = await Promise.all([1, 2, 3].map(() => commit({ previewId: pre.previewId, rows: pre.rows })));
    expect(results.map(r => r.status).sort()).toEqual([201, 404, 404]);
    expect(await count("warehouse_products", { warehouseId: W3 })).toBe(1);
  });

  it("makes the imported product visible to later stock operations and price rules", async () => {
    const tomato = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, tomato, 24000);
    const pre = (await preview({ sourceWarehouseId: W1, targetWarehouseId: W3, productIds: [tomato.id] })).body.data;
    const res = await commit({ previewId: pre.previewId, confirmQuantities: true, rows: pre.rows });
    expect(res.status).toBe(201);
    const adjust = await f.send("post", "/admin/stock/adjust", { warehouseId: W3, productId: tomato.id, variantId: null, delta: -1000, reason: "wastage" });
    expect(adjust.status).toBe(200);
    expect(adjust.body.data.balanceAfter).toBe(23000);
    const reserve = await f.mods.stock.reserve({ key: "order-1", lines: [{ warehouseId: W3, productId: tomato.id, variantId: tomato.v500, qty: 2 }] });
    expect(reserve.ok).toBe(true);
    const list = (await f.get(`/admin/warehouses/${W3}/products`)).body.data;
    expect(list[0].stockGrams).toBe(22000);
  });
});
