import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, W1, W2, ZONE1, admin, customer, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { LOC1 } from "./support/fake-geography.js";

/** An owner changes a setting in admin; the very next request behaves differently, with no restart and no code change. */
let f: Fixture;
beforeAll(async () => { f = await startFixture("settings_live_integration_test", { realOrders: true, liveSettings: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);

const A = customer(CUSTOMER_A);
const GLOBAL = { type: "global" };
const ZONE = { type: "zone", id: ZONE1 };
const set = (group: string, scope: { type: string; id?: string }, values: Record<string, unknown>) => f.send("put", `/admin/settings/${group}`, { scope, values });
const HOME = { label: "Home", line1: "Cedar Villa", localityId: LOC1, pincode: "734101", landmark: "Opposite the gate", contactName: "Asha Rai", contactPhone: "98765 43210", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18 };
let rev = 0;
beforeEach(async () => {
  await f.reset(); rev = 0;
  await f.h.connection.collection("zones").insertOne({ _id: new Types.ObjectId(ZONE1), name: "Darjeeling" });
  await f.h.connection.collection("warehouses").insertMany([W1, W2].map(id => ({ _id: new Types.ObjectId(id), zoneId: new Types.ObjectId(ZONE1), name: id })));
});

async function cart(qty: number) {
  const tomato = await f.pooledProduct("Fresh Tomato", "TOM-1");
  await f.pooledOffer(W1, tomato, 20_000);
  const address = (await f.send("post", "/addresses", HOME, A)).body.data.id as string;
  const put = await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: [{ productId: tomato.id, variantId: tomato.v500, qty }] }, A);
  return { tomato, put };
}
const quote = (body: Record<string, unknown> = {}) => f.send("post", "/quotes", { paymentMethod: "cod", ...body }, A);

describe("cart and quote follow the admin settings", () => {
  it("cash-on-delivery limit and minimum order", async () => {
    await cart(2);
    const first = await quote();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.payment.codMaxAmount).toBe(200_000);

    await set("payments", ZONE, { codMaxAmount: 100 });
    const blocked = await quote();
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toMatchObject({ code: "COD_NOT_ALLOWED", details: { codMaxAmount: 100 } });

    await set("payments", ZONE, { codMaxAmount: null });
    expect((await quote()).status).toBe(201);

    await set("orders", ZONE, { defaultMinOrder: 9_999_999 });
    expect((await quote()).body.error.code).toBe("MIN_ORDER_NOT_MET");
    await set("orders", ZONE, { defaultMinOrder: null });
    expect((await quote()).status).toBe(201);
  });

  it("largest quantity of one item, and packing time per warehouse", async () => {
    const { put } = await cart(5);
    expect(put.body.data.cart.items[0].qty).toBe(5);
    const line = put.body.data.cart.items[0];
    await set("orders", GLOBAL, { maxQtyPerItem: 2 });
    const again = await f.send("put", "/cart", { clientRev: ++rev, items: [{ productId: line.productId, variantId: line.variantId, qty: 5 }] }, A);
    expect(again.body.data.cart.items[0].qty).toBe(2);

    expect((await quote()).body.data.allocation[0].eta.packMinutes).toBe(5);
    await set("eta", GLOBAL, { packMinutes: 9 });
    expect((await quote()).body.data.allocation[0].eta.packMinutes).toBe(9);
    await set("eta", { type: "warehouse", id: W1 }, { packMinutes: 20 });
    expect((await quote()).body.data.allocation[0].eta.packMinutes).toBe(20);
  });
});

