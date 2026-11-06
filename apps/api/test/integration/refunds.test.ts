import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, CUSTOMER_B, W1, W2, ZONE1, asPrincipal, customer, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { LOC1 } from "./support/fake-geography.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("refunds_integration_test", { realOrders: true, realMoney: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); rev = 0; shelf = null; f.msg.person(CUSTOMER_A, "+919876543210", ["tok-customer-a"]); });

const { onShift, as, toDoor } = deliveryHelpers(() => f);
const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const col = (name: string) => f.h.connection.collection(name);
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
const feeRule = () => f.send("post", "/admin/delivery-rules", { type: "delivery_fee", zoneIds: [ZONE1], minOrder: 0, tiers: [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: null, fee: 0 }] });
const stockGrams = async () => (await col("warehouse_products").findOne({ warehouseId: W1 }))!.stockGrams as number;

/** Places an order. A prepaid one is marked paid directly, since the payments module is separate. */
async function order(items: (s: Shelves) => unknown[], method: "cod" | "online" = "cod", who = A) {
  const s = await shelves();
  const address = (await f.send("post", "/addresses", HOME, who)).body.data.id as string;
  await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: items(s) }, who);
  const q = await f.send("post", "/quotes", { paymentMethod: method }, who);
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  const res = await f.send("post", "/orders", { quoteId: q.body.data.id, paymentMethod: method }, { ...who, "Idempotency-Key": randomUUID() });
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
  return { ...s, group, id: ids[0]!, ids };
}
const tomatoes = (qty: number) => (s: Shelves) => [line(s.tomato.id, s.tomato.v500, qty)];
const cancelOwn = (id: string, body: Record<string, unknown> = { reason: "Ordered by mistake" }, who = A) => f.send("post", `/orders/${id}/cancel`, body, who);
const pending = (id: string) => f.send("post", `/admin/orders/${id}/start-packing`);

/** Takes a cash order all the way to delivered. */
async function delivered(items: (s: Shelves) => unknown[] = tomatoes(2), who = A) {
  const o = await order(items, "cod", who);
  const rider = await onShift();
  await pending(o.id);
  await f.send("post", `/admin/orders/${o.id}/complete-packing`);
  await f.send("post", `/admin/orders/${o.id}/assign`, { riderId: rider.id });
  await toDoor(rider, o.id);
  const code = (await f.get(`/order-groups/${o.group.id}`, who)).body.data.deliveryOtp as string;
  const row = (await col("orders").findOne({ _id: o.id as never }))!;
  expect((await as(rider, "post", `/rider/orders/${o.id}/collect-cash`, { amount: row.amountDue })).status).toBe(200);
  expect((await as(rider, "post", `/rider/orders/${o.id}/deliver`, { otp: code })).status).toBe(200);
  return o;
}
async function photo(who = CUSTOMER_A) {
  const p = asPrincipal(`customer:${who}`);
  const up = await f.send("post", "/media/upload-url", { kind: "refund_photo", contentType: "image/jpeg", sizeBytes: 5000 }, p);
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  f.storage.upload(up.body.data.upload.fields.key);
  await f.send("post", "/media/complete", { mediaId: up.body.data.mediaId }, p);
  return up.body.data.mediaId as string;
}
const ask = (id: string, body: Record<string, unknown>, who = A) => f.send("post", `/orders/${id}/refund-request`, body, who);
const post = (path: string, body?: unknown, who: Record<string, string> = { "X-Test-Actor": "admin" }) => f.send("post", path, body, who);
const adminGet = (path: string, who: Record<string, string> = { "X-Test-Actor": "admin" }) => f.get(path, who);

