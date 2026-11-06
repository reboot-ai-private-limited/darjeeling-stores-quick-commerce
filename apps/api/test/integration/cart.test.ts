import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, CUSTOMER_B, W1, W2, W3, ZONE1, ZONE2, admin, customer, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { LOC1, LOC2 } from "./support/fake-geography.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("cart_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); rev = 0; });

const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const col = (name: string) => f.h.connection.collection(name);
const HOME = { label: "Home", line1: "Cedar Villa, 2nd floor", localityId: LOC1, pincode: "734101", landmark: "Opposite Planters Club gate", contactName: "Asha Rai", contactPhone: "98765 43210", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18 };
const GHOOM = { ...HOME, label: "Work", localityId: LOC2, location: { lat: 27.25, lng: 88.25 } };
const OUTSIDE = { ...HOME, label: "Other", location: { lat: 28.5, lng: 88.25 } };
let rev = 0;
const address = async (body: Record<string, unknown> = HOME, who = A) => (await f.send("post", "/addresses", body, who)).body.data.id as string;
const putCart = (items: unknown[], extra: Record<string, unknown> = {}, who = A) => f.send("put", "/cart", { clientRev: ++rev, items, ...extra }, who);
const line = (productId: string, variantId: string, qty: number) => ({ productId, variantId, qty });
const quote = (body: Record<string, unknown> = {}, who = A) => f.send("post", "/quotes", { paymentMethod: "cod", ...body }, who);
const feeRule = (over: Record<string, unknown> = {}) => f.send("post", "/admin/delivery-rules", {
  type: "delivery_fee", zoneIds: [ZONE1], minOrder: 0, tiers: [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: 59999, fee: 2000 }, { from: 60000, to: null, fee: 0 }], ...over,
});

/** Tomatoes at the Chowrasta store and milk at the Mall Road store, in zone 1; nothing in zone 2. */
async function shelves() {
  const tomato = await f.pooledProduct("Fresh Tomato", "TOM-1");
  const milk = await f.packagedProduct("Fresh Milk", "MLK-1");
  await f.pooledOffer(W1, tomato, 20_000);
  await f.packagedOffer(W2, milk, [30, 30]);
  return { tomato, milk };
}

