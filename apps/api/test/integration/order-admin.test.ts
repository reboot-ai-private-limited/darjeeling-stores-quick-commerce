import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDev2Modules } from "../../src/composition/dev2.js";
import { CUSTOMER_A, CUSTOMER_B, W1, W2, ZONE1, admin, customer, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { LOC1 } from "./support/fake-geography.js";
import { actorFromHeader, api, customerFromHeader } from "./support/harness.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("order_admin_integration_test", { realOrders: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); rev = 0; shelf = null; });

const { onShift, as, toDoor } = deliveryHelpers(() => f);
const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const col = (name: string) => f.h.connection.collection(name);
const HOME = { label: "Home", line1: "Cedar Villa, 2nd floor", localityId: LOC1, pincode: "734101", landmark: "Opposite Planters Club gate", contactName: "Asha Rai", contactPhone: "98765 43210", location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18 };
let rev = 0;
const line = (productId: string, variantId: string, qty: number) => ({ productId, variantId, qty });
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
const stockGrams = async () => (await col("warehouse_products").findOne({ warehouseId: W1 }))!.stockGrams as number;
const feeRule = () => f.send("post", "/admin/delivery-rules", { type: "delivery_fee", zoneIds: [ZONE1], minOrder: 0, tiers: [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: null, fee: 0 }] });