describe("cancelling my own order", () => {
  it("cancels a cash order with nothing to refund, and puts the stock back", async () => {
    const o = await order(tomatoes(2));
    expect(await stockGrams()).toBe(19_000);
    const res = await cancelOwn(o.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ order: { id: o.id, status: "CANCELLED" }, refund: null, deliveryFeeRefunded: false });
    expect(await stockGrams()).toBe(20_000);
    expect((await col("orders").findOne({ _id: o.id as never }))?.cancel).toMatchObject({ role: "customer", reason: "Ordered by mistake" });
  });

  it("refunds a prepaid order, fee and all, when it is the whole group", async () => {
    await feeRule();
    const o = await order(tomatoes(2), "online");
    const res = await cancelOwn(o.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ order: { id: o.id, status: "CANCELLED" }, refund: { id: expect.any(String), amount: 6400 + 4000, status: "requested" }, deliveryFeeRefunded: true });
    expect(await col("refunds").findOne({ orderId: o.id })).toMatchObject({ amount: 10400, reason: "cancelled", source: "auto", status: "requested", paymentMethod: "online", userId: CUSTOMER_A });
    expect((await col("orders").findOne({ _id: o.id as never }))?.refundStatus).toBe("pending");
  });

  it("keeps the fee when only one delivery of a split order is cancelled", async () => {
    await feeRule();
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)], "online");
    expect(o.ids).toHaveLength(2);
    const first = await cancelOwn(o.ids[0]!);
    expect(first.body.data.deliveryFeeRefunded).toBe(false);
    const row0 = (await col("orders").findOne({ _id: o.ids[0] as never }))!;
    expect(first.body.data.refund.amount).toBe(row0.itemsSubtotal - row0.allocatedDiscount);
    const second = await cancelOwn(o.ids[1]!);
    expect(second.body.data.deliveryFeeRefunded).toBe(true);
    const row1 = (await col("orders").findOne({ _id: o.ids[1] as never }))!;
    expect(second.body.data.refund.amount).toBe(row1.itemsSubtotal - row1.allocatedDiscount + row1.allocatedCharges.reduce((s: number, c: { amount: number }) => s + c.amount, 0));
  });

  it("is refused once packing has started, or for someone else's order, or twice", async () => {
    const o = await order(tomatoes(1));
    expect((await cancelOwn(o.id, undefined, B)).status).toBe(404);
    expect((await cancelOwn("9".repeat(24))).status).toBe(404);
    expect((await cancelOwn(o.id, {})).status).toBe(400);
    expect((await cancelOwn(o.id, { reason: "x" }, {})).status).toBe(401);
    await pending(o.id);
    const late = await cancelOwn(o.id);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: "ORDER_NOT_CANCELLABLE", details: { currentStatus: "PACKING" } });
    const second = await order(tomatoes(1));
    expect((await cancelOwn(second.id)).status).toBe(200);
    expect((await cancelOwn(second.id)).status).toBe(409);
  });

  it("can be limited to before confirmation by a setting", async () => {
    const strict = (await import("../../src/composition/dev2.js")).createDev2Modules({
      connection: f.h.connection, geography: f.geo.geography, customer: (await import("./support/harness.js")).customerFromHeader, orderSettings: { customerCancelUntil: "PLACED" },
    });
    const o = await order(tomatoes(1));
    await expect(strict.orders.service.customerCancel(CUSTOMER_A, o.id, "late")).rejects.toMatchObject({ code: "ORDER_NOT_CANCELLABLE", details: { currentStatus: "CONFIRMED" } });
  });
});

describe("automatic refunds", () => {
  it("are made once for the same event", async () => {
    const o = await order(tomatoes(2), "online");
    const row = (await col("orders").findOne({ _id: o.id as never }))!;
    const make = () => f.mods.refunds.service.createAuto({
      order: { id: o.id, orderNo: row.orderNo, groupId: o.group.id, userId: CUSTOMER_A, warehouseId: W1, paymentMethod: "online" }, amount: 3200, reason: "x", kind: "item_removed", key: `item:${o.id}:0`, by: { userId: null, role: "system" },
    });
    const first = await make();
    const again = await make();
    expect(again).toEqual(first);
    expect(await col("refunds").countDocuments({ orderId: o.id })).toBe(1);
  });
});

