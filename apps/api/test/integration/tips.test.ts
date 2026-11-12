import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, W1, W2, ZONE1, admin, customer, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { LOC1 } from "./support/fake-geography.js";
import { Types } from "mongoose";

/** Rider tips (F10, F19, F22): added at checkout, shared over deliveries, owed to the rider who delivers, refunded with a cancelled order. */
let f: Fixture;
beforeAll(async () => { f = await startFixture("tips_integration_test", { realOrders: true, realMoney: true, liveSettings: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => {
  await f.reset(); rev = 0; shelf = null;
  f.msg.person(CUSTOMER_A, "+919876543210", ["tok-customer-a"]);
  await f.h.connection.collection("zones").insertOne({ _id: new Types.ObjectId(ZONE1), name: "Darjeeling" });
  await f.h.connection.collection("warehouses").insertMany([W1, W2].map(id => ({ _id: new Types.ObjectId(id), zoneId: new Types.ObjectId(ZONE1), name: id })));
});

const { onShift, as, toDoor } = deliveryHelpers(() => f);
const A = customer(CUSTOMER_A);
const col = (name: string) => f.h.connection.collection(name);
const GLOBAL = { type: "global" };
const ZONE = { type: "zone", id: ZONE1 };
const setting = (values: Record<string, unknown>, scope: { type: string; id?: string } = ZONE) => f.send("put", "/admin/settings/delivery", { scope, values });
const HOME = { label: "Home", line1: "Cedar Villa", localityId: LOC1, pincode: "734101", landmark: "Opposite the gate", contactName: "Asha Rai", contactPhone: "98765 43210", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18 };
let rev = 0;
type Shelves = { tomato: Awaited<ReturnType<Fixture["pooledProduct"]>>; milk: Awaited<ReturnType<Fixture["packagedProduct"]>> };
let shelf: Shelves | null = null;
async function shelves(): Promise<Shelves> {
  if (shelf) return shelf;
  const tomato = await f.pooledProduct("Fresh Tomato", "TOM-1");
  const milk = await f.packagedProduct("Fresh Milk", "MLK-1");
  await f.pooledOffer(W1, tomato, 20_000);
  await f.packagedOffer(W2, milk, [30, 30]);
  return (shelf = { tomato, milk });
}
const line = (productId: string, variantId: string, qty: number) => ({ productId, variantId, qty });
const tomatoes = (qty: number) => (s: Shelves) => [line(s.tomato.id, s.tomato.v500, qty)];
const both = (s: Shelves) => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)];
const feeRule = () => f.send("post", "/admin/delivery-rules", { type: "delivery_fee", zoneIds: [ZONE1], minOrder: 0, tiers: [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: null, fee: 0 }] });

async function cartFor(items: (s: Shelves) => unknown[]) {
  const s = await shelves();
  const address = (await f.send("post", "/addresses", HOME, A)).body.data.id as string;
  await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: items(s) }, A);
}
const quote = (body: Record<string, unknown> = {}) => f.send("post", "/quotes", { paymentMethod: "cod", ...body }, A);
const col2 = (rows: { type: string; amount: number }[]) => rows.filter(c => c.type === "tip").reduce((s, c) => s + c.amount, 0);

