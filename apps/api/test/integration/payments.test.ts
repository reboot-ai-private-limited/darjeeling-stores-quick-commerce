import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDev2Modules } from "../../src/composition/dev2.js";
import { CUSTOMER_A, CUSTOMER_B, W1, ZONE1, admin, customer, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { LOC1 } from "./support/fake-geography.js";
import { api } from "./support/harness.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("payments_integration_test", { realOrders: true, realMoney: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); rev = 0; shelf = null; f.msg.person(CUSTOMER_A, "+919876543210", ["tok-customer-a"]); });

const { onShift, as, toDoor } = deliveryHelpers(() => f);
const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const col = (name: string) => f.h.connection.collection(name);
const HOME = { label: "Home", line1: "Cedar Villa", localityId: LOC1, pincode: "734101", landmark: "Opposite the gate", contactName: "Asha Rai", contactPhone: "98765 43210", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18 };
let rev = 0;
type Shelves = { tomato: Awaited<ReturnType<Fixture["pooledProduct"]>> };
let shelf: Shelves | null = null;
async function shelves(): Promise<Shelves> {
  if (shelf) return shelf;
  const tomato = await f.pooledProduct("Fresh Tomato", "TOM-1");
  await f.pooledOffer(W1, tomato, 20_000);
  return (shelf = { tomato });
}
const stockGrams = async () => (await col("warehouse_products").findOne({ warehouseId: W1 }))!.stockGrams as number;
const feeRule = () => f.send("post", "/admin/delivery-rules", { type: "delivery_fee", zoneIds: [ZONE1], minOrder: 0, tiers: [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: null, fee: 0 }] });

async function placeOrder(method: "cod" | "online", who = A, key = randomUUID()) {
  const { tomato } = await shelves();
  const address = (await f.send("post", "/addresses", HOME, who)).body.data.id as string;
  await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: [{ productId: tomato.id, variantId: tomato.v500, qty: 2 }] }, who);
  const q = await f.send("post", "/quotes", { paymentMethod: method }, who);
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  const res = await f.send("post", "/orders", { quoteId: q.body.data.id, paymentMethod: method }, { ...who, "Idempotency-Key": key });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const group = res.body.data.group;
  return { ...res.body.data, group, id: group.children[0].id as string, payment: res.body.data.payment };
}
const hook = (event: string, payload: Record<string, unknown>, eventId: string = randomUUID(), sign = true) => {
  const raw = JSON.stringify({ event, payload });
  const r = request(f.app).post(`${api}/webhooks/razorpay`).set("Content-Type", "application/json").set("X-Razorpay-Event-Id", eventId);
  return (sign ? r.set("X-Razorpay-Signature", f.razorpay.sign(raw)) : r).send(raw);
};
const captured = (orderId: string, paymentId: string, amount: number) => ({ payment: { entity: { id: paymentId, order_id: orderId, amount, status: "captured" } } });
const linkPaid = (linkId: string, paymentId: string, amount: number) => ({ payment_link: { entity: { id: linkId } }, payment: { entity: { id: paymentId, order_id: "order_of_link", amount, status: "captured" } } });
const verifyBody = (p: { group: { id: string }; payment: { razorpayOrderId: string } }, paymentId = "pay_1") => ({
  groupId: p.group.id, razorpayOrderId: p.payment.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: f.razorpay.checkoutSignature(p.payment.razorpayOrderId, paymentId),
});
const poll = async (groupId: string, who = A) => (await f.get(`/order-groups/${groupId}/payment`, who)).body.data;
const post = (path: string, body?: unknown, who: Record<string, string> = admin) => f.send("post", path, body, who);