describe("the server cart", () => {
  it("prices every line live and shows the free-delivery bar", async () => {
    const { tomato, milk } = await shelves();
    await feeRule();
    const res = await putCart([line(tomato.id, tomato.v500, 2), line(milk.id, milk.v1, 1)], { addressId: await address() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.corrections).toEqual([]);
    expect(res.body.data.zoneChange).toBeNull();
    expect(res.body.data.cart).toEqual({
      zoneId: ZONE1, addressId: expect.any(String), couponCode: null, clientRev: 1, itemsSubtotal: 11400,
      items: [
        { productId: tomato.id, variantId: tomato.v500, qty: 2, name: "Fresh Tomato", variantLabel: expect.any(String), unitPrice: 3200, lineTotal: 6400, maxQty: 10, available: true, imageUrl: null },
        { productId: milk.id, variantId: milk.v1, qty: 1, name: "Fresh Milk", variantLabel: expect.any(String), unitPrice: 5000, lineTotal: 5000, maxQty: 10, available: true, imageUrl: null },
      ],
      freeDelivery: { threshold: 60000, remaining: 48600 },
    });
    expect((await f.get("/cart", A)).body.data.cart).toEqual(res.body.data.cart);
  });

  it("is empty for a customer with no cart, and private to each customer", async () => {
    const { tomato } = await shelves();
    expect((await f.get("/cart", A)).body.data).toEqual({ cart: { zoneId: null, addressId: null, couponCode: null, clientRev: 0, items: [], itemsSubtotal: 0, freeDelivery: null }, corrections: [], zoneChange: null });
    await putCart([line(tomato.id, tomato.v250, 1)], { addressId: await address() });
    expect((await f.get("/cart", B)).body.data.cart.items).toEqual([]);
  });

  it("needs a place to price the cart: an address, or a zone", async () => {
    const { tomato } = await shelves();
    expect((await putCart([line(tomato.id, tomato.v250, 1)])).status).toBe(400);
    const byZone = await putCart([line(tomato.id, tomato.v250, 1)], { zoneId: ZONE1 });
    expect(byZone.status, JSON.stringify(byZone.body)).toBe(200);
    expect(byZone.body.data.cart.itemsSubtotal).toBe(1800);
    expect((await putCart([], { zoneId: "9".repeat(24) })).status).toBe(400);
    expect((await putCart([], { addressId: "9".repeat(24) })).status).toBe(404);
    const far = await putCart([], { addressId: await address(OUTSIDE) });
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe("OUT_OF_ZONE");
  });

  it("trims what the server cannot supply and says why", async () => {
    const { tomato, milk } = await shelves();
    const other = await f.pooledProduct("Local Cabbage", "CAB-1");
    const res = await putCart([line(tomato.id, tomato.v500, 50), line(milk.id, milk.v2, 40), line(other.id, other.v250, 1)], { addressId: await address() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.corrections).toEqual(expect.arrayContaining([
      { productId: tomato.id, variantId: tomato.v500, reason: "max_qty", qty: 10 },
      { productId: milk.id, variantId: milk.v2, reason: "max_qty", qty: 10 },
      { productId: other.id, variantId: other.v250, reason: "not_sold_in_zone", qty: 0 },
    ]));
    expect(res.body.data.cart.items.map((i: { qty: number }) => i.qty)).toEqual([10, 10]);
  });

  it("limits a line to what is in stock", async () => {
    const tomato = await f.pooledProduct("Fresh Tomato", "TOM-1");
    await f.pooledOffer(W1, tomato, 1500);
    const res = await putCart([line(tomato.id, tomato.v500, 5)], { addressId: await address() });
    expect(res.body.data.corrections).toEqual([{ productId: tomato.id, variantId: tomato.v500, reason: "out_of_stock", qty: 3 }]);
    expect(res.body.data.cart.items[0].qty).toBe(3);
    await f.pooledOffer(W2, tomato, 0).catch(() => undefined);
  });

  it("merges repeated lines and refuses more than 40 different items", async () => {
    const { tomato } = await shelves();
    const res = await putCart([line(tomato.id, tomato.v250, 2), line(tomato.id, tomato.v250, 3)], { addressId: await address() });
    expect(res.body.data.cart.items).toHaveLength(1);
    expect(res.body.data.cart.items[0].qty).toBe(5);
    const many = Array.from({ length: 41 }, (_, i) => line(String(i + 1).padStart(24, "0"), tomato.v250, 1));
    expect((await putCart(many)).status).toBe(400);
  });

  it("ignores an older copy from a slow phone", async () => {
    const { tomato } = await shelves();
    const addr = await address();
    await f.send("put", "/cart", { clientRev: 5, addressId: addr, items: [line(tomato.id, tomato.v250, 3)] }, A);
    const old = await f.send("put", "/cart", { clientRev: 4, items: [line(tomato.id, tomato.v250, 1)] }, A);
    expect(old.status).toBe(200);
    expect(old.body.data.cart.items[0].qty).toBe(3);
    expect(old.body.data.cart.clientRev).toBe(5);
    expect(old.body.data).not.toHaveProperty("stale");
  });

  it("checks the request and the login", async () => {
    expect((await f.send("put", "/cart", { items: [] }, A)).status).toBe(400);
    expect((await f.send("put", "/cart", { clientRev: 1, items: [{ productId: "x", variantId: "y", qty: 1 }] }, A)).status).toBe(400);
    expect((await f.send("put", "/cart", { clientRev: 1, items: [{ productId: "1".repeat(24), variantId: "2".repeat(24), qty: 0 }] }, A)).status).toBe(400);
    expect((await f.get("/cart", {})).status).toBe(401);
    expect((await f.send("put", "/cart", { clientRev: 1, items: [] }, {})).status).toBe(401);
    expect((await f.send("post", "/quotes", {}, {})).status).toBe(401);
    expect((await f.get(`/quotes/${"9".repeat(24)}`, {})).status).toBe(401);
  });

  it("re-prices for a new address in another zone and asks the customer to confirm before a quote", async () => {
    const { tomato, milk } = await shelves();
    const cabbage = await f.pooledProduct("Ghoom Cabbage", "GCB-1");
    await f.pooledOffer(W3, cabbage, 5000);
    await f.pooledOffer(W3, tomato, 5000, { v500: 3400, v250: 1900 });
    const home = await address();
    const work = await address(GHOOM);
    await putCart([line(tomato.id, tomato.v500, 2), line(milk.id, milk.v1, 1)], { addressId: home });
    const moved = await putCart([line(tomato.id, tomato.v500, 2), line(milk.id, milk.v1, 1)], { addressId: work });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data.zoneChange).toEqual({
      fromZoneId: ZONE1, toZoneId: ZONE2,
      removed: [{ productId: milk.id, variantId: milk.v1, name: "Fresh Milk", reason: "not_sold_in_zone" }],
      repriced: [{ productId: tomato.id, variantId: tomato.v500, oldUnitPrice: 3200, newUnitPrice: 3400 }],
    });
    expect(moved.body.data.cart).toMatchObject({ zoneId: ZONE2, itemsSubtotal: 6800 });
    expect(moved.body.data.cart.items).toHaveLength(1);
    expect((await f.get("/cart", A)).body.data.zoneChange).toEqual(moved.body.data.zoneChange);

    const refused = await quote({ addressId: work });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "ZONE_CHANGE_UNCONFIRMED", details: { zoneChange: { toZoneId: ZONE2 } } });
    const accepted = await quote({ addressId: work, acceptZoneChange: true });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect((await f.get("/cart", A)).body.data.zoneChange).toBeNull();
    expect((await quote({ addressId: work })).status).toBe(201);
  });
});