/** Places an order with a tip. A prepaid one is marked paid directly, since the payments module is separate. */
async function order(items: (s: Shelves) => unknown[], tipAmount: number, method: "cod" | "online" = "cod") {
  await cartFor(items);
  const q = await quote({ paymentMethod: method, tipAmount });
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  const res = await f.send("post", "/orders", { quoteId: q.body.data.id, paymentMethod: method }, { ...A, "Idempotency-Key": randomUUID() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const group = res.body.data.group;
  const ids = group.children.map((c: { id: string }) => c.id) as string[];
  if (method === "online") {
    for (const id of ids) {
      const row = (await col("orders").findOne({ _id: id as never }))!;
      const paid = row.itemsSubtotal - row.allocatedDiscount + row.allocatedCharges.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0);
      await col("orders").updateOne({ _id: id as never }, { $set: { status: "CONFIRMED", paymentStatus: "paid", paidAmount: paid } });
    }
    await col("order_groups").updateOne({ _id: group.id as never }, { $set: { paymentStatus: "paid" } });
  }
  return { group, id: ids[0]!, ids, quote: q.body.data };
}
/** Takes a cash order all the way to delivered by one rider. */
async function delivered(tip: number, rider?: Awaited<ReturnType<typeof onShift>>) {
  const o = await order(tomatoes(2), tip);
  const r = rider ?? (await onShift());
  await f.send("post", `/admin/orders/${o.id}/start-packing`);
  await f.send("post", `/admin/orders/${o.id}/complete-packing`);
  await f.send("post", `/admin/orders/${o.id}/assign`, { riderId: r.id });
  await toDoor(r, o.id);
  const code = (await f.get(`/order-groups/${o.group.id}`, A)).body.data.deliveryOtp as string;
  const row = (await col("orders").findOne({ _id: o.id as never }))!;
  expect((await as(r, "post", `/rider/orders/${o.id}/collect-cash`, { amount: row.amountDue })).status).toBe(200);
  expect((await as(r, "post", `/rider/orders/${o.id}/deliver`, { otp: code })).status).toBe(200);
  return { ...o, rider: r };
}

describe("tip options and the quote", () => {
  it("offers quick amounts and a limit from the settings", async () => {
    const res = await f.get(`/tips/options?zoneId=${ZONE1}`, {});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: true, presets: [1000, 2000, 5000], max: 20000 });
    expect((await f.get("/tips/options", {})).status).toBe(400);
    expect((await f.get(`/tips/options?zoneId=${"e".repeat(24)}`, {})).status).toBe(404);
    expect((await setting({ tipPreset1: 500, tipPreset2: 1500, tipPreset3: 3000, tipMaxAmount: 10000 })).status).toBe(200);
    expect((await f.get(`/tips/options?zoneId=${ZONE1}`, {})).body.data).toEqual({ enabled: true, presets: [500, 1500, 3000], max: 10000 });
    expect((await setting({ tipsEnabled: false })).status).toBe(200);
    expect((await f.get(`/tips/options?zoneId=${ZONE1}`, {})).body.data.enabled).toBe(false);
  });

  it("refuses a preset above the largest tip when the owner saves the settings", async () => {
    const bad = await setting({ tipMaxAmount: 1500 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual(expect.arrayContaining([{ key: "tipPreset2", message: "Cannot be more than the largest tip" }]));
  });

  it("adds the tip to the bill as its own line, outside the fee rules", async () => {
    await feeRule();
    await cartFor(tomatoes(2));
    const plain = (await quote()).body.data;
    const tipped = (await quote({ tipAmount: 2000 })).body.data;
    expect(tipped.pricing.charges).toEqual([...plain.pricing.charges, { type: "tip", label: "Rider tip", amount: 2000 }]);
    expect(tipped.pricing.total).toBe(plain.pricing.total + 2000);
    // Free delivery does not waive it.
    await cartFor(tomatoes(10));
    const free = (await quote({ tipAmount: 1000 })).body.data;
    expect(free.pricing.charges.map((c: { type: string }) => c.type)).toEqual(["tip"]);
    expect((await quote({ tipAmount: 0 })).body.data.pricing.charges).toEqual([]);
  });

  it("refuses a tip that is too large, fractional, negative or switched off", async () => {
    await cartFor(tomatoes(2));
    const tooBig = await quote({ tipAmount: 20001 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "tipAmount", max: 20000 } });
    expect((await quote({ tipAmount: 10.5 })).status).toBe(400);
    expect((await quote({ tipAmount: -1 })).status).toBe(400);
    await setting({ tipsEnabled: false });
    const off = await quote({ tipAmount: 1000 });
    expect(off.status).toBe(400);
    expect(off.body.error.message).toMatch(/not available/);
    expect((await quote()).status).toBe(201);
  });

  it("keeps the tip when the quote is checked again at placing time", async () => {
    const o = await order(tomatoes(2), 3000);
    expect(col2(o.quote.pricing.charges)).toBe(3000);
    const child = (await col("orders").findOne({ _id: o.id as never }))!;
    expect(col2(child.allocatedCharges)).toBe(3000);
    expect(child.amountDue).toBe(child.itemsSubtotal - child.allocatedDiscount + child.allocatedCharges.reduce((s: number, c: { amount: number }) => s + c.amount, 0));
    expect(o.group.pricing.total).toBe(o.quote.pricing.total);
  });

  it("shares the tip over the deliveries of a split order, to the paise", async () => {
    const o = await order(both, 2001);
    expect(o.ids).toHaveLength(2);
    const rows = await Promise.all(o.ids.map(id => col("orders").findOne({ _id: id as never })));
    expect(rows.map(r => col2(r!.allocatedCharges)).reduce((a, b) => a + b, 0)).toBe(2001);
    expect(rows.every(r => col2(r!.allocatedCharges) > 0)).toBe(true);
  });
});

describe("cancelling", () => {
  const cancelOwn = (id: string) => f.send("post", `/orders/${id}/cancel`, { reason: "Ordered by mistake" }, A);

  it("refunds the whole tip with a prepaid order cancelled before pickup", async () => {
    await feeRule();
    const o = await order(tomatoes(2), 2000, "online");
    const res = await cancelOwn(o.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.refund.amount).toBe(6400 + 4000 + 2000);
    expect(res.body.data.deliveryFeeRefunded).toBe(true);
  });

  it("refunds a cancelled delivery's own tip even though the delivery fee stays with the rest of a split order", async () => {
    await feeRule();
    const o = await order(both, 2000, "online");
    const first = await cancelOwn(o.ids[0]!);
    const row0 = (await col("orders").findOne({ _id: o.ids[0] as never }))!;
    expect(first.body.data.deliveryFeeRefunded).toBe(false);
    expect(first.body.data.refund.amount).toBe(row0.itemsSubtotal - row0.allocatedDiscount + col2(row0.allocatedCharges));
    expect(col2(row0.allocatedCharges)).toBeGreaterThan(0);
  });
});