describe("starting an online payment", () => {
  it("places the order unpaid and hands back what the app needs to open checkout", async () => {
    await feeRule();
    const o = await placeOrder("online");
    expect(o.group).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "pending" });
    expect(o.payment).toEqual({ provider: "razorpay", razorpayKeyId: "rzp_test_key", razorpayOrderId: "order_1", amount: 10400, currency: "INR", expiresAt: expect.stringMatching(/Z$/) });
    expect(f.razorpay.orders).toEqual([{ id: "order_1", amount: 10400, receipt: o.group.groupNo }]);
    expect(await col("payments").findOne({ groupId: o.group.id })).toMatchObject({ method: "razorpay", status: "created", attempt: 1, amount: 10400, razorpayOrderId: "order_1", userId: CUSTOMER_A });
    expect(await poll(o.group.id)).toEqual({ groupId: o.group.id, paymentStatus: "pending", state: "awaiting_payment", expiresAt: o.payment.expiresAt });
  });

  it("uses the same payment when the order request is repeated", async () => {
    const key = randomUUID();
    const first = await placeOrder("online", A, key);
    const { tomato } = await shelves();
    void tomato;
    const again = await f.send("post", "/orders", { quoteId: (await col("order_groups").findOne({ _id: first.group.id as never }))!.quoteId, paymentMethod: "online" }, { ...A, "Idempotency-Key": key });
    expect(again.status).toBe(201);
    expect(again.body.data.payment.razorpayOrderId).toBe(first.payment.razorpayOrderId);
    expect(f.razorpay.orders).toHaveLength(1);
  });

  it("still places the order when Razorpay is down, and lets the customer retry", async () => {
    f.razorpay.state.fail = true;
    const o = await placeOrder("online");
    expect(o.payment).toBeNull();
    expect(o.group.status).toBe("PENDING_PAYMENT");
    f.razorpay.state.fail = false;
    const retry = await f.send("post", "/payments/retry", { groupId: o.group.id }, A);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.data.razorpayOrderId).toBe("order_1");
  });

  it("says online payment is not set up when there is no provider", async () => {
    const bare = createDev2Modules({ connection: f.h.connection, geography: f.geo.geography, paymentProvider: undefined as never });
    const o = await placeOrder("online");
    await expect(bare.payments.service.retry(CUSTOMER_A, o.group.id)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("the app's success callback", () => {
  it("is only provisional: the order waits for the webhook", async () => {
    const o = await placeOrder("online");
    const res = await f.send("post", "/payments/verify", verifyBody(o), A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ groupId: o.group.id, state: "confirming", provisional: true });
    expect((await poll(o.group.id)).state).toBe("confirming");
    expect((await col("orders").findOne({ _id: o.id as never }))?.status).toBe("PENDING_PAYMENT");
    expect(await col("payments").findOne({ groupId: o.group.id })).toMatchObject({ status: "authorized", signatureVerified: true, razorpayPaymentId: "pay_1" });
    expect((await f.send("post", "/payments/verify", verifyBody(o), A)).status).toBe(200);
  });

  it("refuses a bad signature, someone else's order, or a payment for another amount", async () => {
    const o = await placeOrder("online");
    const bad = await f.send("post", "/payments/verify", { ...verifyBody(o), razorpaySignature: "0".repeat(64) }, A);
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toEqual({ field: "razorpaySignature" });
    expect((await f.send("post", "/payments/verify", verifyBody(o), B)).status).toBe(404);
    expect((await f.send("post", "/payments/verify", { ...verifyBody(o), razorpayOrderId: "order_unknown" }, A)).body.error.code).toBe("PAYMENT_MISMATCH");
    await col("payments").updateOne({ groupId: o.group.id }, { $set: { amount: 1 } });
    expect((await f.send("post", "/payments/verify", verifyBody(o), A)).body.error.code).toBe("PAYMENT_MISMATCH");
    expect((await f.send("post", "/payments/verify", {}, A)).status).toBe(400);
    expect((await f.send("post", "/payments/verify", verifyBody(o), {})).status).toBe(401);
  });
});

describe("the Razorpay webhook", () => {
  it("places and confirms the order when the payment is captured, once", async () => {
    await feeRule();
    const o = await placeOrder("online");
    const orderId = o.payment.razorpayOrderId as string;
    const res = await hook("payment.captured", captured(orderId, "pay_9", 10400), "evt_1");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ ok: true, result: "paid" });
    expect(await col("orders").findOne({ _id: o.id as never })).toMatchObject({ status: "CONFIRMED", paymentStatus: "paid", paidAmount: 10400, stamps: { placedAt: expect.any(Date), confirmedAt: expect.any(Date) } });
    expect(await col("order_groups").findOne({ _id: o.group.id as never })).toMatchObject({ paymentStatus: "paid", expiresAt: null });
    expect(await col("payments").findOne({ groupId: o.group.id })).toMatchObject({ status: "captured", razorpayPaymentId: "pay_9", capturedAt: expect.any(Date), signatureVerified: true });
    expect(await col("stock_reservations").findOne({ key: o.group.id })).toMatchObject({ status: "confirmed" });
    expect(await poll(o.group.id)).toMatchObject({ paymentStatus: "paid", state: "confirmed" });
    expect((await f.get(`/order-groups/${o.group.id}`, A)).body.data).toMatchObject({ status: "ACTIVE", paymentStatus: "paid" });
    expect((await f.send("post", "/payments/verify", verifyBody(o, "pay_9"), A)).body.data.state).toBe("confirmed");
    await f.runJobs();
    expect(f.msg.pushed.some(p => p.title === "Order placed")).toBe(true);
  });

  it("handles a repeated event and a second capture of the same payment as one", async () => {
    const o = await placeOrder("online");
    const orderId = o.payment.razorpayOrderId as string;
    expect((await hook("payment.captured", captured(orderId, "pay_9", 3200 * 2), "evt_dup")).body.data.result).toBe("paid");
    expect((await hook("payment.captured", captured(orderId, "pay_9", 3200 * 2), "evt_dup")).body.data).toEqual({ ok: true, result: "duplicate" });
    expect((await hook("payment.captured", captured(orderId, "pay_9", 3200 * 2), "evt_other")).body.data.result).toBe("already_captured");
    expect(await col("payment_events").countDocuments({})).toBe(2);
    expect(await col("order_events").countDocuments({ type: "payment_captured" })).toBe(1);
    expect(await col("refunds").countDocuments({})).toBe(0);
  });

  it("handles simultaneous deliveries of one event once", async () => {
    const o = await placeOrder("online");
    const orderId = o.payment.razorpayOrderId as string;
    const results = await Promise.all([1, 2, 3].map(() => hook("payment.captured", captured(orderId, "pay_9", 6400), "evt_same")));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(results.filter(r => r.body.data.result === "paid").length).toBe(1);
    expect(await col("order_events").countDocuments({ type: "payment_captured" })).toBe(1);
  });

  it("does not confirm an order when the amount is not what was due, and tells the admin", async () => {
    const o = await placeOrder("online");
    const res = await hook("payment.captured", captured(o.payment.razorpayOrderId, "pay_9", 100));
    expect(res.body.data.result).toBe("amount_mismatch");
    expect(await col("orders").findOne({ _id: o.id as never })).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "pending" });
    expect(await col("payments").findOne({ groupId: o.group.id })).toMatchObject({ flag: "amount_mismatch", status: "authorized" });
  });

  it("records a failed attempt but keeps the order open, and the next attempt can succeed", async () => {
    const o = await placeOrder("online");
    const first = o.payment.razorpayOrderId as string;
    const failed = await hook("payment.failed", { payment: { entity: { id: "pay_x", order_id: first, error_description: "Card declined" } } });
    expect(failed.body.data.result).toBe("failure_recorded");
    expect(await poll(o.group.id)).toMatchObject({ state: "failed", paymentStatus: "pending" });
    expect((await col("orders").findOne({ _id: o.id as never }))?.status).toBe("PENDING_PAYMENT");
    expect(await col("payments").findOne({ razorpayOrderId: first })).toMatchObject({ status: "failed", failureReason: "Card declined" });
    const retry = await f.send("post", "/payments/retry", { groupId: o.group.id }, A);
    expect(retry.status).toBe(201);
    expect(retry.body.data).toEqual({ razorpayKeyId: "rzp_test_key", razorpayOrderId: "order_2", amount: 6400, currency: "INR", expiresAt: expect.stringMatching(/Z$/) });
    expect(await col("payments").countDocuments({ groupId: o.group.id })).toBe(2);
    expect((await hook("payment.captured", captured("order_2", "pay_ok", 6400))).body.data.result).toBe("paid");
    expect((await poll(o.group.id)).state).toBe("confirmed");
    const again = await f.send("post", "/payments/retry", { groupId: o.group.id }, A);
    expect(again.status).toBe(409);
  });

  it("refunds a payment that arrives after the order expired", async () => {
    const o = await placeOrder("online");
    await col("order_groups").updateOne({ _id: o.group.id as never }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await f.mods.payments.service.expireOverdue()).toBe(1);
    expect((await col("orders").findOne({ _id: o.id as never }))?.status).toBe("CANCELLED");
    expect(await stockGrams()).toBe(20_000);
    expect(await poll(o.group.id)).toMatchObject({ state: "expired" });
    expect((await f.send("post", "/payments/retry", { groupId: o.group.id }, A)).status).toBe(410);
    expect((await f.send("post", "/payments/verify", verifyBody(o), A)).status).toBe(410);
    const late = await hook("payment.captured", captured(o.payment.razorpayOrderId, "pay_late", 6400));
    expect(late.body.data.result).toBe("late_refund");
    expect(await col("payments").findOne({ groupId: o.group.id })).toMatchObject({ status: "captured", flag: "late_payment" });
    expect(await col("refunds").findOne({ groupId: o.group.id })).toMatchObject({ amount: 6400, reason: "late_payment", source: "auto", status: "requested" });
    expect((await col("orders").findOne({ _id: o.id as never }))?.status).toBe("CANCELLED");
    expect((await hook("payment.captured", captured(o.payment.razorpayOrderId, "pay_late", 6400), randomUUID())).body.data.result).toBe("already_captured");
    expect(await col("refunds").countDocuments({})).toBe(1);
  });

  it("expires only orders whose time has run out and are still unpaid", async () => {
    const paid = await placeOrder("online");
    await hook("payment.captured", captured(paid.payment.razorpayOrderId, "pay_1", 6400));
    const waiting = await placeOrder("online", A, randomUUID());
    expect(await f.mods.payments.service.expireOverdue()).toBe(0);
    await col("order_groups").updateOne({ _id: waiting.group.id as never }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await f.mods.payments.service.expireOverdue()).toBe(1);
    expect(await f.mods.payments.service.expireOverdue()).toBe(0);
    expect((await col("orders").findOne({ _id: paid.id as never }))?.status).toBe("CONFIRMED");
  });

  it("refuses a bad signature, ignores odd events and unknown payments, and always answers quickly", async () => {
    const o = await placeOrder("online");
    expect((await hook("payment.captured", captured(o.payment.razorpayOrderId, "pay_9", 6400), randomUUID(), false)).status).toBe(403);
    expect(await col("payment_events").countDocuments({})).toBe(0);
    expect((await request(f.app).post(`${api}/webhooks/razorpay`).set("X-Razorpay-Signature", f.razorpay.sign("not json")).set("Content-Type", "application/json").send("not json")).status).toBe(400);
    expect((await hook("payment.captured", captured("order_nobody", "pay_z", 100))).body.data.result).toBe("unknown_payment");
    expect((await hook("settlement.processed", {})).body.data.result).toBe("ignored");
    expect((await col("orders").findOne({ _id: o.id as never }))?.status).toBe("PENDING_PAYMENT");
  });
});

