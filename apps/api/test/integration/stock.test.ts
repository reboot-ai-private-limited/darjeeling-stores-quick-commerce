import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, W3, ZONE1, startFixture, type Fixture } from "./support/dev2-fixture.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("stock_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); });
beforeEach(async () => { await f.reset(); });

const stock = () => f.mods.stock;
const grams = async (offeringId: string): Promise<number> => (await f.get(`/admin/warehouse-products/${offeringId}`)).body.data.stockGrams;
const units = async (offeringId: string, index: number): Promise<number> => (await f.get(`/admin/warehouse-products/${offeringId}`)).body.data.variants[index].stock;
const count = (collection: string, filter: Record<string, unknown> = {}) => f.h.connection.collection(collection).countDocuments(filter);

describe("reserve", () => {
  it("deducts grams for pooled products and units for packaged ones in one reservation, with movements", async () => {
    const pooled = await f.pooledProduct();
    const po = await f.pooledOffer(W1, pooled, 10000);
    const packaged = await f.packagedProduct();
    const ko = await f.packagedOffer(W1, packaged, [10, 10]);
    const res = await stock().reserve({ key: "order-1", lines: [
      { warehouseId: W1, productId: pooled.id, variantId: pooled.v500, qty: 3 },
      { warehouseId: W1, productId: packaged.id, variantId: packaged.v2, qty: 4 },
    ] });
    expect(res).toMatchObject({ ok: true, replay: false, reservation: { key: "order-1", status: "held" } });
    expect(await grams(po.id)).toBe(8500);
    expect(await units(ko.id, 1)).toBe(6);
    expect(await units(ko.id, 0)).toBe(10);
    expect(await count("stock_movements", { reason: "order", orderKey: "order-1" })).toBe(2);
    expect(await count("stock_movements", { orderKey: "order-1", delta: -1500, mode: "grams" })).toBe(1);
  });

  it("is all-or-nothing: one short line leaves every line untouched and reports the shortages", async () => {
    const a = await f.pooledProduct();
    const b = await f.packagedProduct();
    const ao = await f.pooledOffer(W1, a, 10000);
    const bo = await f.packagedOffer(W1, b, [2, 2]);
    const res = await stock().reserve({ key: "order-2", lines: [
      { warehouseId: W1, productId: a.id, variantId: a.v500, qty: 2 },
      { warehouseId: W1, productId: b.id, variantId: b.v1, qty: 3 },
      { warehouseId: W3, productId: a.id, variantId: a.v500, qty: 1 },
    ] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.shortages).toEqual([
      expect.objectContaining({ productId: b.id, requested: 3, available: 2, reason: "insufficient" }),
      expect.objectContaining({ warehouseId: W3, reason: "not_offered" }),
    ]);
    expect(await grams(ao.id)).toBe(10000);
    expect(await units(bo.id, 0)).toBe(2);
    expect(await count("stock_reservations")).toBe(0);
    expect(await count("stock_movements", { reason: "order" })).toBe(0);
  });

  it("adds up repeated lines before checking stock", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [5, 5]);
    const line = { warehouseId: W1, productId: p.id, variantId: p.v1, qty: 3 };
    const res = await stock().reserve({ key: "order-3", lines: [line, line] });
    expect(res.ok).toBe(false);
    expect(await units(o.id, 0)).toBe(5);
    const fit = await stock().reserve({ key: "order-3b", lines: [line, { ...line, qty: 2 }] });
    expect(fit.ok).toBe(true);
    expect(await units(o.id, 0)).toBe(0);
  });

  it("is idempotent by key and refuses to reuse a released key", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [5, 5]);
    const input = { key: "order-4", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 2 }] };
    expect(await stock().reserve(input)).toMatchObject({ ok: true, replay: false });
    expect(await stock().reserve(input)).toMatchObject({ ok: true, replay: true });
    expect(await units(o.id, 0)).toBe(3);
    expect(await stock().release("order-4", "cancel")).toEqual({ released: true });
    await expect(stock().reserve(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await units(o.id, 0)).toBe(5);
  });

  it("refuses inactive offerings, inactive products and the out-of-stock override", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [5, 5]);
    const line = { warehouseId: W1, productId: p.id, variantId: p.v1, qty: 1 };
    await f.send("put", `/admin/warehouse-products/${o.id}`, { rev: o.rev, status: "inactive" });
    expect(await stock().reserve({ key: "k1", lines: [line] })).toMatchObject({ ok: false, shortages: [{ reason: "not_sellable" }] });
    const rev = (await f.get(`/admin/warehouse-products/${o.id}`)).body.data.rev;
    await f.send("put", `/admin/warehouse-products/${o.id}`, { rev, status: "active", isOutOfStockOverride: true });
    expect(await stock().reserve({ key: "k2", lines: [line] })).toMatchObject({ ok: false, shortages: [{ reason: "not_sellable" }] });
    expect(await units(o.id, 0)).toBe(5);
  });

  it("validates its input", async () => {
    const line = { warehouseId: W1, productId: "1".repeat(24), variantId: "2".repeat(24), qty: 1 };
    await expect(stock().reserve({ key: "", lines: [line] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(stock().reserve({ key: "x", lines: [] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(stock().reserve({ key: "x", lines: [{ ...line, qty: 0 }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(stock().reserve({ key: "x", lines: [{ ...line, qty: 1.5 }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("announces low stock when a reservation crosses the threshold, and back-in-stock when a release brings the zone's last stock back", async () => {
    const p = await f.pooledProduct();
    await f.pooledOffer(W1, p, 10000);
    f.events.length = 0;
    await stock().reserve({ key: "order-5", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v500, qty: 12 }] });
    expect(f.events).toEqual([expect.objectContaining({ type: "stock.low", warehouseId: W1, productId: p.id, stock: 4000, threshold: 5000 })]);
    await stock().reserve({ key: "order-6", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v500, qty: 8 }] });
    f.events.length = 0;
    await stock().release("order-6", "cancel");
    expect(f.events.filter(e => e.type === "stock.zone_availability_changed")).toHaveLength(2);
    expect(f.events.some(e => e.type === "stock.low")).toBe(false);
  });
});

describe("atomicity under concurrency", () => {
  it("never oversells: 12 parallel orders for 5 units succeed exactly 5 times", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [5, 5]);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      stock().reserve({ key: `race-${i}`, lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 1 }] })));
    expect(results.filter(r => r.ok)).toHaveLength(5);
    expect(results.filter(r => !r.ok)).toHaveLength(7);
    expect(await units(o.id, 0)).toBe(0);
    expect(await count("stock_reservations", { status: "held" })).toBe(5);
    expect(await count("stock_movements", { reason: "order" })).toBe(5);
  });

  it("never oversells pooled grams: 10 parallel orders of 500 g against 2.2 kg allow 4", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W1, p, 2200);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      stock().reserve({ key: `pool-${i}`, lines: [{ warehouseId: W1, productId: p.id, variantId: p.v500, qty: 1 }] })));
    expect(results.filter(r => r.ok)).toHaveLength(4);
    expect(await grams(o.id)).toBe(200);
  });

  it("deducts once when the same key arrives many times at once", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [10, 10]);
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      stock().reserve({ key: "same", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 4 }] })));
    expect(results.every(r => r.ok)).toBe(true);
    expect(results.filter(r => r.ok && !r.replay)).toHaveLength(1);
    expect(await units(o.id, 0)).toBe(6);
    expect(await count("stock_reservations", { key: "same" })).toBe(1);
  });

  it("keeps two multi-line orders all-or-nothing when they compete for the same stock", async () => {
    const a = await f.packagedProduct();
    const b = await f.packagedProduct();
    const ao = await f.packagedOffer(W1, a, [3, 3]);
    const bo = await f.packagedOffer(W1, b, [3, 3]);
    const lines = (qty: number) => [
      { warehouseId: W1, productId: a.id, variantId: a.v1, qty },
      { warehouseId: W1, productId: b.id, variantId: b.v1, qty },
    ];
    const results = await Promise.all([stock().reserve({ key: "x1", lines: lines(2) }), stock().reserve({ key: "x2", lines: lines(2) })]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await units(ao.id, 0)).toBe(1);
    expect(await units(bo.id, 0)).toBe(1);
  });
});