describe("coupons on the cart", () => {
  const coupon = (body: Record<string, unknown>) => f.send("post", "/admin/coupons", { code: "SAVE5", type: "flat", value: 500, minOrder: 0, ...body });

  it("applies and removes a coupon", async () => {
    const { tomato } = await shelves();
    await coupon({ code: "SAVE5", description: "₹5 off" });
    await putCart([line(tomato.id, tomato.v500, 2)], { addressId: await address() });
    const res = await f.send("post", "/cart/coupon", { code: "save5" }, A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.coupon).toEqual({ code: "SAVE5", type: "flat", description: "₹5 off" });
    expect(res.body.data.cart.couponCode).toBe("SAVE5");
    expect((await f.get("/cart", A)).body.data.cart.couponCode).toBe("SAVE5");
    const gone = await f.send("delete", "/cart/coupon", undefined, A);
    expect(gone.body.data.cart.couponCode).toBeNull();
  });

  it("refuses a coupon that does not fit, with the reason", async () => {
    const { tomato } = await shelves();
    await coupon({ code: "BIGONLY", minOrder: 90000 });
    await putCart([line(tomato.id, tomato.v500, 1)], { addressId: await address() });
    const low = await f.send("post", "/cart/coupon", { code: "BIGONLY" }, A);
    expect(low.status).toBe(422);
    expect(low.body.error).toMatchObject({ code: "COUPON_INVALID", details: { reason: "min_order" } });
    expect((await f.send("post", "/cart/coupon", { code: "NOSUCH" }, A)).body.error.details.reason).toBe("not_applicable");
    expect((await f.send("post", "/cart/coupon", {}, A)).status).toBe(400);
    expect((await f.send("post", "/cart/coupon", { code: "X" }, B)).status).toBe(400);
  });
});