describe("paying online for a cash order", () => {
  it("makes a link, reuses it, and settles the order when it is paid so the rider is told not to collect", async () => {
    await feeRule();
    const o = await placeOrder("cod");
    const rider = await onShift();
    await f.send("post", `/admin/orders/${o.id}/start-packing`);
    await f.send("post", `/admin/orders/${o.id}/complete-packing`);
    await f.send("post", `/admin/orders/${o.id}/assign`, { riderId: rider.id });
    const res = await f.send("post", `/orders/${o.id}/pay-link`, { method: "upi_intent" }, A);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({ groupId: o.group.id, amount: 10400, paymentLinkId: "plink_1", url: "https://rzp.io/i/1", upiIntentUrl: expect.stringMatching(/^upi:\/\/pay/), expiresAt: expect.stringMatching(/Z$/) });
    expect((await f.send("post", `/orders/${o.id}/pay-link`, { method: "link" }, A)).body.data.paymentLinkId).toBe("plink_1");
    expect(f.razorpay.links).toHaveLength(1);

    const paid = await hook("payment_link.paid", linkPaid("plink_1", "pay_link", 10400));
    expect(paid.body.data.result).toBe("paid_cod");
    expect(await col("orders").findOne({ _id: o.id as never })).toMatchObject({ paymentStatus: "paid", amountDue: 0, paidAmount: 10400 });
    expect((await col("order_groups").findOne({ _id: o.group.id as never }))?.paymentStatus).toBe("paid");
    const feed = (await as(rider, "get", "/rider/assignments?since=c_0")).body.data.map((e: { event: string }) => e.event);
    expect(feed).toContain("payment_paid");
    await toDoor(rider, o.id);
    const cash = await as(rider, "post", `/rider/orders/${o.id}/collect-cash`, { amount: 10400 });
    expect(cash.status).toBe(409);
    expect(cash.body.error.details).toEqual({ reason: "already_paid" });
  });

  it("refunds a payment that arrives after the cash was already taken", async () => {
    const o = await placeOrder("cod");
    const rider = await onShift();
    await f.send("post", `/admin/orders/${o.id}/start-packing`);
    await f.send("post", `/admin/orders/${o.id}/complete-packing`);
    await f.send("post", `/admin/orders/${o.id}/assign`, { riderId: rider.id });
    await f.send("post", `/orders/${o.id}/pay-link`, {}, A);
    await toDoor(rider, o.id);
    await as(rider, "post", `/rider/orders/${o.id}/collect-cash`, { amount: 6400 });
    const res = await hook("payment_link.paid", linkPaid("plink_1", "pay_link", 6400));
    expect(res.body.data.result).toBe("overpaid_refund");
    expect(await col("refunds").findOne({ groupId: o.group.id })).toMatchObject({ reason: "overpaid", amount: 6400 });
    expect(await col("orders").findOne({ _id: o.id as never })).toMatchObject({ collection: { method: "cash" }, paymentStatus: "cod_collected" });
  });

  it("is refused for a prepaid order, once cash is taken, for someone else's order, or when nothing is due", async () => {
    const online = await placeOrder("online");
    expect((await f.send("post", `/orders/${online.id}/pay-link`, {}, A)).body.error.details).toEqual({ reason: "not_cod" });
    const o = await placeOrder("cod");
    expect((await f.send("post", `/orders/${o.id}/pay-link`, {}, B)).status).toBe(404);
    expect((await f.send("post", `/orders/${"9".repeat(24)}/pay-link`, {}, A)).status).toBe(404);
    expect((await f.send("post", `/orders/${o.id}/pay-link`, { method: "cheque" }, A)).status).toBe(400);
    expect((await f.send("post", `/orders/${o.id}/pay-link`, {}, {})).status).toBe(401);
    await col("orders").updateOne({ _id: o.id as never }, { $set: { collection: { method: "cash", amount: 6400, at: new Date() } } });
    expect((await f.send("post", `/orders/${o.id}/pay-link`, {}, A)).body.error.details).toEqual({ reason: "cash_collected" });
  });
});