describe("what riders earn and what the owner owes", () => {
  it("lists a delivered order's tip for the rider who delivered it, and for no one else", async () => {
    const d = await delivered(2000);
    const mine = await as(d.rider, "get", "/rider/tips");
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data.totals).toEqual({ count: 1, total: 2000, owed: 2000, paid: 0 });
    expect(mine.body.data.items).toEqual([expect.objectContaining({ orderId: d.id, amount: 2000, status: "owed", paidAt: null })]);
    const other = await onShift();
    expect((await as(other, "get", "/rider/tips")).body.data.totals).toEqual({ count: 0, total: 0, owed: 0, paid: 0 });
    expect((await f.get("/rider/tips", {})).status).toBe(401);
  });

  it("does not count an order with no tip, or one that is not delivered yet", async () => {
    await delivered(0);
    const open = await order(tomatoes(1), 1000);
    expect(open.id).toBeTruthy();
    const rider = await onShift();
    expect((await as(rider, "get", "/rider/tips")).body.data.totals.count).toBe(0);
    expect((await f.get("/admin/rider-tips")).body.data.totals).toEqual({ count: 0, total: 0, owed: 0, paid: 0 });
  });

  it("shows the owner each rider's total and what is still owed, then marks it paid exactly once", async () => {
    const rider = await onShift();
    const a = await delivered(2000, rider);
    const b = await delivered(1000, rider);
    const summary = (await f.get("/admin/rider-tips")).body.data;
    expect(summary.totals).toEqual({ count: 2, total: 3000, owed: 3000, paid: 0 });
    expect(summary.riders).toEqual([expect.objectContaining({ riderId: rider.id, count: 2, total: 3000, owed: 3000, paid: 0 })]);
    expect((await f.get(`/admin/rider-tips/orders?riderId=${rider.id}&status=owed`)).body.data).toHaveLength(2);

    const pay = await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id, orderIds: [a.id], note: "Paid in cash" });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(pay.body.data).toEqual({ riderId: rider.id, paidCount: 1, paidAmount: 2000 });
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id, orderIds: [a.id] })).body.data).toMatchObject({ paidCount: 0, paidAmount: 0 });
    expect((await f.get("/admin/rider-tips")).body.data.totals).toEqual({ count: 2, total: 3000, owed: 1000, paid: 2000 });
    expect((await as(rider, "get", "/rider/tips")).body.data.totals).toEqual({ count: 2, total: 3000, owed: 1000, paid: 2000 });
    expect((await f.get("/admin/rider-tips/orders?status=paid")).body.data).toEqual([expect.objectContaining({ orderId: a.id, status: "paid" })]);

    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id, upTo: today })).body.data).toEqual({ riderId: rider.id, paidCount: 1, paidAmount: 1000 });
    expect((await f.get("/admin/rider-tips")).body.data.totals.owed).toBe(0);
    expect(b.id).toBeTruthy();
  });

  it("will not pay another rider's tips, and needs one of orderIds or upTo", async () => {
    const rider = await onShift();
    const other = await onShift();
    const d = await delivered(2000, rider);
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: other.id, orderIds: [d.id] })).body.data.paidCount).toBe(0);
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id })).status).toBe(400);
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id, orderIds: [d.id], upTo: "2026-11-07" })).status).toBe(400);
    expect((await f.get("/admin/rider-tips")).body.data.totals.owed).toBe(2000);
  });

  it("keeps staff to their own warehouses and to the right permission", async () => {
    const rider = await onShift();
    const d = await delivered(2000, rider);
    expect((await f.get("/admin/rider-tips", scoped(W1))).body.data.totals.owed).toBe(2000);
    expect((await f.get("/admin/rider-tips", scoped(W2))).body.data.totals.owed).toBe(0);
    expect((await f.get(`/admin/rider-tips?warehouseId=${W2}`, scoped(W1))).status).toBe(403);
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id, orderIds: [d.id] }, scoped(W2))).body.data.paidCount).toBe(0);
    expect((await f.send("post", "/admin/rider-tips/pay", { riderId: rider.id, orderIds: [d.id] }, viewer)).status).toBe(403);
    expect((await f.get("/admin/rider-tips", viewer)).status).toBe(403);
    expect((await f.get("/admin/rider-tips", {})).status).toBe(401);
    expect((await f.get("/admin/rider-tips?from=2026-12-01&to=2026-11-01")).status).toBe(400);
    expect(admin).toBeTruthy();
  });
});