describe("quotes", () => {
  async function ready(items: (s: Awaited<ReturnType<typeof shelves>>) => unknown[]) {
    const s = await shelves();
    const addr = await address();
    await putCart(items(s), { addressId: addr });
    return { ...s, addr };
  }

  it("locks one bill and one delivery for a cart one warehouse can supply", async () => {
    await feeRule();
    const { tomato } = await ready(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const res = await quote();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const q = res.body.data;
    expect(q).toMatchObject({ zoneId: ZONE1, split: false, payment: { codAllowed: true, codMaxAmount: 200000, onlineAllowed: true }, scheduledWindow: null });
    expect(q.allocation).toEqual([{
      warehouseId: W1, warehouseName: "Chowrasta store",
      lines: [{ productId: tomato.id, variantId: tomato.v500, name: "Fresh Tomato", variantLabel: expect.any(String), qty: 2, unitPrice: 3200, lineTotal: 6400 }],
      itemsSubtotal: 6400, eta: { packMinutes: 5, riderArrivalMinutes: 5, travelMinutes: expect.any(Number), extraMinutes: 0, promisedAt: expect.stringMatching(/Z$/) },
    }]);
    expect(q.pricing).toEqual({ subtotal: 6400, discount: 0, charges: [{ type: "delivery_fee", label: "Delivery fee", amount: 4000 }], tax: 0, total: 10400, taxInclusive: true });
    const minutes = q.allocation[0].eta;
    expect(new Date(minutes.promisedAt).getTime() - Date.now()).toBeGreaterThan((minutes.packMinutes + minutes.riderArrivalMinutes) * 60_000 - 5000);
    expect(new Date(q.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect((await f.get(`/quotes/${q.id}`, A)).body.data).toEqual(q);
    expect((await f.get(`/quotes/${q.id}`, B)).status).toBe(404);
  });

  it("splits a cart across two warehouses with one fee, and shares the bill between the deliveries", async () => {
    await feeRule();
    await ready(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)]);
    const q = (await quote()).body.data;
    expect(q.split).toBe(true);
    expect(q.allocation.map((d: { warehouseId: string }) => d.warehouseId).sort()).toEqual([W1, W2]);
    expect(q.pricing.charges).toEqual([{ type: "delivery_fee", label: "Delivery fee", amount: 4000 }]);
    expect(q.pricing).toMatchObject({ subtotal: 11400, total: 15400 });
    const stored = await col("quotes").findOne({ _id: q.id as never });
    const deliveries = stored!.allocation as { itemsSubtotal: number; allocatedDiscount: number; allocatedCharges: { amount: number }[] }[];
    expect(deliveries.map(d => d.itemsSubtotal).reduce((a, b) => a + b, 0)).toBe(11400);
    expect(deliveries.map(d => d.allocatedCharges[0]!.amount).reduce((a, b) => a + b, 0)).toBe(4000);
  });

  it("applies a coupon: money off the items, or free delivery", async () => {
    await feeRule();
    await f.send("post", "/admin/coupons", { code: "TEN", type: "percent", value: 10, minOrder: 0 });
    await f.send("post", "/admin/coupons", { code: "FREEDEL", type: "free_delivery", minOrder: 0 });
    await ready(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const ten = (await quote({ couponCode: "ten" })).body.data.pricing;
    expect(ten).toMatchObject({ subtotal: 6400, discount: 640, total: 6400 - 640 + 4000 });
    const free = (await quote({ couponCode: "FREEDEL" })).body.data.pricing;
    expect(free).toMatchObject({ discount: 0, charges: [], total: 6400 });
    const bad = await quote({ couponCode: "NOPE" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("COUPON_INVALID");
  });

  it("uses the coupon already on the cart unless told otherwise", async () => {
    await f.send("post", "/admin/coupons", { code: "FIVE", type: "flat", value: 500, minOrder: 0 });
    await ready(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    await f.send("post", "/cart/coupon", { code: "FIVE" }, A);
    expect((await quote()).body.data.pricing.discount).toBe(500);
    expect((await quote({ couponCode: null })).body.data.pricing.discount).toBe(0);
  });

  it("adds a rain surcharge and the extra minutes", async () => {
    await feeRule();
    await f.send("post", "/admin/ops/rain", { on: true, zoneIds: [ZONE1] });
    await ready(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = (await quote()).body.data;
    expect(q.pricing.charges.map((c: { type: string }) => c.type)).toEqual(["delivery_fee", "surcharge_rain"]);
    expect(q.allocation[0].eta.extraMinutes).toBe(10);
    expect(q.pricing.total).toBe(6400 + 4000 + 1500);
  });

  it("refuses a cart below the zone minimum", async () => {
    await feeRule({ minOrder: 20000 });
    await ready(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const res = await quote();
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "MIN_ORDER_NOT_MET", details: { minOrder: 20000 } });
  });

  it("refuses cash on delivery above the cap but still allows online", async () => {
    await feeRule();
    await ready(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const mods = (await import("../../src/composition/dev2.js")).createDev2Modules({
      connection: f.h.connection, geography: f.geo.geography, customer: (await import("./support/harness.js")).customerFromHeader, cartSettings: { codMaxAmount: 5000 },
    });
    const addrCart = await f.mods.cart.cart.get(CUSTOMER_A);
    expect(addrCart.cart.items).toHaveLength(1);
    const cod = await mods.cart.quotes.build(CUSTOMER_A, { paymentMethod: "cod", acceptZoneChange: false }).catch(e => e);
    expect(cod).toMatchObject({ code: "COD_NOT_ALLOWED", details: { codMaxAmount: 5000 } });
    const online = await mods.cart.quotes.build(CUSTOMER_A, { paymentMethod: "online", acceptZoneChange: false });
    expect(online.payment).toMatchObject({ codAllowed: false, onlineAllowed: true });
  });

  it("will not quote when the store is closed, the zone is paused or the customer is outside", async () => {
    const { addr } = await ready(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    f.geo.closeWarehouse(W1); f.geo.closeWarehouse(W2);
    const closed = await quote();
    expect(closed.status).toBe(409);
    expect(closed.body.error).toMatchObject({ code: "STORE_CLOSED", details: { preOrderAvailable: false } });
    f.geo.openWarehouse(W1); f.geo.openWarehouse(W2);
    f.geo.pauseZone(ZONE1);
    expect((await quote()).body.error.code).toBe("ZONE_PAUSED");
    f.geo.reset();
    const far = await address(OUTSIDE);
    expect((await quote({ addressId: far })).body.error.code).toBe("OUT_OF_ZONE");
    expect((await quote({ addressId: "9".repeat(24) })).status).toBe(404);
    expect((await quote({ addressId: addr })).status).toBe(201);
  });

  it("lists lines nobody can supply, or that cannot be supplied together", async () => {
    const { tomato, milk, addr } = await ready(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)]);
    f.geo.closeWarehouse(W2);
    const missing = await quote();
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatchObject({ code: "ITEM_UNAVAILABLE", details: { lines: [expect.objectContaining({ productId: milk.id, reason: "cannot_be_supplied_together" })] } });
    f.geo.openWarehouse(W2);
    // After it has been put in the cart, the product is withdrawn from the zone.
    await f.send("put", `/admin/warehouses/${W2}/products/${milk.id}`, { status: "inactive" }, admin).catch(() => undefined);
    await col("warehouse_products").updateMany({ productId: milk.id }, { $set: { status: "inactive" } });
    const gone = await quote();
    expect(gone.status).toBe(409);
    expect(gone.body.error.details.lines[0]).toMatchObject({ productId: milk.id });
    expect(tomato.id).toBeTruthy(); expect(addr).toBeTruthy();
  });

  it("refuses to split into more deliveries than allowed", async () => {
    const s = await shelves();
    const third = await f.pooledProduct("Local Cabbage", "CAB-1");
    await f.pooledOffer(W1, third, 0);
    await f.pooledOffer(W2, third, 5000);
    await putCart([line(s.tomato.id, s.tomato.v500, 1), line(s.milk.id, s.milk.v1, 1), line(third.id, third.v250, 1)], { addressId: await address() });
    const q = await quote();
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    const mods = (await import("../../src/composition/dev2.js")).createDev2Modules({ connection: f.h.connection, geography: f.geo.geography, cartSettings: { maxSplitsPerOrder: 1 } });
    const one = await mods.cart.quotes.build(CUSTOMER_A, { paymentMethod: "cod", acceptZoneChange: false }).catch(e => e);
    expect(one).toMatchObject({ code: "ITEM_UNAVAILABLE", details: { lines: expect.any(Array) } });
  });

  it("refuses an empty cart and an expired quote", async () => {
    expect((await quote()).status).toBe(400);
    await ready(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const q = (await quote()).body.data;
    await col("quotes").updateOne({ _id: q.id as never }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await f.get(`/quotes/${q.id}`, A);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe("QUOTE_EXPIRED");
    expect((await f.get(`/quotes/${"9".repeat(24)}`, A)).status).toBe(404);
    expect((await quote({ paymentMethod: "cheque" })).status).toBe(400);
    expect((await quote({ scheduledWindow: { start: "2026-11-06T09:00:00Z", end: "2026-11-06T07:00:00Z" } })).status).toBe(400);
  });
});
