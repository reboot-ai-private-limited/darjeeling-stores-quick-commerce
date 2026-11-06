import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, W3, ZONE1, ZONE2, admin, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("offerings_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const count = (collection: string, filter: Record<string, unknown> = {}) => f.h.connection.collection(collection).countDocuments(filter);

describe("creating an offering", () => {
  it("creates a pooled offering with product details, an initial-stock movement, price history, an audit entry and a revision", async () => {
    const p = await f.pooledProduct("Fresh Tomato (Local)");
    const { body } = await f.offer(W1, p.id, {
      stockGrams: 24000,
      variants: [{ variantId: p.v250, price: 1800, mrp: 2000 }, { variantId: p.v500, price: 3200, mrp: 4000, maxQtyPerOrder: 10 }],
    });
    expect(body).toMatchObject({
      warehouseId: W1, zoneId: ZONE1, status: "active", stockGrams: 24000, isOutOfStockOverride: false, importedFrom: null,
      product: { name: "Fresh Tomato (Local)", type: "loose", stockMode: "pooled_weight" },
    });
    expect(body.rev).toBeGreaterThan(0);
    expect(body.variants).toEqual([
      expect.objectContaining({ variantId: p.v250, label: "250 g", weightGrams: 250, price: 1800, mrp: 2000, salePrice: null, stock: null, maxQtyPerOrder: null }),
      expect.objectContaining({ variantId: p.v500, label: "500 g", weightGrams: 500, price: 3200, mrp: 4000, maxQtyPerOrder: 10 }),
    ]);
    expect(await count("stock_movements", { reason: "correction", delta: 24000, balanceAfter: 24000, mode: "grams" })).toBe(1);
    expect(await count("price_history")).toBe(2);
    expect(await count("audit_log", { action: "offering.create", entityId: body.id })).toBe(1);
    expect(f.events.filter(e => e.type === "stock.zone_availability_changed")).toHaveLength(2);
  });

  it("creates a per-variant offering and requires a stock figure for every variant", async () => {
    const p = await f.packagedProduct();
    const ok = await f.packagedOffer(W1, p, [30, 12]);
    const got = (await f.get(`/admin/warehouse-products/${ok.id}`)).body.data;
    expect(got.stockGrams).toBeNull();
    expect(got.variants.map((v: { stock: number }) => v.stock)).toEqual([30, 12]);
    const missing = await f.send("post", "/admin/warehouse-products", { warehouseId: W3, productId: p.id, variants: [{ variantId: p.v1, price: 5000, mrp: 6000 }] });
    expect(missing.status).toBe(400);
    const pool = await f.send("post", "/admin/warehouse-products", { warehouseId: W3, productId: p.id, stockGrams: 1000, variants: [{ variantId: p.v1, price: 5000, mrp: 6000, stock: 1 }] });
    expect(pool.status).toBe(400);
  });

  it("rejects bad input: pooled stock rules, unknown variants, prices, archived products, unknown warehouses and duplicates", async () => {
    const p = await f.pooledProduct();
    const other = await f.pooledProduct();
    const base = { warehouseId: W1, productId: p.id, stockGrams: 1000, variants: [{ variantId: p.v500, price: 3200, mrp: 4000 }] };
    expect((await f.send("post", "/admin/warehouse-products", { ...base, stockGrams: null })).status).toBe(400);
    expect((await f.send("post", "/admin/warehouse-products", { ...base, variants: [{ variantId: p.v500, price: 3200, mrp: 4000, stock: 5 }] })).status).toBe(400);
    expect((await f.send("post", "/admin/warehouse-products", { ...base, variants: [{ variantId: other.v500, price: 3200, mrp: 4000 }] })).status).toBe(400);
    const cheapMrp = await f.send("post", "/admin/warehouse-products", { ...base, variants: [{ variantId: p.v500, price: 3200, mrp: 3000 }] });
    expect(cheapMrp.status).toBe(400);
    expect(cheapMrp.body.error.details.problems.join()).toMatch(/mrp/);
    expect((await f.send("post", "/admin/warehouse-products", { ...base, variants: [{ variantId: p.v500, price: 3200, mrp: 4000 }, { variantId: p.v500, price: 3200, mrp: 4000 }] })).status).toBe(400);
    expect((await f.send("post", "/admin/warehouse-products", { ...base, warehouseId: "b".repeat(24) })).status).toBe(404);
    expect((await f.send("post", "/admin/warehouse-products", { ...base, productId: "c".repeat(24) })).status).toBe(404);
    await f.send("post", `/admin/products/${p.id}/archive`);
    expect((await f.send("post", "/admin/warehouse-products", base)).status).toBe(409);
    await f.send("post", `/admin/products/${p.id}/restore`);
    expect((await f.send("post", "/admin/warehouse-products", base)).status).toBe(201);
    expect((await f.send("post", "/admin/warehouse-products", base)).status).toBe(409);
  });

  it("enforces permissions and warehouse scope", async () => {
    const p = await f.pooledProduct();
    const body = { warehouseId: W1, productId: p.id, stockGrams: 1000, variants: [{ variantId: p.v500, price: 3200, mrp: 4000 }] };
    expect((await f.send("post", "/admin/warehouse-products", body, viewer)).status).toBe(403);
    expect((await f.send("post", "/admin/warehouse-products", body, scoped(W2))).status).toBe(403);
    expect((await f.send("post", "/admin/warehouse-products", body, scoped(W1))).status).toBe(201);
  });
});

describe("same-zone price rule", () => {
  it("blocks a different price in another warehouse of the zone, allows the same price, and allows any price in another zone", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 10000);
    const conflict = await f.send("post", "/admin/warehouse-products", {
      warehouseId: W2, productId: p.id, stockGrams: 5000, variants: [{ variantId: p.v500, price: 3300, mrp: 4000 }],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: "PRICE_CONFLICT", details: { variantId: p.v500, canApplyToOthers: false, conflicts: [{ warehouseId: W1, price: 3200 }] } });
    expect((await f.send("post", "/admin/warehouse-products", { warehouseId: W2, productId: p.id, stockGrams: 5000, variants: [{ variantId: p.v500, price: 3200, mrp: 4000 }] })).status).toBe(201);
    const elsewhere = await f.send("post", "/admin/warehouse-products", { warehouseId: W3, productId: p.id, stockGrams: 5000, variants: [{ variantId: p.v500, price: 9900, mrp: 10000 }] });
    expect(elsewhere.status).toBe(201);
    expect(elsewhere.body.data.zoneId).toBe(ZONE2);
  });

  it("does not announce 'back in stock' when another warehouse in the zone already has stock", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 10000);
    f.events.length = 0;
    await f.pooledOffer(W2, p, 5000);
    expect(f.events.filter(e => e.type === "stock.zone_availability_changed")).toEqual([]);
  });

  it("serialises two simultaneous price writes so the rule cannot be bypassed", async () => {
    const p = await f.pooledProduct();
    const a = await f.pooledOffer(W1, p, 10000);
    const b = await f.pooledOffer(W2, p, 10000);
    const change = (id: string, rev: number, price: number) => f.send("put", `/admin/warehouse-products/${id}`, { rev, variants: [{ variantId: p.v500, price }] });
    const results = await Promise.all([change(a.id, a.rev, 3300), change(b.id, b.rev, 3400)]);
    const codes = results.map(r => r.status).sort();
    // Each change would put the zone out of line with the other, so neither may succeed.
    expect(codes).toEqual([409, 409]);
    expect(results.every(r => r.body.error.code === "PRICE_CONFLICT")).toBe(true);
    const after = [(await f.get(`/admin/warehouse-products/${a.id}`)).body.data, (await f.get(`/admin/warehouse-products/${b.id}`)).body.data];
    expect(after.map(o => o.variants[1].price)).toEqual([3200, 3200]);
  });
});