describe("pricing follows the admin settings", () => {
  it("rain-mode default surcharge and the surcharge cap", async () => {
    await set("discounts", ZONE, { rainSurchargeAmount: 2500, rainExtraMinutes: 20 });
    const on = await f.send("post", "/admin/ops/rain", { on: true, until: null, zoneIds: [ZONE1] });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const rule = (await f.get("/admin/delivery-rules?type=surcharge")).body.data[0];
    expect(rule).toMatchObject({ kind: "rain", amount: 2500, extraMinutes: 20 });

    const preview = () => f.send("post", "/admin/delivery-rules/preview", { zoneId: ZONE1, subtotal: 35_000 });
    const rainOf = (body: { data: { charges: { type: string; amount: number }[] } }) => body.data.charges.find(c => c.type === "surcharge_rain")?.amount;
    expect(rainOf((await preview()).body)).toBe(2500);
    expect((await set("discounts", ZONE, { surchargeCap: 1000, rainSurchargeAmount: 500 })).status).toBe(200);
    const capped = (await preview()).body.data;
    expect(capped.surchargeCapApplied).toBe(true);
    expect(rainOf({ data: capped })).toBe(1000);
    expect((await set("discounts", ZONE, { surchargeCap: 0 })).status).toBe(200);
    const uncapped = (await preview()).body.data;
    expect(uncapped.surchargeCapApplied).toBe(false);
    expect(rainOf({ data: uncapped })).toBe(2500);
  });
});

describe("stock follows the admin settings", () => {
  it("low-stock level, per warehouse", async () => {
    const p = await f.pooledProduct("Tomato", "TOM-2");
    await f.pooledOffer(W1, p, 7_000);
    const level = async () => (await f.get(`/admin/stock/levels?warehouseId=${W1}`)).body.data.find((r: { name: string }) => r.name === "Tomato");
    expect(await level()).toMatchObject({ stock: 7000, lowStockThreshold: 5000, isLow: false });
    await set("stock", GLOBAL, { lowStockGrams: 8_000 });
    expect(await level()).toMatchObject({ lowStockThreshold: 8000, isLow: true });
    await set("stock", { type: "warehouse", id: W1 }, { lowStockGrams: 1_000 });
    expect(await level()).toMatchObject({ lowStockThreshold: 1000, isLow: false });
  });

  it("the same-zone price rule can be switched between block and warn", async () => {
    const p = await f.pooledProduct("Tomato", "TOM-3");
    await f.pooledOffer(W1, p, 10_000);
    const other = () => f.send("post", "/admin/warehouse-products", { warehouseId: W2, productId: p.id, stockGrams: 5000, variants: [{ variantId: p.v500, price: 3300, mrp: 4000 }] });
    expect((await other()).body.error.code).toBe("PRICE_CONFLICT");
    expect((await set("stock", GLOBAL, { zonePriceConflictMode: "warn" })).status).toBe(200);
    expect((await other()).status).toBe(201);
  });
});

describe("hours and pre-orders follow the admin settings", () => {
  it("fills what the admin leaves out from the settings, and keeps what the admin states", async () => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const plain = { hours: [{ days, open: "07:00", close: "20:00" }] };
    const first = await f.send("put", `/admin/warehouses/${W1}/hours`, plain);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toMatchObject({ lastOrderMinutesBeforeClose: 15, afterHoursMode: "closed" });

    await set("hours", GLOBAL, { lastOrderMinutesBeforeClose: 30, afterHoursMode: "pre_order" });
    await set("preOrder", GLOBAL, { cutoffMinutesBeforeSlot: 90, packLeadMinutes: 60 });
    const second = await f.send("put", `/admin/warehouses/${W2}/hours`, plain);
    expect(second.body.data).toMatchObject({ lastOrderMinutesBeforeClose: 30, afterHoursMode: "pre_order" });
    const slot = { start: "07:00", end: "09:00", capacity: 3 };
    const slots = await f.send("put", `/admin/warehouses/${W2}/preorder`, { enabled: true, slots: [slot] });
    expect(slots.body.data.preOrder).toMatchObject({ cutoffMinutesBeforeSlot: 90, packLeadMinutes: 60 });
    const explicit = await f.send("put", `/admin/warehouses/${W2}/preorder`, { enabled: true, slots: [slot], cutoffMinutesBeforeSlot: 10, packLeadMinutes: 5 });
    expect(explicit.body.data.preOrder).toMatchObject({ cutoffMinutesBeforeSlot: 10, packLeadMinutes: 5 });
  });
});

it("only staff with the right login can change settings", async () => {
  expect((await f.send("put", "/admin/settings/eta", { scope: GLOBAL, values: { packMinutes: 7 } }, A)).status).toBe(401);
  expect((await f.get("/admin/settings/registry", admin)).status).toBe(200);
});