describe("the admin's payments", () => {
  it("lists payments with the order and customer, filtered, and shows the last provider event", async () => {
    const a = await placeOrder("online");
    const b = await placeOrder("online", A, randomUUID());
    await hook("payment.captured", captured(a.payment.razorpayOrderId, "pay_a", 6400));
    const all = await f.get("/admin/payments", admin);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data.find((p: { groupId: string }) => p.groupId === a.group.id)).toMatchObject({
      groupNo: a.group.groupNo, customerName: "Asha Rai", status: "captured", method: "razorpay", amount: 6400, razorpayPaymentId: "pay_a", signatureVerified: true, capturedAt: expect.stringMatching(/Z$/),
    });
    expect((await f.get("/admin/payments?status=captured", admin)).body.data).toHaveLength(1);
    expect((await f.get(`/admin/payments?groupNo=${b.group.groupNo}`, admin)).body.data.map((p: { groupId: string }) => p.groupId)).toEqual([b.group.id]);
    expect((await f.get("/admin/payments?groupNo=DS-000000", admin)).body.data).toEqual([]);
    expect((await f.get("/admin/payments?method=razorpay_link", admin)).body.data).toEqual([]);
    expect((await f.get("/admin/payments?limit=1", admin)).body.meta.nextCursor).toEqual(expect.any(String));
    expect((await f.get("/admin/payments?status=weird", admin)).status).toBe(400);
    const one = (await f.get("/admin/payments?status=captured", admin)).body.data[0];
    const detail = await f.get(`/admin/payments/${one.id}`, admin);
    expect(detail.body.data).toMatchObject({ id: one.id, lastEvent: { type: "payment.captured", result: "paid" } });
    expect((await f.get(`/admin/payments/${"9".repeat(24)}`, admin)).status).toBe(404);
  });

  it("is only for staff who see every warehouse, with the right permission", async () => {
    for (const path of ["/admin/payments", "/admin/payments/reconciliation"]) {
      expect((await f.get(path, viewer)).status, path).toBe(403);
      expect((await f.get(path, {})).status, path).toBe(401);
      expect((await f.get(path, scoped(W1))).status, path).toBe(403);
    }
    expect((await post("/admin/payments/reconcile", {}, scoped(W1))).status).toBe(403);
    expect((await post("/admin/payments/reconcile", {}, viewer)).status).toBe(403);
  });

  it("compares a day's captures with Razorpay and lists what does not match", async () => {
    const a = await placeOrder("online");
    const b = await placeOrder("online", A, randomUUID());
    await hook("payment.captured", captured(a.payment.razorpayOrderId, "pay_a", 6400));
    await hook("payment.captured", captured(b.payment.razorpayOrderId, "pay_b", 6400));
    f.razorpay.captures.push(
      { paymentId: "pay_a", orderId: a.payment.razorpayOrderId, amount: 6400, status: "captured" },
      { paymentId: "pay_b", orderId: b.payment.razorpayOrderId, amount: 6300, status: "captured" },
      { paymentId: "pay_x", orderId: "order_x", amount: 9900, status: "captured" },
    );
    const run = await post("/admin/payments/reconcile", {});
    expect(run.status, JSON.stringify(run.body)).toBe(202);
    expect(run.body.data.jobId).toEqual(expect.any(String));
    const res = await f.get("/admin/payments/reconciliation", admin);
    expect(res.body.data.matched).toBe(1);
    const pb = (await col("payments").findOne({ razorpayPaymentId: "pay_b" }))!._id;
    expect(res.body.data.mismatches).toEqual(expect.arrayContaining([
      { type: "amount_mismatch", paymentId: pb, expected: 6400, actual: 6300 }, { type: "missing_in_db", razorpayPaymentId: "pay_x", amount: 9900 },
    ]));
    f.razorpay.captures.splice(0, 3);
    await post("/admin/payments/reconcile", {});
    expect((await f.get("/admin/payments/reconciliation", admin)).body.data.mismatches.map((m: { type: string }) => m.type)).toEqual(["missing_in_provider", "missing_in_provider"]);
    expect((await f.get("/admin/payments/reconciliation?date=1999-01-01", admin)).body.data).toEqual({ date: "1999-01-01", matched: 0, mismatches: [] });
    expect((await post("/admin/payments/reconcile", { date: "yesterday" })).status).toBe(400);
  });

  it("marks a stuck payment as received after the dashboard was checked", async () => {
    const o = await placeOrder("online");
    await f.send("post", "/payments/verify", verifyBody(o), A);
    const payment = (await col("payments").findOne({ groupId: o.group.id }))!;
    const res = await post(`/admin/payments/${payment._id}/mark-paid`, { razorpayPaymentId: "pay_Nz2", note: "Verified in dashboard" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ status: "captured", razorpayPaymentId: "pay_Nz2" });
    expect((await col("orders").findOne({ _id: o.id as never }))?.status).toBe("CONFIRMED");
    expect(await col("audit_log").countDocuments({ action: "payments.mark_paid" })).toBe(1);
    const again = await post(`/admin/payments/${payment._id}/mark-paid`, { razorpayPaymentId: "pay_Nz2" });
    expect(again.status).toBe(409);
    expect((await post(`/admin/payments/${payment._id}/mark-paid`, {})).status).toBe(400);
    expect((await post(`/admin/payments/${"9".repeat(24)}/mark-paid`, { razorpayPaymentId: "pay_x" })).status).toBe(404);
  });
});