describe("updating an offering", () => {
  it("changes a price, bumps the revision and records price history and an audit entry", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 10000);
    const res = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, price: 3300 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.variants[1].price).toBe(3300);
    expect(res.body.data.rev).toBeGreaterThan(o.rev);
    expect(await count("price_history", { variantId: p.v500, oldPrice: 3200, newPrice: 3300 })).toBe(1);
    expect(await count("audit_log", { action: "offering.update", entityId: o.id })).toBe(1);
  });

  it("refuses a stale revision with VERSION_CONFLICT", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 10000);
    await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, status: "inactive" });
    const stale = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, status: "active" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "VERSION_CONFLICT", details: { currentRev: expect.any(Number) } });
  });

  it("offers PRICE_CONFLICT with canApplyToOthers, and applies the new price to the other warehouse when asked", async () => {
    const p = await f.pooledProduct();
    const a = await f.pooledOffer(W1, p, 10000);
    const b = await f.pooledOffer(W2, p, 10000);
    const blocked = await f.send("put", `/admin/warehouse-products/${a.id}`, { rev: a.rev, variants: [{ variantId: p.v500, price: 3300 }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toMatchObject({ canApplyToOthers: true, conflicts: [{ warehouseId: W2, price: 3200 }] });
    const ok = await f.send("put", `/admin/warehouse-products/${a.id}`, { rev: a.rev, variants: [{ variantId: p.v500, price: 3300 }], applyToWarehouseIds: [W2] });
    expect(ok.status).toBe(200);
    const other = (await f.get(`/admin/warehouse-products/${b.id}`)).body.data;
    expect(other.variants[1].price).toBe(3300);
    expect(other.rev).toBeGreaterThan(b.rev);
    expect(await count("price_history", { warehouseId: W2, newPrice: 3300 })).toBe(1);
  });

  it("rejects applyToWarehouseIds that are not siblings in the zone, and writes outside the caller's scope", async () => {
    const p = await f.pooledProduct();
    const a = await f.pooledOffer(W1, p, 10000);
    await f.pooledOffer(W2, p, 10000);
    await f.pooledOffer(W3, p, 10000);
    const notSibling = await f.send("put", `/admin/warehouse-products/${a.id}`, { rev: a.rev, variants: [{ variantId: p.v500, price: 3300 }], applyToWarehouseIds: [W3] });
    expect(notSibling.status).toBe(400);
    const outside = await f.send("put", `/admin/warehouse-products/${a.id}`, { rev: a.rev, variants: [{ variantId: p.v500, price: 3300 }], applyToWarehouseIds: [W2] }, scoped(W1));
    expect(outside.status).toBe(403);
    expect((await f.get(`/admin/warehouse-products/${a.id}`)).body.data.variants[1].price).toBe(3200);
  });

  it("validates every touched variant, including an MRP that falls below the price", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 10000);
    const res = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, mrp: 3000 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.details.problems.join()).toMatch(/mrp/);
    const sale = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, salePrice: 3200 }] });
    expect(sale.status).toBe(400);
  });

  it("treats a sale price at one warehouse as a different effective price", async () => {
    const p = await f.pooledProduct();
    const a = await f.pooledOffer(W1, p, 10000);
    await f.pooledOffer(W2, p, 10000);
    const res = await f.send("put", `/admin/warehouse-products/${a.id}`, { rev: a.rev, variants: [{ variantId: p.v500, salePrice: 3000, saleStart: "2026-01-01T00:00:00Z", saleEnd: "2099-01-01T00:00:00Z" }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRICE_CONFLICT");
  });

  it("sets the gram stock with a correction movement, rejects stock on the wrong product kind, and can add a variant", async () => {
    const pooled = await f.pooledProduct();
    const o = await f.pooledOffer(W3, pooled, 10000);
    const set = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, stockGrams: 7000, isOutOfStockOverride: true });
    expect(set.body.data).toMatchObject({ stockGrams: 7000, isOutOfStockOverride: true });
    expect(await count("stock_movements", { delta: -3000, balanceAfter: 7000, reason: "correction" })).toBe(1);
    const wrong = await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: set.body.data.rev, variants: [{ variantId: pooled.v500, stock: 5 }] });
    expect(wrong.status).toBe(400);
    const packaged = await f.packagedProduct();
    const po = await f.packagedOffer(W3, packaged, [5, 5]);
    expect((await f.send("put", `/admin/warehouse-products/${po.id}`, { rev: po.rev, stockGrams: 100 })).status).toBe(400);
    const added = await f.send("post", `/admin/products/${packaged.id}/variants`, { label: "2 kg", weightGrams: 2000, sku: "SALT-2000" });
    const newVariant = added.body.data.variants[2].id;
    // Changing the product bumped the offering's revision, so the old one is now stale.
    expect((await f.send("put", `/admin/warehouse-products/${po.id}`, { rev: po.rev, status: "active" })).status).toBe(409);
    const currentRev = (await f.get(`/admin/warehouse-products/${po.id}`)).body.data.rev;
    const addLine = await f.send("put", `/admin/warehouse-products/${po.id}`, { rev: currentRev, variants: [{ variantId: newVariant, price: 15000, mrp: 16000, stock: 4 }] });
    expect(addLine.status).toBe(200);
    expect(addLine.body.data.variants).toHaveLength(3);
    expect((await f.send("put", `/admin/warehouse-products/${po.id}`, { rev: addLine.body.data.rev, variants: [{ variantId: "d".repeat(24), price: 1, mrp: 2 }] })).status).toBe(400);
  });

  it("404s for an unknown offering and 403s for another warehouse's offering", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W1, p, 1000);
    expect((await f.get(`/admin/warehouse-products/${"e".repeat(24)}`)).status).toBe(404);
    expect((await f.get(`/admin/warehouse-products/${o.id}`, scoped(W2))).status).toBe(403);
    expect((await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, status: "inactive" }, scoped(W2))).status).toBe(403);
  });
});

