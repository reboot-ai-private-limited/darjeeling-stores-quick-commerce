import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, CUSTOMER_B, W1, W2, ZONE1, customer, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { LOC1 } from "./support/fake-geography.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("orders_integration_test", { realOrders: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); rev = 0; shelf = null; });

const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const col = (name: string) => f.h.connection.collection(name);
const HOME = { label: "Home", line1: "Cedar Villa, 2nd floor", localityId: LOC1, pincode: "734101", landmark: "Opposite Planters Club gate", contactName: "Asha Rai", contactPhone: "98765 43210", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18, deliveryNotes: "Ring the bell twice" };
let rev = 0;
const line = (productId: string, variantId: string, qty: number) => ({ productId, variantId, qty });
const withKey = (who: Record<string, string>, key = randomUUID()) => ({ ...who, "Idempotency-Key": key });
const feeRule = () => f.send("post", "/admin/delivery-rules", { type: "delivery_fee", zoneIds: [ZONE1], minOrder: 0, tiers: [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: null, fee: 0 }] });

/** Tomatoes at the Chowrasta store and milk at the Mall Road store. */
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
async function cartWith(items: (s: Awaited<ReturnType<typeof shelves>>) => unknown[], who = A) {
  const s = await shelves();
  const address = (await f.send("post", "/addresses", HOME, who)).body.data.id as string;
  const put = await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: items(s) }, who);
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  return { ...s, address };
}
const quote = async (who = A, body: Record<string, unknown> = {}) => {
  const res = await f.send("post", "/quotes", { paymentMethod: "cod", ...body }, who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const place = (quoteId: string, who = A, body: Record<string, unknown> = {}, key?: string) =>
  f.send("post", "/orders", { quoteId, paymentMethod: "cod", ...body }, withKey(who, key));
/** A placed cash order for two tomato lines. */
async function placed(who = A) {
  const ctx = await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)], who);
  const q = await quote(who);
  const res = await place(q.id, who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...ctx, quote: q, group: res.body.data.group };
}
const stockOf = async (warehouseId: string, productId: string) => (await col("warehouse_products").findOne({ warehouseId, productId }))!;