/** Places a cash order for the lines chosen. */
async function order(items: (s: Shelves) => unknown[], who = A, paymentMethod: "cod" | "online" = "cod") {
  const s = await shelves();
  const address = (await f.send("post", "/addresses", HOME, who)).body.data.id as string;
  await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: items(s) }, who);
  const q = await f.send("post", "/quotes", { paymentMethod }, who);
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  const res = await f.send("post", "/orders", { quoteId: q.body.data.id, paymentMethod }, { ...who, "Idempotency-Key": randomUUID() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const group = res.body.data.group;
  return { ...s, group, id: group.children[0].id as string, ids: group.children.map((c: { id: string }) => c.id) as string[] };
}
const two = (s: Shelves) => [line(s.tomato.id, s.tomato.v500, 2), line(s.tomato.id, s.tomato.v250, 1)];
const post = (path: string, body?: unknown, who = admin) => f.send("post", path, body, who);
const adminOrder = async (id: string) => (await f.get(`/admin/orders/${id}`)).body.data;

describe("looking at orders", () => {
  it("shows the whole order to staff: warehouse, customer, address, lines, charges and a timeline", async () => {
    await feeRule();
    const o = await order(s => two(s));
    const res = await f.get(`/admin/orders/${o.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      id: o.id, orderNo: o.group.groupNo, groupId: o.group.id, warehouse: { id: W1, name: "Chowrasta store" }, status: "CONFIRMED", paymentMethod: "cod", paymentStatus: "cod_pending", refundStatus: "none",
      customer: { id: CUSTOMER_A, name: "Asha Rai", phone: "+919876543210" },
      address: { line1: "Cedar Villa, 2nd floor", landmark: "Opposite Planters Club gate", locality: "Chowrasta", contactName: "Asha Rai", location: { lat: 27.041, lng: 88.2663 } },
      itemsSubtotal: 8200, allocatedDiscount: 0, allocatedCharges: [{ type: "delivery_fee", amount: 4000 }], amountDue: 12200, rider: null, scheduledWindow: null, isPreOrder: false, notes: [], delivery: null, collection: null,
    });
    expect(res.body.data.items.map((i: { index: number; name: string; qty: number; lineTotal: number; status: string }) => [i.index, i.name, i.qty, i.lineTotal, i.status])).toEqual([[0, "Fresh Tomato", 2, 6400, "ok"], [1, "Fresh Tomato", 1, 1800, "ok"]]);
    expect(res.body.data.timeline.map((t: { type: string; to: string }) => [t.type, t.to])).toEqual([["placed", "CONFIRMED".replace("CONFIRMED", "PLACED")], ["status_change", "CONFIRMED"]]);
    expect(res.body.data.timeline[0].actor.role).toBe("customer");
    expect(res.body.data.timeline[1].actor.role).toBe("system");
  });

  it("shows a group with all its children", async () => {
    await feeRule();
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)]);
    const res = await f.get(`/admin/order-groups/${o.group.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: o.group.id, groupNo: o.group.groupNo, status: "ACTIVE", paymentMethod: "cod", couponCode: null, customerId: CUSTOMER_A, pricing: { subtotal: 11400, total: 15400 } });
    expect(res.body.data.children.map((c: { orderNo: string }) => c.orderNo)).toEqual([`${o.group.groupNo}-A`, `${o.group.groupNo}-B`]);
    expect((await f.get(`/admin/order-groups/${"9".repeat(24)}`)).status).toBe(404);
    expect((await f.get(`/admin/order-groups/${o.group.id}`, scoped(W1))).status).toBe(403);
  });

  it("lists, filters, searches and pages orders", async () => {
    const a = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const b = await order(s => [line(s.milk.id, s.milk.v1, 1)], B);
    await post(`/admin/orders/${a.id}/start-packing`);
    const all = await f.get("/admin/orders");
    expect(all.body.data.map((o: { id: string }) => o.id)).toEqual([b.id, a.id]);
    const ids = async (query: string, who = admin) => (await f.get(`/admin/orders?${query}`, who)).body.data.map((o: { id: string }) => o.id);
    expect(await ids(`warehouseId=${W2}`)).toEqual([b.id]);
    expect(await ids("status=PACKING")).toEqual([a.id]);
    expect(await ids("status=PACKING,CONFIRMED")).toEqual([b.id, a.id]);
    expect(await ids(`q=${a.group.groupNo}`)).toEqual([a.id]);
    expect(await ids("q=asha")).toEqual([b.id, a.id]);
    expect(await ids("q=98765")).toEqual([b.id, a.id]);
    expect(await ids("q=nobody")).toEqual([]);
    expect(await ids("paymentStatus=cod_pending")).toHaveLength(2);
    expect(await ids("paymentStatus=paid")).toEqual([]);
    expect(await ids("isPreOrder=true")).toEqual([]);
    expect(await ids("isPreOrder=false")).toHaveLength(2);
    expect(await ids(`from=${new Date(Date.now() + 3_600_000).toISOString()}`)).toEqual([]);
    expect(await ids(`to=${new Date(Date.now() + 3_600_000).toISOString()}`)).toHaveLength(2);
    const page = await f.get("/admin/orders?limit=1");
    expect(page.body.meta.nextCursor).toEqual(a.id.length === 24 ? expect.any(String) : null);
    expect((await f.get(`/admin/orders?limit=1&cursor=${page.body.meta.nextCursor}`)).body.data.map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect(await ids("", scoped(W2))).toEqual([b.id]);
    expect((await f.get(`/admin/orders?warehouseId=${W1}`, scoped(W2))).status).toBe(403);
    expect((await f.get("/admin/orders?status=NOPE")).status).toBe(400);
    expect((await f.get("/admin/orders", viewer)).status).toBe(403);
    expect((await f.get("/admin/orders", {})).status).toBe(401);
  });

  it("limits staff to the warehouses they manage", async () => {
    const a = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    expect((await f.get(`/admin/orders/${a.id}`, scoped(W1))).status).toBe(200);
    expect((await f.get(`/admin/orders/${a.id}`, scoped(W2))).status).toBe(403);
    expect((await f.get(`/admin/orders/${"9".repeat(24)}`)).status).toBe(404);
    expect((await f.get("/admin/orders/nope")).status).toBe(404);
    expect((await post(`/admin/orders/${a.id}/start-packing`, undefined, scoped(W2))).status).toBe(403);
  });

  it("follows new and changed orders with a cursor", async () => {
    const start = await f.get("/admin/orders/changes");
    expect(start.body).toEqual({ data: [], meta: { cursor: "c_0", newCount: 0 } });
    const a = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const first = await f.get(`/admin/orders/changes?since=${start.body.meta.cursor}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0]).toEqual({
      event: "created", order: {
        id: a.id, orderNo: a.group.groupNo, groupId: a.group.id, warehouseId: W1, status: "CONFIRMED", itemCount: 1, amountDue: 3200, paymentMethod: "cod", customerName: "Asha Rai", locality: "Chowrasta",
        riderId: null, riderName: null, ackStatus: null, promisedAt: expect.stringMatching(/Z$/), delayed: false, updatedAt: expect.stringMatching(/Z$/),
      },
    });
    expect(first.body.meta.newCount).toBe(1);
    expect((await f.get(`/admin/orders/changes?since=${first.body.meta.cursor}`)).body).toMatchObject({ data: [], meta: { cursor: first.body.meta.cursor, newCount: 0 } });
    await post(`/admin/orders/${a.id}/start-packing`);
    const next = await f.get(`/admin/orders/changes?since=${first.body.meta.cursor}`);
    expect(next.body.data.map((d: { event: string; order: { status: string } }) => [d.event, d.order.status])).toEqual([["status_changed", "PACKING"]]);
    expect((await f.get(`/admin/orders/changes?since=${start.body.meta.cursor}`)).body.data.map((d: { event: string }) => d.event)).toEqual(["created"]);
    expect((await f.get("/admin/orders/changes?since=garbage")).status).toBe(400);
    expect((await f.get(`/admin/orders/changes?since=c_0`, scoped(W2))).body.data).toEqual([]);
    expect((await f.get(`/admin/orders/changes?since=c_0&statuses=READY`)).body.data).toEqual([]);
    expect((await f.get("/admin/orders/changes", viewer)).status).toBe(403);
  });

  it("marks an order that has waited too long as delayed", async () => {
    const a = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    await col("orders").updateOne({ _id: a.id as never }, { $set: { "stamps.confirmedAt": new Date(Date.now() - 30 * 60_000) } });
    await post(`/admin/orders/${a.id}/start-packing`);
    await col("orders").updateOne({ _id: a.id as never }, { $set: { "stamps.confirmedAt": new Date(Date.now() - 30 * 60_000) } });
    const data = (await f.get("/admin/orders/changes?since=c_0")).body.data;
    expect(data.find((d: { order: { id: string } }) => d.order.id === a.id).order.delayed).toBe(true);
  });
});

describe("confirming, packing and handing over", () => {
  it("moves an order through the warehouse steps and refuses steps out of order", async () => {
    const a = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const early = await post(`/admin/orders/${a.id}/complete-packing`);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { from: "CONFIRMED", to: "READY", allowed: ["PACKING", "CANCELLED"] } });
    const packing = await post(`/admin/orders/${a.id}/start-packing`);
    expect(packing.status, JSON.stringify(packing.body)).toBe(200);
    expect(packing.body.data.status).toBe("PACKING");
    expect((await post(`/admin/orders/${a.id}/start-packing`)).status).toBe(409);
    const ready = await post(`/admin/orders/${a.id}/complete-packing`);
    expect(ready.body.data.status).toBe("READY");
    expect(ready.body.data.timeline.map((t: { to: string }) => t.to)).toEqual(["PLACED", "CONFIRMED", "PACKING", "READY"]);
    expect((await col("orders").findOne({ _id: a.id as never }))?.stamps).toMatchObject({ confirmedAt: expect.any(Date), packingAt: expect.any(Date), readyAt: expect.any(Date) });
    expect((await post(`/admin/orders/${"9".repeat(24)}/start-packing`)).status).toBe(404);
    expect((await post(`/admin/orders/${a.id}/start-packing`, undefined, viewer)).status).toBe(403);
    expect((await post(`/admin/orders/${a.id}/start-packing`, undefined, {})).status).toBe(401);
  });

  it("waits for an admin to confirm when the setting says so", async () => {
    const manual = createDev2Modules({
      connection: f.h.connection, auth: actorFromHeader, customer: customerFromHeader, geography: f.geo.geography, orderSettings: { confirmMode: "manual" }, money: f.money.port,
    });
    const app = f.h.appWith(manual.routes);
    const s = await shelves();
    const address = (await f.send("post", "/addresses", HOME, A)).body.data.id as string;
    await f.send("put", "/cart", { clientRev: 1, addressId: address, items: [line(s.tomato.id, s.tomato.v500, 1)] }, A);
    const q = await f.send("post", "/quotes", { paymentMethod: "cod" }, A);
    const placed = await request(app).post(`${api}/orders`).set({ ...A, "Idempotency-Key": randomUUID() }).send({ quoteId: q.body.data.id, paymentMethod: "cod" });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.data.group.children[0].status).toBe("PLACED");
    const id = placed.body.data.group.children[0].id as string;
    const confirmed = await request(app).post(`${api}/admin/orders/${id}/confirm`).set(admin);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("CONFIRMED");
    expect((await request(app).post(`${api}/admin/orders/${id}/confirm`).set(admin)).status).toBe(409);
    await f.runJobs();
    expect(f.msg.pushed.some(p => p.title === "Order confirmed")).toBe(false);
  });
});

describe("items missing at packing", () => {
  it("removes a line: stock goes back, the cash due drops, the fee stays", async () => {
    await feeRule();
    const o = await order(s => two(s));
    expect(await stockGrams()).toBe(20_000 - 1000 - 250);
    await post(`/admin/orders/${o.id}/start-packing`);
    const res = await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "damaged" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.refund).toBeNull();
    expect(res.body.data.notifiedCustomer).toBe(true);
    expect(res.body.data.order).toMatchObject({ itemsSubtotal: 1800, amountDue: 1800 + 4000, allocatedCharges: [{ type: "delivery_fee", amount: 4000 }] });
    expect(res.body.data.order.items[0]).toMatchObject({ index: 0, qty: 0, lineTotal: 0, status: "unavailable", unavailableReason: "damaged" });
    expect(await stockGrams()).toBe(20_000 - 250);
    expect((await f.get(`/order-groups/${o.group.id}`, A)).body.data.pricing.total).toBe(5800);
    await f.runJobs();
    expect(f.msg.pushed.some(p => p.title === "An item is unavailable")).toBe(false);
    expect(await col("audit_log").countDocuments({ action: "orders.item_unavailable" })).toBe(1);
    expect((await adminOrder(o.id)).timeline.map((t: { type: string }) => t.type)).toContain("item_unavailable");
  });

  it("reduces a line to what is there, and shares the discount fairly", async () => {
    await f.send("post", "/admin/coupons", { code: "TEN", type: "percent", value: 10, minOrder: 0 });
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 4)]);
    expect(o.id).toBeTruthy();
    await f.send("post", "/cart/coupon", { code: "TEN" }, A).catch(() => undefined);
    const res = await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "one spoiled", availableQty: 3 });
    expect(res.body.data.order.items[0]).toMatchObject({ qty: 3, lineTotal: 9600, status: "reduced" });
    expect(res.body.data.order.itemsSubtotal).toBe(9600);
    expect(res.body.data.order.amountDue).toBe(9600);
    expect(await stockGrams()).toBe(20_000 - 1500);
  });

  it("refunds a prepaid order for the line, less its share of the discount", async () => {
    const o = await order(s => two(s), A, "online");
    await col("orders").updateOne({ _id: o.id as never }, { $set: { status: "PACKING", paymentStatus: "paid", paidAmount: 8200 } });
    const res = await post(`/admin/orders/${o.id}/items/1/unavailable`, { reason: "out of stock" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.refund).toEqual({ id: "refund-1", amount: 1800, status: "requested" });
    expect(f.money.refunds).toEqual([expect.objectContaining({ orderId: o.id, amount: 1800, kind: "item_removed" })]);
    expect((await col("orders").findOne({ _id: o.id as never }))).toMatchObject({ refundStatus: "pending", paidAmount: 6400, amountDue: 0 });
  });

  it("cancels the order when every line is gone", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const res = await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "gone" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.order.status).toBe("CANCELLED");
    expect(await stockGrams()).toBe(20_000);
  });

  it("reduces a quantity with an edit, only downward", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 4)]);
    const res = await f.send("put", `/admin/orders/${o.id}/items/0`, { qty: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({ qty: 1, lineTotal: 3200, status: "reduced" });
    expect((await f.send("put", `/admin/orders/${o.id}/items/0`, { qty: 5 })).status).toBe(400);
    expect((await f.send("put", `/admin/orders/${o.id}/items/0`, { qty: 1 })).status).toBe(400);
    expect((await f.send("put", `/admin/orders/${o.id}/items/0`, { qty: 0 })).status).toBe(400);
    expect((await f.send("put", `/admin/orders/${o.id}/items/7`, { qty: 1 })).status).toBe(404);
    expect((await f.send("put", `/admin/orders/${o.id}/items/x`, { qty: 1 })).status).toBe(400);
  });

  it("checks the request and the state", async () => {
    const o = await order(s => two(s));
    expect((await post(`/admin/orders/${o.id}/items/0/unavailable`, {})).status).toBe(400);
    expect((await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "x", availableQty: 2 })).status).toBe(400);
    expect((await post(`/admin/orders/${o.id}/items/9/unavailable`, { reason: "x" })).status).toBe(404);
    expect((await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "x" }, scoped(W2))).status).toBe(403);
    expect((await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "x" }, viewer)).status).toBe(403);
    expect((await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "x" })).status).toBe(200);
    expect((await post(`/admin/orders/${o.id}/items/0/unavailable`, { reason: "again" })).status).toBe(400);
    await col("orders").updateOne({ _id: o.id as never }, { $set: { status: "PICKED_UP" } });
    expect((await post(`/admin/orders/${o.id}/items/1/unavailable`, { reason: "late" })).status).toBe(409);
  });
});

describe("cancelling", () => {
  it("cancels before pickup: stock back, customer told, event and audit written", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    expect(await stockGrams()).toBe(19_000);
    const res = await post(`/admin/orders/${o.id}/cancel`, { reason: "Customer called to cancel" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(await stockGrams()).toBe(20_000);
    expect((await col("orders").findOne({ _id: o.id as never }))).toMatchObject({ cancel: { role: expect.any(String), reason: "Customer called to cancel" }, stamps: { cancelledAt: expect.any(Date) } });
    expect(await col("audit_log").countDocuments({ action: "orders.cancel" })).toBe(1);
    await f.runJobs();
    expect(f.msg.pushed.some(p => p.title === "Order cancelled")).toBe(false);
    expect((await f.get(`/order-groups/${o.group.id}`, A)).body.data.status).toBe("CANCELLED");
  });

  it("takes the order back from its rider", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const rider = await onShift();
    await post(`/admin/orders/${o.id}/start-packing`);
    await post(`/admin/orders/${o.id}/complete-packing`);
    expect((await post(`/admin/orders/${o.id}/assign`, { riderId: rider.id })).status).toBe(200);
    expect((await col("riders").findOne({ _id: rider.id as never }))?.activeOrderCount).toBe(1);
    expect((await post(`/admin/orders/${o.id}/cancel`, { reason: "Changed mind" })).status).toBe(200);
    expect((await col("riders").findOne({ _id: rider.id as never }))?.activeOrderCount).toBe(0);
    expect(await col("assignments").findOne({ orderId: o.id })).toMatchObject({ live: false, status: "cancelled" });
  });

  it("refunds a prepaid order, with the fees only when the whole group goes", async () => {
    await feeRule();
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2), line(s.milk.id, s.milk.v1, 1)], A, "online");
    expect(o.ids).toHaveLength(2);
    await col("orders").updateMany({ groupId: o.group.id }, { $set: { paymentStatus: "paid", status: "PLACED" } });
    for (const id of o.ids) { const row = await col("orders").findOne({ _id: id as never }); await col("orders").updateOne({ _id: id as never }, { $set: { paidAmount: row!.itemsSubtotal - row!.allocatedDiscount + row!.allocatedCharges.reduce((s: number, c: { amount: number }) => s + c.amount, 0) } }); }
    const first = await post(`/admin/orders/${o.ids[0]}/cancel`, { reason: "One side" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const row0 = await col("orders").findOne({ _id: o.ids[0] as never });
    expect(f.money.refunds[0]).toMatchObject({ orderId: o.ids[0], amount: row0!.itemsSubtotal });
    await post(`/admin/orders/${o.ids[1]}/cancel`, { reason: "Other side" });
    const row1 = await col("orders").findOne({ _id: o.ids[1] as never });
    expect(f.money.refunds[1]).toMatchObject({ orderId: o.ids[1], amount: row1!.itemsSubtotal + row1!.allocatedCharges.reduce((s: number, c: { amount: number }) => s + c.amount, 0) });
    expect(row1!.refundStatus).toBe("pending");
  });

  it("is refused once the order has been picked up, and needs a reason", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    expect((await post(`/admin/orders/${o.id}/cancel`, {})).status).toBe(400);
    expect((await post(`/admin/orders/${o.id}/cancel`, { reason: "x" }, viewer)).status).toBe(403);
    expect((await post(`/admin/orders/${o.id}/cancel`, { reason: "x" }, scoped(W2))).status).toBe(403);
    await col("orders").updateOne({ _id: o.id as never }, { $set: { status: "PICKED_UP" } });
    const late = await post(`/admin/orders/${o.id}/cancel`, { reason: "too late" });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: "ORDER_NOT_CANCELLABLE", details: { status: "PICKED_UP" } });
    expect((await post(`/admin/orders/${"9".repeat(24)}/cancel`, { reason: "x" })).status).toBe(404);
  });

  it("a cancelled order cannot be cancelled again", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    await post(`/admin/orders/${o.id}/cancel`, { reason: "x" });
    expect((await post(`/admin/orders/${o.id}/cancel`, { reason: "again" })).status).toBe(409);
    expect(await stockGrams()).toBe(20_000);
  });
});

describe("admin overrides and notes", () => {
  it("forces a status with a reason, and audits it", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const res = await post(`/admin/orders/${o.id}/force-status`, { to: "READY", reason: "Order was packed but not marked" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("READY");
    expect(res.body.data.timeline.at(-1)).toMatchObject({ type: "status_change", from: "CONFIRMED", to: "READY", meta: { reason: "Order was packed but not marked", forced: true } });
    expect(await col("audit_log").countDocuments({ action: "orders.force_status" })).toBe(1);
    expect((await post(`/admin/orders/${o.id}/force-status`, { to: "READY" })).status).toBe(400);
    expect((await post(`/admin/orders/${o.id}/force-status`, { to: "FLYING", reason: "x" })).status).toBe(400);
    expect((await post(`/admin/orders/${o.id}/force-status`, { to: "PACKING", reason: "x" }, viewer)).status).toBe(403);
    expect((await post(`/admin/orders/${"9".repeat(24)}/force-status`, { to: "READY", reason: "x" })).status).toBe(404);
  });

  it("adds internal notes that show on the order", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const note = await post(`/admin/orders/${o.id}/notes`, { text: "Customer wants ripe tomatoes" });
    expect(note.status).toBe(201);
    expect(note.body.data).toEqual({ text: "Customer wants ripe tomatoes", by: "000000000000000000000001", at: expect.stringMatching(/Z$/) });
    expect((await adminOrder(o.id)).notes).toEqual([note.body.data]);
    expect((await post(`/admin/orders/${o.id}/notes`, { text: "" })).status).toBe(400);
    expect((await post(`/admin/orders/${o.id}/notes`, { text: "x" }, viewer)).status).toBe(403);
  });

  it("prints a bill or a packing slip as a page", async () => {
    await feeRule();
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    await col("orders").updateOne({ _id: o.id as never }, { $set: { "items.0.name": "Tomato <b>&</b>" } });
    const bill = await f.get(`/admin/orders/${o.id}/print?type=bill`);
    expect(bill.status).toBe(200);
    expect(bill.headers["content-type"]).toMatch(/text\/html/);
    expect(bill.text).toContain(o.group.groupNo);
    expect(bill.text).toContain("Tomato &lt;b&gt;&amp;&lt;/b&gt;");
    expect(bill.text).not.toContain("<b>&</b>");
    expect(bill.text).toContain("Pay on delivery");
    expect(bill.text).toContain("₹104.00");
    const slip = await f.get(`/admin/orders/${o.id}/print?type=slip`);
    expect(slip.text).toContain("Packing slip");
    expect(slip.text).toContain("&#9744;");
    expect(slip.text).not.toContain("Pay on delivery");
    expect((await f.get(`/admin/orders/${o.id}/print`)).text).toContain("Bill");
    expect((await f.get(`/admin/orders/${o.id}/print?type=poster`)).status).toBe(400);
    expect((await f.get(`/admin/orders/${o.id}/print`, scoped(W2))).status).toBe(403);
  });
});

describe("a whole delivery on the real orders", () => {
  it("runs from the customer's tap to a delivered order, with the code, the cash and the stock all consistent", async () => {
    await feeRule();
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const rider = await onShift();
    expect((await post(`/admin/orders/${o.id}/start-packing`)).status).toBe(200);
    expect((await post(`/admin/orders/${o.id}/complete-packing`)).status).toBe(200);
    const assigned = await post(`/admin/orders/${o.id}/assign`, { riderId: rider.id });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect((await f.get(`/orders/${o.id}`, A)).body.data.rider).toMatchObject({ name: rider.name });

    const code = (await f.get(`/order-groups/${o.group.id}`, A)).body.data.deliveryOtp as string;
    expect(code).toMatch(/^\d{4}$/);
    await toDoor(rider, o.id);
    expect((await as(rider, "get", `/rider/orders/${o.id}`)).body.data).not.toHaveProperty("otp");

    const wrong = await as(rider, "post", `/rider/orders/${o.id}/verify-otp`, { otp: code === "0000" ? "1111" : "0000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.details.attemptsLeft).toBe(4);
    expect((await as(rider, "post", `/rider/orders/${o.id}/deliver`, { otp: code })).status).toBe(409);
    const cash = await as(rider, "post", `/rider/orders/${o.id}/collect-cash`, { amount: 10400 });
    expect(cash.status, JSON.stringify(cash.body)).toBe(200);
    expect(await col("orders").findOne({ _id: o.id as never })).toMatchObject({ paymentStatus: "cod_collected", collection: { method: "cash", amount: 10400 } });
    const done = await as(rider, "post", `/rider/orders/${o.id}/deliver`, { otp: code });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: "DELIVERED", groupStatus: "DELIVERED" });

    const admin_ = await adminOrder(o.id);
    expect(admin_).toMatchObject({ status: "DELIVERED", collection: { method: "cash", amount: 10400 }, delivery: { offline: false } });
    expect(admin_.timeline.map((t: { to: string | null }) => t.to).filter(Boolean)).toEqual(["PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED"]);
    expect((await f.get(`/order-groups/${o.group.id}`, A)).body.data).toMatchObject({ status: "DELIVERED", deliveryOtp: null });
    expect(await stockGrams()).toBe(19_000);
    expect((await f.get(`/orders/${o.id}/tracking`, A)).body.data).toMatchObject({ status: "DELIVERED", deliveryOtp: null, rider: null });
    expect((await as(rider, "get", "/rider/history")).body.meta.deliveredToday).toBe(1);
  });

  it("locks the code after five wrong tries", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const rider = await onShift();
    await post(`/admin/orders/${o.id}/start-packing`);
    await post(`/admin/orders/${o.id}/complete-packing`);
    await post(`/admin/orders/${o.id}/assign`, { riderId: rider.id });
    const code = (await f.get(`/order-groups/${o.group.id}`, A)).body.data.deliveryOtp as string;
    const bad = code === "0000" ? "1111" : "0000";
    await toDoor(rider, o.id);
    for (let i = 0; i < 5; i++) await as(rider, "post", `/rider/orders/${o.id}/verify-otp`, { otp: bad });
    const locked = await as(rider, "post", `/rider/orders/${o.id}/verify-otp`, { otp: code });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("OTP_LOCKED");
  });

  it("puts the goods back on the shelf only when a failed delivery comes back in good condition", async () => {
    const good = await order(s => [line(s.tomato.id, s.tomato.v500, 2)]);
    const spoiled = await order(s => [line(s.tomato.id, s.tomato.v500, 2)], B);
    expect(await stockGrams()).toBe(18_000);
    const rider = await onShift();
    for (const o of [good, spoiled]) {
      await post(`/admin/orders/${o.id}/start-packing`);
      await post(`/admin/orders/${o.id}/complete-packing`);
      await post(`/admin/orders/${o.id}/assign`, { riderId: rider.id });
      await toDoor(rider, o.id);
      expect((await as(rider, "post", `/rider/orders/${o.id}/failed`, { reason: "customer_unreachable" })).status).toBe(200);
      await col("riders").updateOne({ _id: rider.id as never }, { $set: { activeOrderCount: 0 } });
    }
    const goodRes = await post(`/admin/orders/${good.id}/failed/resolve`, { action: "cancel_return", goodsCondition: "good" });
    expect(goodRes.status, JSON.stringify(goodRes.body)).toBe(200);
    expect(goodRes.body.data.order.status).toBe("CANCELLED");
    expect(await stockGrams()).toBe(19_000);
    const spoiledRes = await post(`/admin/orders/${spoiled.id}/failed/resolve`, { action: "cancel_return", goodsCondition: "spoiled" });
    expect(spoiledRes.status).toBe(200);
    expect(await stockGrams()).toBe(19_000);
    const redo = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    expect(redo.id).toBeTruthy();
  });

  it("sends a failed order out again", async () => {
    const o = await order(s => [line(s.tomato.id, s.tomato.v500, 1)]);
    const rider = await onShift();
    await post(`/admin/orders/${o.id}/start-packing`);
    await post(`/admin/orders/${o.id}/complete-packing`);
    await post(`/admin/orders/${o.id}/assign`, { riderId: rider.id });
    await toDoor(rider, o.id);
    await as(rider, "post", `/rider/orders/${o.id}/failed`, { reason: "weather", note: "Landslide" });
    expect((await adminOrder(o.id)).status).toBe("FAILED_DELIVERY");
    const again = await post(`/admin/orders/${o.id}/failed/resolve`, { action: "redispatch" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await adminOrder(o.id)).status).toBe("READY");
    expect((await col("orders").findOne({ _id: o.id as never }))?.failedDelivery).toBeNull();
  });
});