describe("confirm, release and restore", () => {
  it("confirms a hold so it no longer expires, idempotently", async () => {
    const p = await f.packagedProduct();
    await f.packagedOffer(W1, p, [5, 5]);
    await stock().reserve({ key: "c1", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 1 }], holdSeconds: -1 });
    expect(await stock().confirm("c1")).toMatchObject({ status: "confirmed", expiresAt: null });
    expect(await stock().confirm("c1")).toMatchObject({ status: "confirmed" });
    expect(await stock().releaseExpiredHolds()).toBe(0);
    await expect(stock().confirm("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("releases everything not yet restored, once", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [10, 10]);
    await stock().reserve({ key: "r1", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 4 }] });
    await stock().restore({ key: "r1", restoreKey: "pack-1", reason: "cancel", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 1 }] });
    expect(await units(o.id, 0)).toBe(7);
    expect(await stock().release("r1", "cancel")).toEqual({ released: true });
    expect(await units(o.id, 0)).toBe(10);
    expect(await stock().release("r1", "cancel")).toEqual({ released: false });
    expect(await units(o.id, 0)).toBe(10);
    await expect(stock().confirm("r1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await stock().release("unknown", "cancel")).toEqual({ released: false });
  });

  it("restores part of a reservation once per restore key and rejects over-restoring", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W1, p, 10000);
    await stock().reserve({ key: "r2", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v500, qty: 4 }] });
    expect(await grams(o.id)).toBe(8000);
    const line = { warehouseId: W1, productId: p.id, variantId: p.v500, qty: 1 };
    expect(await stock().restore({ key: "r2", restoreKey: "return-1", reason: "return", lines: [line] })).toEqual({ applied: true });
    expect(await stock().restore({ key: "r2", restoreKey: "return-1", reason: "return", lines: [line] })).toEqual({ applied: false });
    expect(await grams(o.id)).toBe(8500);
    expect(await count("stock_movements", { restoreKey: "return-1" })).toBe(1);
    await expect(stock().restore({ key: "r2", restoreKey: "return-2", reason: "return", lines: [{ ...line, qty: 4 }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(stock().restore({ key: "r2", restoreKey: "return-3", reason: "return", lines: [{ ...line, warehouseId: W2 }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(stock().restore({ key: "nope", restoreKey: "return-4", reason: "return", lines: [line] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await grams(o.id)).toBe(8500);
  });

  it("applies one restore key only once when it arrives in parallel", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [10, 10]);
    await stock().reserve({ key: "r3", lines: [{ warehouseId: W1, productId: p.id, variantId: p.v1, qty: 5 }] });
    const line = { warehouseId: W1, productId: p.id, variantId: p.v1, qty: 2 };
    const results = await Promise.all(Array.from({ length: 6 }, () => stock().restore({ key: "r3", restoreKey: "dup", reason: "cancel", lines: [line] })));
    expect(results.filter(r => r.applied)).toHaveLength(1);
    expect(await units(o.id, 0)).toBe(7);
  });
});

describe("expired holds", () => {
  it("releases holds that were never confirmed and leaves live and confirmed ones alone", async () => {
    const p = await f.packagedProduct();
    const o = await f.packagedOffer(W1, p, [10, 10]);
    const line = { warehouseId: W1, productId: p.id, variantId: p.v1, qty: 2 };
    await stock().reserve({ key: "old", lines: [line], holdSeconds: -1 });
    await stock().reserve({ key: "old-confirmed", lines: [line], holdSeconds: -1 });
    await stock().confirm("old-confirmed");
    await stock().reserve({ key: "fresh", lines: [line] });
    expect(await units(o.id, 0)).toBe(4);
    expect(await stock().releaseExpiredHolds()).toBe(1);
    expect(await units(o.id, 0)).toBe(6);
    expect(await stock().releaseExpiredHolds()).toBe(0);
    expect(await count("stock_reservations", { key: "old", status: "released" })).toBe(1);
  });
});

describe("resolveLines (the catalog port)", () => {
  it("returns the zone price, the cheapest in-stock warehouse's availability and per-warehouse units", async () => {
    const p = await f.pooledProduct("Tomato");
    await f.pooledOffer(W1, p, 1000);
    await f.pooledOffer(W2, p, 5000);
    const [line] = await stock().resolveLines({ zoneId: ZONE1, lines: [{ productId: p.id, variantId: p.v500, qty: 2 }] });
    expect(line).toMatchObject({ name: "Tomato", variantLabel: "500 g", unitPrice: 3200, mrp: 4000, onSale: false, sellable: true, reason: null });
    expect(line!.warehouses).toEqual(expect.arrayContaining([{ warehouseId: W1, availableUnits: 2 }, { warehouseId: W2, availableUnits: 10 }]));
  });

  it("reports products not sold in the zone and sold-out products", async () => {
    const p = await f.pooledProduct();
    const o = await f.pooledOffer(W3, p, 400);
    const [elsewhere] = await stock().resolveLines({ zoneId: ZONE1, lines: [{ productId: p.id, variantId: p.v500, qty: 1 }] });
    expect(elsewhere).toMatchObject({ sellable: false, reason: "not_sold_in_zone", unitPrice: null });
    const zone2 = "2".repeat(24);
    const [soldOut] = await stock().resolveLines({ zoneId: zone2, lines: [{ productId: p.id, variantId: p.v500, qty: 1 }] });
    expect(soldOut).toMatchObject({ sellable: false, reason: "not_sellable", unitPrice: 3200 });
    expect(o.id).toBeTruthy();
    const [unknown] = await stock().resolveLines({ zoneId: ZONE1, lines: [{ productId: "9".repeat(24), variantId: "8".repeat(24), qty: 1 }] });
    expect(unknown).toMatchObject({ sellable: false, reason: "not_sold_in_zone" });
  });
});