describe("placing an order", () => {
  it("turns a quote into a group with one confirmed child, takes the stock, and clears the cart", async () => {
    await feeRule();
    const { tomato, quote: q, group } = await placed();
    expect(group).toMatchObject({
      groupNo: expect.stringMatching(/^DS-\d{6}$/), status: "ACTIVE", paymentMethod: "cod", paymentStatus: "cod_pending",
      pricing: { subtotal: 6400, discount: 0, charges: [{ type: "delivery_fee", label: "Delivery fee", amount: 4000 }], tax: 0, total: 10400, taxInclusive: true },
      address: { line1: "Cedar Villa, 2nd floor", landmark: "Opposite Planters Club gate", locality: "Chowrasta", contactName: "Asha Rai", contactPhone: "+919876543210" },
      deliveryOtp: expect.stringMatching(/^\d{4}$/),
    });
    expect(group.children).toHaveLength(1);
    expect(group.children[0]).toMatchObject({
      orderNo: group.groupNo, groupId: group.id, warehouseId: W1, status: "CONFIRMED", paymentStatus: "cod_pending", refundStatus: "none", itemsSubtotal: 6400, amountDue: 10400, rider: null,
      items: [{ productId: tomato.id, variantId: tomato.v500, name: "Fresh Tomato", unitPrice: 3200, qty: 2, lineTotal: 6400, status: "ok" }],
      timeline: [{ status: "PLACED", at: expect.stringMatching(/Z$/) }, { status: "CONFIRMED", at: expect.stringMatching(/Z$/) }],
    });
    expect((await stockOf(W1, tomato.id)).stockGrams).toBe(19_000);
    expect(await col("stock_reservations").findOne({ key: group.id })).toMatchObject({ status: "confirmed" });
    expect((await f.get("/cart", A)).body.data.cart.items).toEqual([]);
    expect((await col("quotes").findOne({ _id: q.id as never }))?.usedByGroupId).toBe(group.id);
    expect(await col("order_events").countDocuments({ groupId: group.id })).toBe(2);
    expect(f.mods.orders.core).toBeTruthy();
    await f.runJobs();
    expect(f.msg.pushed.some(p => p.title === "Order placed")).toBe(false);
  });

  it("splits across warehouses into one child each, with one bill and the fee shared", async () => {
    await feeRule();
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)]);
    const q = await quote();
    const res = await place(q.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const g = res.body.data.group;
    expect(g.children.map((c: { orderNo: string }) => c.orderNo)).toEqual([`${g.groupNo}-A`, `${g.groupNo}-B`]);
    expect(g.children.map((c: { warehouseId: string }) => c.warehouseId).sort()).toEqual([W1, W2]);
    expect(g.children.reduce((sum: number, c: { amountDue: number }) => sum + c.amountDue, 0)).toBe(g.pricing.total);
    expect(g.pricing).toMatchObject({ subtotal: 11400, total: 15400 });
    expect(g.children.every((c: { status: string }) => c.status === "CONFIRMED")).toBe(true);
  });

  it("holds an online order for payment instead of confirming it, and starts the payment", async () => {
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const q = await quote(A, { paymentMethod: "online" });
    const res = await place(q.id, A, { paymentMethod: "online" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.group).toMatchObject({ status: "PENDING_PAYMENT", paymentMethod: "online", paymentStatus: "pending", deliveryOtp: expect.any(String) });
    expect(res.body.data.group.children[0]).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "pending", amountDue: 0 });
    expect(res.body.data.payment).toMatchObject({ provider: "fake", amount: 3200, currency: "INR" });
    expect(await col("stock_reservations").findOne({ key: res.body.data.group.id })).toMatchObject({ status: "held", expiresAt: expect.any(Date) });
    expect((await col("order_groups").findOne({ _id: res.body.data.group.id as never }))?.expiresAt).toEqual(expect.any(Date));
  });

  it("returns the same order when the same request is repeated, and refuses the key with a different request", async () => {
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = await quote();
    const key = randomUUID();
    const first = await place(q.id, A, {}, key);
    const again = await place(q.id, A, {}, key);
    expect(again.status).toBe(201);
    expect(again.body.data.group.id).toBe(first.body.data.group.id);
    expect(await col("order_groups").countDocuments({})).toBe(1);
    expect((await stockOf(W1, (await col("orders").findOne({}))!.items[0].productId)).stockGrams).toBe(19_000);
    const other = await place(q.id, A, { deliveryNotes: "Leave at the gate" }, key);
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await place(q.id, A, {}, "")).status).toBe(400);
  });

  it("creates one order when a double tap sends the request three times at once", async () => {
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = await quote();
    const key = randomUUID();
    const results = await Promise.all([place(q.id, A, {}, key), place(q.id, A, {}, key), place(q.id, A, {}, key)]);
    const ok = results.filter(r => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map(r => r.body.data.group.id)).size).toBe(1);
    expect(await col("order_groups").countDocuments({})).toBe(1);
    expect((await col("warehouse_products").findOne({ warehouseId: W1 }))!.stockGrams).toBe(19_000);
  });

  it("will not use a quote twice, an expired quote, or someone else's", async () => {
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = await quote();
    expect((await place(q.id, B)).status).toBe(404);
    expect((await place("9".repeat(24))).status).toBe(404);
    expect((await place(q.id)).status).toBe(201);
    const second = await place(q.id);
    expect(second.status).toBe(409);
    expect(second.body.error.details).toEqual({ reason: "quote_used" });
    const tomato = (await shelves()).tomato;
    await f.send("put", "/cart", { clientRev: ++rev, items: [line(tomato.id, tomato.v250, 1)] }, A);
    const q2 = await quote();
    await col("quotes").updateOne({ _id: q2.id as never }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await place(q2.id);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe("QUOTE_EXPIRED");
  });

  it("tells the customer when the price changed since the quote and lets them place the new one", async () => {
    const { tomato } = await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = await quote();
    const offer = (await col("warehouse_products").findOne({ warehouseId: W1, productId: tomato.id }))!;
    await f.send("put", `/admin/warehouses/${W1}/products/${tomato.id}`, { variants: [{ variantId: tomato.v500, price: 3500, mrp: 4000 }], rev: offer.rev });
    await col("warehouse_products").updateOne({ _id: offer._id }, { $set: { "variants.$[v].price": 3500 } }, { arrayFilters: [{ "v.variantId": tomato.v500 }] });
    const changed = await place(q.id);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("QUOTE_CHANGED");
    const fresh = changed.body.error.details.quote;
    expect(fresh.pricing.subtotal).toBe(7000);
    expect(fresh.id).not.toBe(q.id);
    expect((await stockOf(W1, tomato.id)).stockGrams).toBe(20_000);
    const accepted = await place(fresh.id);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.data.group.pricing.subtotal).toBe(7000);
  });

  it("refuses when the stock ran out after the quote, and leaves nothing held", async () => {
    const { tomato } = await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = await quote();
    await col("warehouse_products").updateOne({ warehouseId: W1, productId: tomato.id }, { $set: { stockGrams: 500 } });
    const res = await place(q.id);
    expect(res.status).toBe(409);
    expect(["INSUFFICIENT_STOCK", "ITEM_UNAVAILABLE"]).toContain(res.body.error.code);
    expect(await col("order_groups").countDocuments({})).toBe(0);
    expect((await stockOf(W1, tomato.id)).stockGrams).toBe(500);
    expect((await col("quotes").findOne({ _id: q.id as never }))?.usedByGroupId).toBeNull();
  });

  it("two customers racing for the last stock: one gets it", async () => {
    const tomato = await f.pooledProduct("Fresh Tomato", "TOM-1");
    await f.pooledOffer(W1, tomato, 1000);
    const wanted = (who: Record<string, string>) => async () => {
      const address = (await f.send("post", "/addresses", HOME, who)).body.data.id as string;
      await f.send("put", "/cart", { clientRev: 1, addressId: address, items: [line(tomato.id, tomato.v500, 2)] }, who);
      return (await f.send("post", "/quotes", { paymentMethod: "cod" }, who)).body.data.id as string;
    };
    const [qa, qb] = [await wanted(A)(), await wanted(B)()];
    const results = await Promise.all([place(qa, A), place(qb, B)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await stockOf(W1, tomato.id)).stockGrams).toBe(0);
  });

  it("uses a coupon once and takes it back when the order is cancelled", async () => {
    await f.send("post", "/admin/coupons", { code: "FIVE", type: "flat", value: 500, minOrder: 0, perUserLimit: 1 });
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    await f.send("post", "/cart/coupon", { code: "FIVE" }, A);
    const q = await quote();
    const res = await place(q.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.group.pricing).toMatchObject({ discount: 500, total: 5900 });
    const coupon = (await col("coupons").findOne({ code: "FIVE" }))!;
    expect(coupon.usedCount).toBe(1);
    expect(await col("coupon_usage").countDocuments({ groupId: res.body.data.group.id })).toBe(1);
    const cancel = await f.send("post", `/admin/orders/${res.body.data.group.children[0].id}/cancel`, { reason: "Test" });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await col("coupons").findOne({ code: "FIVE" }))!.usedCount).toBe(0);
  });

  it("needs a login and a valid request", async () => {
    expect((await f.send("post", "/orders", { quoteId: "9".repeat(24) }, withKey({}))).status).toBe(401);
    expect((await place("nope")).status).toBe(400);
    expect((await f.send("post", "/orders", { quoteId: "9".repeat(24), paymentMethod: "cheque" }, withKey(A))).status).toBe(400);
    expect((await f.send("post", "/orders", { quoteId: "9".repeat(24), extra: 1 }, withKey(A))).status).toBe(400);
  });

  it("refuses cash on delivery when the quote said it was not allowed", async () => {
    await cartWith(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const q = await quote(A, { paymentMethod: "online" });
    await col("quotes").updateOne({ _id: q.id as never }, { $set: { "payment.codAllowed": false } });
    const res = await place(q.id, A, { paymentMethod: "cod" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("COD_NOT_ALLOWED");
  });
});

describe("what the customer sees", () => {
  it("lists orders, active and past, newest first", async () => {
    const one = await placed();
    const two = await placed();
    await f.send("post", `/admin/orders/${two.group.children[0].id}/cancel`, { reason: "x" });
    const all = await f.get("/orders", A);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.data.map((g: { groupId: string }) => g.groupId)).toEqual([two.group.id, one.group.id]);
    expect(all.body.data[1]).toEqual({
      groupId: one.group.id, groupNo: one.group.groupNo, status: "ACTIVE", total: 6400, createdAt: expect.stringMatching(/Z$/),
      children: [{ id: one.group.children[0].id, orderNo: one.group.groupNo, status: "CONFIRMED", itemCount: 2, promisedAt: expect.stringMatching(/Z$/) }],
    });
    expect((await f.get("/orders?status=active", A)).body.data.map((g: { groupId: string }) => g.groupId)).toEqual([one.group.id]);
    expect((await f.get("/orders?status=past", A)).body.data.map((g: { groupId: string }) => g.groupId)).toEqual([two.group.id]);
    expect((await f.get("/orders?limit=1", A)).body.meta.nextCursor).toEqual(expect.any(String));
    expect((await f.get("/orders", B)).body.data).toEqual([]);
    expect((await f.get("/orders?status=gone", A)).status).toBe(400);
    expect((await f.get("/orders", {})).status).toBe(401);
  });

  it("shows a group and its children to the customer only", async () => {
    const { group } = await placed();
    expect((await f.get(`/order-groups/${group.id}`, A)).body.data).toEqual(group);
    expect((await f.get(`/orders/${group.children[0].id}`, A)).body.data).toEqual(group.children[0]);
    for (const path of [`/order-groups/${group.id}`, `/orders/${group.children[0].id}`]) {
      expect((await f.get(path, B)).status, path).toBe(404);
      expect((await f.get(path, {})).status, path).toBe(401);
    }
    expect((await f.get(`/orders/${"9".repeat(24)}`, A)).status).toBe(404);
    expect((await f.get("/orders/nope", A)).status).toBe(404);
  });

  it("hides the delivery code once the order is over, and shows the rider once assigned", async () => {
    const { group } = await placed();
    const id = group.children[0].id;
    expect((await f.get(`/order-groups/${group.id}`, A)).body.data.deliveryOtp).toMatch(/^\d{4}$/);
    await f.send("post", `/admin/orders/${id}/cancel`, { reason: "x" });
    const after = (await f.get(`/order-groups/${group.id}`, A)).body.data;
    expect(after).toMatchObject({ status: "CANCELLED", deliveryOtp: null });
    expect(after.children[0]).toMatchObject({ status: "CANCELLED", timeline: expect.arrayContaining([{ status: "CANCELLED", at: expect.any(String) }]) });
  });

  it("puts a past order back into the cart at today's prices", async () => {
    const { group, tomato } = await placed();
    const res = await f.send("post", `/orders/${group.children[0].id}/reorder`, undefined, A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.cart.items).toEqual([expect.objectContaining({ productId: tomato.id, variantId: tomato.v500, qty: 2, unitPrice: 3200 })]);
    expect(res.body.data.corrections).toEqual([]);
    expect((await f.send("post", `/orders/${group.children[0].id}/reorder`, undefined, B)).status).toBe(404);
  });
});