describe("listing and bulk edits", () => {
  it("lists a warehouse's offerings with search, status and low-stock filters, pagination and scope", async () => {
    const a = await f.pooledProduct("Apple Fuji");
    const b = await f.pooledProduct("Banana Robusta");
    const c = await f.pooledProduct("Carrot");
    await f.pooledOffer(W1, a, 20000, {});
    await f.pooledOffer(W1, b, 1000, {});
    const oc = await f.pooledOffer(W1, c, 20000, {});
    await f.send("put", `/admin/warehouse-products/${oc.id}`, { rev: oc.rev, status: "inactive" });
    const list = (q: string) => f.get(`/admin/warehouses/${W1}/products${q}`);
    expect((await list("")).body.data).toHaveLength(3);
    expect((await list("?q=banana")).body.data.map((o: { product: { name: string } }) => o.product.name)).toEqual(["Banana Robusta"]);
    expect((await list("?status=inactive")).body.data).toHaveLength(1);
    expect((await list("?lowStock=true")).body.data.map((o: { product: { name: string } }) => o.product.name)).toEqual(["Banana Robusta"]);
    expect((await list("?q=zzz")).body.data).toEqual([]);
    const first = await list("?limit=2");
    expect(first.body.data).toHaveLength(2);
    const second = await list(`?limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.nextCursor).toBeNull();
    expect((await f.get(`/admin/warehouses/${W1}/products`, scoped(W2))).status).toBe(403);
    expect((await f.get(`/admin/warehouses/${W1}/products`, viewer)).status).toBe(200);
    expect((await list("?lowStock=maybe")).status).toBe(400);
  });

  it("applies bulk quantity, price and status actions and reports per-offering failures", async () => {
    const p = await f.pooledProduct();
    const a = await f.pooledOffer(W1, p, 10000);
    const b = await f.pooledOffer(W2, p, 10000);
    const c = await f.pooledOffer(W3, p, 10000);
    const bulk = (ids: string[], action: unknown, who = admin) => f.send("post", "/admin/warehouse-products/bulk", { ids, action }, who);
    const qty = await bulk([a.id, c.id], { type: "set_quantity", value: 2500 });
    expect(qty.body.data).toEqual({ updated: 2, failed: [] });
    expect((await f.get(`/admin/warehouse-products/${a.id}`)).body.data.stockGrams).toBe(2500);
    const price = await bulk([c.id, a.id], { type: "price_percent", value: 10 });
    expect(price.body.data.updated).toBe(1);
    expect(price.body.data.failed).toEqual([expect.objectContaining({ id: a.id, code: "PRICE_CONFLICT" })]);
    expect((await f.get(`/admin/warehouse-products/${c.id}`)).body.data.variants.map((v: { price: number }) => v.price)).toEqual([1980, 3520]);
    const tooMuch = await bulk([b.id], { type: "add_quantity", value: -999_999 });
    expect(tooMuch.body.data.failed).toEqual([expect.objectContaining({ id: b.id, code: "INSUFFICIENT_STOCK" })]);
    const aboveMrp = await bulk([c.id], { type: "set_price", value: 9000 });
    expect(aboveMrp.body.data.failed).toEqual([expect.objectContaining({ id: c.id, code: "VALIDATION_ERROR" })]);
    expect((await bulk([a.id, b.id], { type: "set_status", value: "inactive" })).body.data.updated).toBe(2);
    const outside = await bulk([a.id, c.id], { type: "set_status", value: "active" }, scoped(W1));
    expect(outside.body.data).toEqual({ updated: 1, failed: [expect.objectContaining({ id: c.id, code: "FORBIDDEN" })] });
    expect((await bulk([a.id], { type: "teleport", value: 1 })).status).toBe(400);
    expect((await bulk([], { type: "set_status", value: "active" })).status).toBe(400);
  });
});

describe("stock adjustments and stock-takes", () => {
  it("adds and removes stock with movements, an audit entry, the new revision and a back-in-stock event", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W1, p, 0);
    f.events.length = 0;
    const purchase = await f.send("post", "/admin/stock/adjust", { warehouseId: W1, productId: p.id, delta: 5000, reason: "purchase", note: "Morning delivery" });
    expect(purchase.status).toBe(200);
    expect(purchase.body.data).toMatchObject({ balanceAfter: 5000, rev: expect.any(Number) });
    expect(purchase.body.data.rev).toBeGreaterThan(o.rev);
    expect(f.events.filter(e => e.type === "stock.zone_availability_changed")).toHaveLength(2);
    const waste = await f.send("post", "/admin/stock/adjust", { warehouseId: W1, productId: p.id, delta: -1500, reason: "wastage" });
    expect(waste.body.data.balanceAfter).toBe(3500);
    expect(await count("audit_log", { action: "stock.adjust" })).toBe(2);
    const moves = await f.get(`/admin/stock/movements?warehouseId=${W1}&reason=wastage`);
    expect(moves.body.data).toEqual([expect.objectContaining({ delta: -1500, balanceAfter: 3500, reason: "wastage", note: null, by: expect.any(String) })]);
  });

  it("refuses to go below zero and leaves the stock unchanged", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 1000);
    const res = await f.send("post", "/admin/stock/adjust", { warehouseId: W1, productId: p.id, delta: -1001, reason: "correction" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    const levels = await f.get(`/admin/stock/levels?warehouseId=${W1}`);
    expect(levels.body.data[0].stock).toBe(1000);
  });

  it("validates reason and sign, the variant for the product kind, and permissions", async () => {
    const pooled = await f.pooledProduct();
    await f.pooledOffer(W1, pooled, 1000);
    const packaged = await f.packagedProduct();
    await f.packagedOffer(W1, packaged, [10, 10]);
    const adjust = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/stock/adjust", body, who);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, delta: 0, reason: "correction" })).status).toBe(400);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, delta: -5, reason: "purchase" })).status).toBe(400);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, delta: 5, reason: "wastage" })).status).toBe(400);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, delta: 5, reason: "gift" })).status).toBe(400);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, variantId: pooled.v250, delta: 5, reason: "purchase" })).status).toBe(400);
    expect((await adjust({ warehouseId: W1, productId: packaged.id, delta: 5, reason: "purchase" })).status).toBe(400);
    expect((await adjust({ warehouseId: W1, productId: packaged.id, variantId: packaged.v1, delta: 5, reason: "purchase" })).body.data.balanceAfter).toBe(15);
    expect((await adjust({ warehouseId: W1, productId: "9".repeat(24), delta: 5, reason: "purchase" })).status).toBe(404);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, delta: 5, reason: "purchase" }, viewer)).status).toBe(403);
    expect((await adjust({ warehouseId: W1, productId: pooled.id, delta: 5, reason: "purchase" }, scoped(W2))).status).toBe(403);
  });

  it("counts stock, reporting the change per product and per-item failures", async () => {
    const pooled = await f.pooledProduct();
    await f.pooledOffer(W1, pooled, 22000);
    const packaged = await f.packagedProduct();
    await f.packagedOffer(W1, packaged, [10, 4]);
    const res = await f.send("post", "/admin/stock/count", { warehouseId: W1, counts: [
      { productId: pooled.id, counted: 21500 },
      { productId: packaged.id, variantId: packaged.v2, counted: 4 },
      { productId: "9".repeat(24), counted: 3 },
    ] });
    expect(res.status).toBe(200);
    expect(res.body.data.adjusted).toEqual([
      { productId: pooled.id, variantId: null, before: 22000, after: 21500, delta: -500 },
      { productId: packaged.id, variantId: packaged.v2, before: 4, after: 4, delta: 0 },
    ]);
    expect(res.body.data.failed).toEqual([{ productId: "9".repeat(24), code: "NOT_FOUND" }]);
    expect(await count("stock_movements", { reason: "count", delta: -500 })).toBe(1);
    expect((await f.send("post", "/admin/stock/count", { warehouseId: W1, counts: [] })).status).toBe(400);
  });

  it("reports levels per product (grams) and per variant (units) with low-stock flags, and respects scope", async () => {
    const pooled = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, pooled, 4999);
    const packaged = await f.packagedProduct("Salt");
    await f.packagedOffer(W1, packaged, [9, 3]);
    await f.pooledOffer(W2, pooled, 100000);
    const rows = (await f.get(`/admin/stock/levels?warehouseId=${W1}`)).body.data;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Tomato", unit: "grams", stock: 4999, lowStockThreshold: 5000, isLow: true, variantId: null }),
      expect.objectContaining({ name: "Salt", unit: "units", variantLabel: "1 kg", stock: 3, lowStockThreshold: 5, isLow: true }),
      expect.objectContaining({ name: "Salt", unit: "units", variantLabel: "500 g", stock: 9, isLow: false }),
    ]));
    const low = (await f.get(`/admin/stock/levels?warehouseId=${W1}&lowStock=true`)).body.data;
    expect(low.every((r: { isLow: boolean }) => r.isLow)).toBe(true);
    expect(low).toHaveLength(2);
    expect((await f.get("/admin/stock/levels", scoped(W1))).body.data.every((r: { warehouseId: string }) => r.warehouseId === W1)).toBe(true);
    expect((await f.get(`/admin/stock/levels?warehouseId=${W2}`, scoped(W1))).status).toBe(403);
    expect((await f.get("/admin/stock/levels")).body.data.some((r: { warehouseId: string }) => r.warehouseId === W2)).toBe(true);
  });

  it("pages through movements newest first and filters price history", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 1000);
    for (const delta of [10, 20, 30]) await f.send("post", "/admin/stock/adjust", { warehouseId: W3, productId: p.id, delta, reason: "purchase" });
    const first = await f.get("/admin/stock/movements?warehouseId=" + W3 + "&limit=2");
    expect(first.body.data.map((m: { delta: number }) => m.delta)).toEqual([30, 20]);
    const second = await f.get(`/admin/stock/movements?warehouseId=${W3}&limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
    expect(second.body.data.map((m: { delta: number }) => m.delta)).toEqual([10, 1000]);
    expect((await f.get("/admin/stock/movements?from=garbage")).status).toBe(400);
    await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, variants: [{ variantId: p.v500, price: 3300 }] });
    const history = await f.get(`/admin/price-history?warehouseId=${W3}&variantId=${p.v500}`);
    expect(history.body.data.map((r: { newPrice: number }) => r.newPrice)).toEqual([3300, 3200]);
    expect(history.body.data[0]).toMatchObject({ oldPrice: 3200, oldMrp: 4000, newMrp: 4000, at: expect.any(String) });
    expect((await f.get("/admin/price-history", viewer)).status).toBe(200);
  });
});

describe("working with the catalog module", () => {
  it("refuses to change a product's type or a variant's weight once a warehouse sells it", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 1000);
    const type = await f.send("put", `/admin/products/${p.id}`, { type: "packaged", stockMode: "per_variant" });
    expect(type.status).toBe(409);
    expect(type.body.error.details).toEqual({ reason: "has_offerings" });
    expect((await f.send("put", `/admin/products/${p.id}/variants/${p.v250}`, { weightGrams: 300 })).status).toBe(409);
  });

  it("gives offerings a new revision when the catalog changes so clients pick it up", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W1, p, 1000);
    await f.send("post", `/admin/products/${p.id}/archive`);
    const after = (await f.get(`/admin/warehouse-products/${o.id}`)).body.data;
    expect(after.rev).toBeGreaterThan(o.rev);
  });

  it("never hard-deletes a product that is offered, nor one when the orders check is missing", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 1000);
    expect((await f.send("delete", `/admin/products/${p.id}`)).status).toBe(409);
    const lonely = await f.pooledProduct();
    expect((await f.send("delete", `/admin/products/${lonely.id}`)).status).toBe(409);
  });
});