describe("asking for a refund after delivery", () => {
  it("is accepted for a delivered order, with a photo, for the line value less its discount share", async () => {
    await f.send("post", "/admin/coupons", { code: "TEN", type: "percent", value: 10, minOrder: 0 });
    const o = await delivered(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.tomato.id, s.tomato.v250, 1)]);
    const mediaId = await photo();
    const res = await ask(o.id, { reason: "damaged_item", items: [{ orderItemIndex: 0, qty: 1 }], customerNote: "Tomatoes were crushed", photoMediaIds: [mediaId] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      orderId: o.id, orderNo: o.group.groupNo, amount: 3200, reason: "damaged_item", source: "customer_request", status: "requested", customerNote: "Tomatoes were crushed",
      photos: [{ mediaId }], items: [{ orderItemIndex: 0, qty: 1 }], rejectReason: null, method: null, reference: null, markedDoneAt: null,
    });
    expect((await col("orders").findOne({ _id: o.id as never }))?.refundStatus).toBe("pending");
    expect(await col("media_files").findOne({ _id: mediaId as never })).toMatchObject({ ownerType: "order", ownerId: o.id });
  });

  it("needs the order to be delivered, within the window, and a photo", async () => {
    const o = await order(tomatoes(2));
    const mediaId = await photo();
    const early = await ask(o.id, { reason: "missing_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [mediaId] });
    expect(early.status).toBe(422);
    expect(early.body.error).toMatchObject({ code: "REFUND_NOT_ALLOWED", details: { reason: "not_delivered" } });
    const d = await delivered();
    const nophoto = await ask(d.id, { reason: "missing_item", items: [{ orderItemIndex: 0, qty: 1 }] });
    expect(nophoto.body.error).toMatchObject({ code: "REFUND_NOT_ALLOWED", details: { reason: "photo_required" } });
    await col("orders").updateOne({ _id: d.id as never }, { $set: { "stamps.deliveredAt": new Date(Date.now() - 25 * 3_600_000) } });
    const late = await ask(d.id, { reason: "missing_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [mediaId] });
    expect(late.body.error).toMatchObject({ code: "REFUND_NOT_ALLOWED", details: { reason: "window_expired" } });
  });

  it("refuses wrong items and quantities, a repeat for the same item, and a photo that is not yours", async () => {
    const d = await delivered();
    const mediaId = await photo();
    const base = { reason: "damaged_item", photoMediaIds: [mediaId] };
    expect((await ask(d.id, { ...base, items: [{ orderItemIndex: 5, qty: 1 }] })).status).toBe(400);
    expect((await ask(d.id, { ...base, items: [{ orderItemIndex: 0, qty: 3 }] })).status).toBe(400);
    expect((await ask(d.id, { ...base, items: [{ orderItemIndex: 0, qty: 1 }, { orderItemIndex: 0, qty: 1 }] })).status).toBe(400);
    expect((await ask(d.id, { ...base, items: [] })).status).toBe(400);
    expect((await ask(d.id, { ...base, reason: "bored", items: [{ orderItemIndex: 0, qty: 1 }] })).status).toBe(400);
    expect((await ask(d.id, { ...base, items: [{ orderItemIndex: 0, qty: 1 }] }, B)).status).toBe(404);
    const theirs = await photo(CUSTOMER_B);
    expect((await ask(d.id, { reason: "damaged_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [theirs] })).status).toBe(404);
    expect((await ask(d.id, { ...base, items: [{ orderItemIndex: 0, qty: 1 }] })).status).toBe(201);
    const again = await ask(d.id, { reason: "damaged_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [await photo()] });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ orderItemIndex: 0 });
  });

  it("cannot ask for more than the order cost", async () => {
    const d = await delivered(tomatoes(1));
    const created = await post("/admin/refunds", { orderId: d.id, amount: 3000, reason: "other" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const res = await ask(d.id, { reason: "damaged_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [await photo()] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "REFUND_EXCEEDS_AMOUNT", details: { refundable: 200 } });
  });

  it("lets a customer see only their own refunds", async () => {
    const d = await delivered();
    const mine = await ask(d.id, { reason: "missing_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [await photo()] });
    const list = await f.get("/refunds", A);
    expect(list.body).toEqual({ data: [mine.body.data], meta: { nextCursor: null } });
    expect((await f.get(`/refunds/${mine.body.data.id}`, A)).body.data).toEqual(mine.body.data);
    expect((await f.get(`/refunds/${mine.body.data.id}`, B)).status).toBe(404);
    expect((await f.get("/refunds", B)).body.data).toEqual([]);
    expect((await f.get("/refunds", {})).status).toBe(401);
    expect((await f.get(`/refunds/${"9".repeat(24)}`, A)).status).toBe(404);
    expect((await f.get("/refunds?limit=0", A)).status).toBe(400);
  });
});

describe("the admin's refunds", () => {
  async function waiting(amount = 3200) {
    const d = await delivered(tomatoes(2));
    const res = await post("/admin/refunds", { orderId: d.id, amount, reason: "damaged_item", note: "Goodwill" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { d, refund: res.body.data };
  }

  it("lists pending and past refunds with the customer and a pending count", async () => {
    const { d, refund } = await waiting();
    await order(tomatoes(1), "online").then(o => cancelOwn(o.id));
    const all = await adminGet("/admin/refunds");
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.meta).toEqual({ pendingCount: 2, nextCursor: null });
    expect(all.body.data.find((r: { id: string }) => r.id === refund.id)).toMatchObject({ customer: { name: "Asha Rai", phone: "+919876543210" }, paymentMethod: "cod", orderNo: d.group.groupNo });
    expect((await adminGet("/admin/refunds?source=admin")).body.data.map((r: { id: string }) => r.id)).toEqual([refund.id]);
    expect((await adminGet("/admin/refunds?source=auto")).body.data).toHaveLength(1);
    expect((await adminGet("/admin/refunds?status=done")).body.data).toEqual([]);
    expect((await adminGet(`/admin/refunds?warehouseId=${W2}`)).body.data).toEqual([]);
    expect((await adminGet("/admin/refunds?limit=1")).body.meta.nextCursor).toEqual(expect.any(String));
    expect((await adminGet("/admin/refunds?status=maybe")).status).toBe(400);
    expect((await adminGet("/admin/refunds", scoped(W2))).body.meta.pendingCount).toBe(0);
    expect((await adminGet(`/admin/refunds?warehouseId=${W1}`, scoped(W2))).status).toBe(403);
    expect((await adminGet("/admin/refunds", viewer)).status).toBe(403);
    expect((await adminGet("/admin/refunds", {})).status).toBe(401);
    expect((await adminGet(`/admin/refunds/${refund.id}`)).body.data).toMatchObject({ id: refund.id, customer: { name: "Asha Rai" } });
    expect((await adminGet(`/admin/refunds/${refund.id}`, scoped(W2))).status).toBe(403);
    expect((await adminGet(`/admin/refunds/${"9".repeat(24)}`)).status).toBe(404);
  });

  it("makes a refund by hand, not more than the order cost", async () => {
    const d = await delivered(tomatoes(1));
    expect((await post("/admin/refunds", { orderId: d.id, amount: 0, reason: "other" })).status).toBe(400);
    expect((await post("/admin/refunds", { orderId: d.id, amount: 3201, reason: "other" })).body.error).toMatchObject({ code: "REFUND_EXCEEDS_AMOUNT", details: { refundable: 3200 } });
    expect((await post("/admin/refunds", { orderId: "9".repeat(24), amount: 100, reason: "other" })).status).toBe(404);
    expect((await post("/admin/refunds", { orderId: d.id, amount: 100, reason: "other" }, viewer)).status).toBe(403);
    expect((await post("/admin/refunds", { orderId: d.id, amount: 100, reason: "other" }, scoped(W2))).status).toBe(403);
    expect((await post("/admin/refunds", { orderId: d.id, amount: 100, reason: "weather" })).status).toBe(400);
    const ok = await post("/admin/refunds", { orderId: d.id, amount: 3200, reason: "other" });
    expect(ok.body.data).toMatchObject({ source: "admin", status: "requested", amount: 3200 });
    expect(await col("audit_log").countDocuments({ action: "refunds.create" })).toBe(2 - 1);
  });

  it("approves, then records that it was paid, and tells the customer", async () => {
    const { d, refund } = await waiting();
    const approved = await post(`/admin/refunds/${refund.id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.status).toBe("approved");
    expect((await post(`/admin/refunds/${refund.id}/approve`)).status).toBe(409);
    const done = await post(`/admin/refunds/${refund.id}/mark-done`, { method: "razorpay_dashboard", reference: "rfnd_Nz3", note: "Refunded from dashboard" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: "done", method: "razorpay_dashboard", reference: "rfnd_Nz3", note: "Refunded from dashboard", markedDoneAt: expect.stringMatching(/Z$/) });
    expect((await col("orders").findOne({ _id: d.id as never }))?.refundStatus).toBe("done");
    const again = await post(`/admin/refunds/${refund.id}/mark-done`, { method: "upi" });
    expect(again.status).toBe(409);
    expect((await col("refunds").findOne({ _id: refund.id as never }))).toMatchObject({ method: "razorpay_dashboard", status: "done" });
    await f.runJobs();
    expect(f.msg.pushed.map(p => p.title)).toEqual(expect.arrayContaining(["Refund approved", "Refund paid"]));
    expect(f.msg.whatsapped.some(m => m.templateName === "refund_done_v1")).toBe(true);
    expect(await col("audit_log").countDocuments({ action: { $in: ["refunds.approve", "refunds.mark_done"] } })).toBe(2);
  });

  it("can be paid without a separate approval, and two clicks at once pay it once", async () => {
    const { refund } = await waiting();
    const results = await Promise.all([1, 2, 3].map(() => post(`/admin/refunds/${refund.id}/mark-done`, { method: "cash" })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409, 409]);
    expect(await col("audit_log").countDocuments({ action: "refunds.mark_done" })).toBe(1);
  });

  it("rejects with a reason, which closes it and tells the customer", async () => {
    const d = await delivered();
    const asked = await ask(d.id, { reason: "damaged_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [await photo()] });
    const id = asked.body.data.id as string;
    expect((await post(`/admin/refunds/${id}/reject`, {})).status).toBe(400);
    const res = await post(`/admin/refunds/${id}/reject`, { reason: "Photo does not show damage" });
    expect(res.body.data).toMatchObject({ status: "rejected", rejectReason: "Photo does not show damage" });
    expect((await col("orders").findOne({ _id: d.id as never }))?.refundStatus).toBe("none");
    expect((await post(`/admin/refunds/${id}/reject`, { reason: "again" })).status).toBe(409);
    expect((await post(`/admin/refunds/${id}/mark-done`, { method: "cash" })).status).toBe(409);
    expect((await post(`/admin/refunds/${id}/approve`)).status).toBe(409);
    // A rejected request frees the item, so the customer can ask again.
    expect((await ask(d.id, { reason: "damaged_item", items: [{ orderItemIndex: 0, qty: 1 }], photoMediaIds: [await photo()] })).status).toBe(201);
    await f.runJobs();
    expect(f.msg.pushed.some(p => p.title === "Refund not approved")).toBe(true);
  });

  it("checks who may do what, and the request", async () => {
    const { refund } = await waiting();
    const bodies: Record<string, unknown> = { approve: undefined, reject: { reason: "x" }, "mark-done": { method: "cash" } };
    for (const path of ["approve", "reject", "mark-done"]) {
      expect((await post(`/admin/refunds/${refund.id}/${path}`, bodies[path], viewer)).status, path).toBe(403);
      expect((await post(`/admin/refunds/${refund.id}/${path}`, bodies[path], scoped(W2))).status, path).toBe(403);
      expect((await post(`/admin/refunds/${refund.id}/${path}`, bodies[path], {})).status, path).toBe(401);
      expect((await post(`/admin/refunds/${"9".repeat(24)}/${path}`, bodies[path])).status, path).toBe(404);
    }
    expect((await post(`/admin/refunds/${refund.id}/mark-done`, { method: "gold" })).status).toBe(400);
    expect((await post(`/admin/refunds/${refund.id}/mark-done`, { method: "cash" }, scoped(W1))).status).toBe(200);
  });

  it("will not mark more paid than the order cost", async () => {
    const d = await delivered(tomatoes(1));
    const a = (await post("/admin/refunds", { orderId: d.id, amount: 3200, reason: "other" })).body.data;
    expect((await post(`/admin/refunds/${a.id}/mark-done`, { method: "cash" })).status).toBe(200);
    await col("refunds").insertOne({ ...(await col("refunds").findOne({ _id: a.id as never }))!, _id: "e".repeat(24) as never, status: "requested", markedDoneAt: null, method: null });
    const over = await post(`/admin/refunds/${"e".repeat(24)}/mark-done`, { method: "cash" });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("REFUND_EXCEEDS_AMOUNT");
  });
});
