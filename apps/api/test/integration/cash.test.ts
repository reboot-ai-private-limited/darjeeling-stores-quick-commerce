import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, ZONE2, admin, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { resetRiderCounter, type TestRider } from "./support/riders.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("cash_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); resetRiderCounter(); });

const { col, ready, onShift, assigned, as, toDoor } = deliveryHelpers(() => f);
const cashOf = async (r: TestRider) => (await as(r, "get", "/rider/cash")).body.data.cashInHand as number;
/** An order at the customer's door with the rider ready to take payment. */
async function atDoor(r: TestRider, over: Record<string, unknown> = {}) {
  const { order } = await assigned(r, over);
  await toDoor(r, order.id);
  return order;
}
const collectCash = (r: TestRider, id: string, body: Record<string, unknown> = { amount: 8800 }) => as(r, "post", `/rider/orders/${id}/collect-cash`, body);
const collectUpi = (r: TestRider, id: string, body: Record<string, unknown> = { amount: 8800 }) => as(r, "post", `/rider/orders/${id}/collect-upi`, body);

describe("taking cash at the door", () => {
  it("records the cash, adds it to the rider's hand, and marks the order so it can be delivered", async () => {
    const r = await onShift();
    const order = await atDoor(r);
    const res = await collectCash(r, order.id, { amount: 8800, collectedAt: new Date().toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ orderId: order.id, paymentStatus: "cod_collected", ledgerEntryId: expect.stringMatching(/^[a-f0-9]{24}$/), cashInHand: 8800 });
    expect(f.orders.collections).toEqual([expect.objectContaining({ orderId: order.id, collection: { method: "cash", amount: 8800 }, by: { kind: "rider", id: r.userId } })]);
    expect(await col("cash_ledger").findOne({ _id: res.body.data.ledgerEntryId as never })).toMatchObject({
      riderId: r.id, warehouseId: W1, type: "collected", amount: 8800, orderId: order.id, orderNo: order.orderNo, balanceAfter: 8800, flags: [],
    });
    // The rider can now deliver without anyone setting the flag by hand.
    expect((await as(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" })).status).toBe(200);
  });

  it("answers a repeat with the first result and adds nothing", async () => {
    const r = await onShift();
    const order = await atDoor(r);
    const first = await collectCash(r, order.id);
    const again = await collectCash(r, order.id);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ ...first.body.data, duplicate: true });
    expect(await col("cash_ledger").countDocuments({ orderId: order.id })).toBe(1);
    expect(await cashOf(r)).toBe(8800);
  });

  it("adds the cash once even when two calls arrive at the same moment", async () => {
    const r = await onShift();
    const order = await atDoor(r);
    const results = await Promise.all([collectCash(r, order.id), collectCash(r, order.id), collectCash(r, order.id)]);
    expect(results.map(x => x.status)).toEqual([200, 200, 200]);
    expect(results.filter(x => x.body.data.duplicate).length).toBeGreaterThanOrEqual(1);
    expect(await col("cash_ledger").countDocuments({ orderId: order.id })).toBe(1);
    expect(await cashOf(r)).toBe(8800);
  });

  it("must match the amount due, come after arriving, and be for an order the rider has", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    const early = await collectCash(r, order.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("INVALID_TRANSITION");
    await toDoor(r, order.id);
    const wrong = await collectCash(r, order.id, { amount: 8700 });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: "PAYMENT_MISMATCH", details: { amountDue: 8800 } });
    expect((await collectCash(other, order.id)).status).toBe(404);
    expect((await collectCash(r, "9".repeat(24))).status).toBe(404);
    expect((await collectCash(r, order.id, { amount: 0 })).status).toBe(400);
    expect((await collectCash(r, order.id, { amount: "88" as never })).status).toBe(400);
    expect((await collectCash(r, order.id, { amount: 88.5 })).status).toBe(400);
    expect(await cashOf(r)).toBe(0);
    expect(f.orders.get(order.id).collectionRecorded).toBe(false);
  });

  it("is refused when the customer paid online while the rider was on the way", async () => {
    const r = await onShift();
    const order = await atDoor(r);
    f.orders.patch(order.id, { alreadyPaid: true, paymentStatus: "paid" });
    const res = await collectCash(r, order.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "already_paid" } });
    expect(await cashOf(r)).toBe(0);
  });

  it("needs a signed-in rider", async () => {
    for (const path of ["/rider/cash"]) expect((await f.get(path, {})).status).toBe(401);
    expect((await f.send("post", `/rider/orders/${"9".repeat(24)}/collect-cash`, { amount: 1 }, {})).status).toBe(401);
    expect((await f.send("post", `/rider/orders/${"9".repeat(24)}/collect-upi`, { amount: 1 }, {})).status).toBe(401);
  });
});

describe("doorstep UPI", () => {
  it("records an unverified payment that is not counted as cash and waits for the admin", async () => {
    const r = await onShift();
    const order = await atDoor(r);
    const res = await collectUpi(r, order.id, { amount: 8800, note: "Paid by GPay 11:02" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ orderId: order.id, paymentStatus: "upi_unverified", collection: { method: "upi_unverified", amount: 8800 } });
    expect(await cashOf(r)).toBe(0);
    expect(await col("cash_ledger").countDocuments({})).toBe(0);
    const mine = (await as(r, "get", "/rider/cash")).body.data;
    expect(mine.pendingUpi).toEqual([{ orderId: order.id, orderNo: order.orderNo, amount: 8800, status: "upi_unverified" }]);
    const items = (await f.get("/admin/reconciliation")).body.data;
    expect(items).toEqual([expect.objectContaining({ type: "upi_unverified", orderNo: order.orderNo, riderName: r.name, amount: 8800, status: "open" })]);
    expect((await as(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" })).status).toBe(200);
  });

  it("answers a repeat with the first result, and has the same checks as cash", async () => {
    const r = await onShift();
    const order = await atDoor(r);
    expect((await collectUpi(r, order.id, { amount: 100 })).body.error).toMatchObject({ code: "PAYMENT_MISMATCH" });
    await collectUpi(r, order.id);
    const again = await collectUpi(r, order.id);
    expect(again.body.data).toMatchObject({ duplicate: true, paymentStatus: "upi_unverified" });
    expect(await col("cash_reconciliation").countDocuments({})).toBe(1);
    // A second kind of payment for the same order is also just a repeat.
    expect((await collectCash(r, order.id)).body.data.duplicate).toBe(true);
  });
});

describe("the rider's cash page", () => {
  it("shows the total, the split by warehouse, today's lines and how many orders were delivered", async () => {
    const r = await onShift();
    const a = await atDoor(r);
    await collectCash(r, a.id);
    await as(r, "post", `/rider/orders/${a.id}/deliver`, { otp: "4271" });
    const b = await atDoor(r, { amountDue: 5000 });
    await collectCash(r, b.id, { amount: 5000 });
    const res = await as(r, "get", "/rider/cash");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      cashInHand: 13800, byWarehouse: [{ warehouseId: W1, warehouseName: expect.any(String), amount: 13800 }], deliveredToday: 1, pendingUpi: [],
      entries: [expect.objectContaining({ type: "collected", amount: 5000, orderNo: b.orderNo, warehouseId: W1 }), expect.objectContaining({ type: "collected", amount: 8800, orderNo: a.orderNo })],
    });
    expect(res.body.data.entries[0].at).toMatch(/Z$/);
    expect(res.body.data.byWarehouse[0].warehouseName).not.toBe("");
  });

  it("is empty for a rider with no cash and does not show other riders' money", async () => {
    const r = await onShift();
    const other = await onShift();
    const order = await atDoor(other);
    await collectCash(other, order.id);
    expect((await as(r, "get", "/rider/cash")).body.data).toEqual({ cashInHand: 0, byWarehouse: [], deliveredToday: 0, pendingUpi: [], entries: [] });
  });
});

/** A rider who has taken cash for a given order amount at a warehouse. */
async function withCash(amount = 8800, over: Record<string, unknown> = {}) {
  const r = await onShift(over);
  const order = await atDoor(r, { amountDue: amount });
  expect((await collectCash(r, order.id, { amount })).status).toBe(200);
  return { r, order };
}

describe("the admin's view of cash", () => {
  it("lists cash in hand per rider and warehouse, filtered by warehouse or zone, and totals it", async () => {
    const { r } = await withCash(8800);
    const second = await onShift({ name: "Tashi", warehouseIds: [W1, W2] });
    const o2 = await atDoor(second, { amountDue: 5000 });
    await collectCash(second, o2.id, { amount: 5000 });
    const res = await f.get("/admin/cash/riders");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([
      { riderId: r.id, name: r.name, cashInHand: 8800, byWarehouse: [{ warehouseId: W1, amount: 8800 }], lastDepositAt: null },
      { riderId: second.id, name: "Tashi", cashInHand: 5000, byWarehouse: [{ warehouseId: W1, amount: 5000 }], lastDepositAt: null },
    ]);
    expect(res.body.meta).toEqual({ totalInHand: 13800 });
    expect((await f.get(`/admin/cash/riders?warehouseId=${W2}`)).body).toEqual({ data: [], meta: { totalInHand: 0 } });
    expect((await f.get(`/admin/cash/riders?zoneId=${ZONE2}`)).body.data).toEqual([]);
    expect((await f.get("/admin/cash/riders?zoneId=nope")).status).toBe(400);
  });

  it("limits a warehouse manager to their own warehouse, and needs the cash permission", async () => {
    await withCash(8800);
    expect((await f.get("/admin/cash/riders", scoped(W1))).body.meta).toEqual({ totalInHand: 8800 });
    expect((await f.get("/admin/cash/riders", scoped(W2))).body.meta).toEqual({ totalInHand: 0 });
    expect((await f.get(`/admin/cash/riders?warehouseId=${W1}`, scoped(W2))).status).toBe(403);
    for (const path of ["/admin/cash/riders", "/admin/cash/ledger", "/admin/reconciliation"]) {
      expect((await f.get(path, viewer)).status, path).toBe(403);
      expect((await f.get(path, {})).status, path).toBe(401);
    }
  });

  it("lists the ledger newest first with filters and pages", async () => {
    const { r } = await withCash(8800);
    const dep = await f.send("post", "/admin/cash/deposit", { riderId: r.id, warehouseId: W1, amount: 3000, note: "Part" });
    await f.send("post", "/admin/cash/adjust", { riderId: r.id, warehouseId: W1, amount: -200, note: "Short" });
    const all = await f.get("/admin/cash/ledger");
    expect(all.body.data.map((e: { type: string; amount: number }) => [e.type, e.amount])).toEqual([["adjustment", -200], ["deposit", -3000], ["collected", 8800]]);
    expect(all.body.data[0]).toMatchObject({ riderId: r.id, warehouseId: W1, balanceAfter: 5600, note: "Short", by: "000000000000000000000001", flags: [], orderId: null });
    expect(all.body.meta).toEqual({ nextCursor: null });
    expect(dep.status).toBe(201);
    expect((await f.get("/admin/cash/ledger?type=deposit")).body.data).toHaveLength(1);
    expect((await f.get(`/admin/cash/ledger?riderId=${"9".repeat(24)}`)).body.data).toEqual([]);
    expect((await f.get(`/admin/cash/ledger?from=${new Date(Date.now() + 3_600_000).toISOString()}`)).body.data).toEqual([]);
    const page1 = await f.get("/admin/cash/ledger?limit=2");
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.nextCursor).toEqual(expect.stringMatching(/^[a-f0-9]{24}$/));
    const page2 = await f.get(`/admin/cash/ledger?limit=2&cursor=${page1.body.meta.nextCursor}`);
    expect(page2.body.data.map((e: { type: string }) => e.type)).toEqual(["collected"]);
    expect((await f.get("/admin/cash/ledger?type=gift")).status).toBe(400);
    expect((await f.get("/admin/cash/ledger?limit=500")).status).toBe(400);
    expect((await f.get(`/admin/cash/ledger?warehouseId=${W1}`, scoped(W2))).status).toBe(403);
    expect((await f.get("/admin/cash/ledger", scoped(W2))).body.data).toEqual([]);
  });
});

describe("deposits", () => {
  it("takes cash off the rider's hand and remembers when", async () => {
    const { r } = await withCash(8800);
    const res = await f.send("post", "/admin/cash/deposit", { riderId: r.id, warehouseId: W1, amount: 8800, note: "Evening handover" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ riderId: r.id, warehouseId: W1, type: "deposit", amount: -8800, balanceAfter: 0, note: "Evening handover", orderId: null });
    expect(await cashOf(r)).toBe(0);
    const row = (await f.get("/admin/cash/riders")).body;
    expect(row.data).toEqual([]);
    expect((await col("cash_totals").findOne({ _id: r.id as never }))?.lastDepositAt).toEqual(expect.any(Date));
  });

  it("can be partial, and never larger than the cash held for that warehouse", async () => {
    const { r } = await withCash(8800);
    const part = await f.send("post", "/admin/cash/deposit", { riderId: r.id, warehouseId: W1, amount: 5000 });
    expect(part.body.data.balanceAfter).toBe(3800);
    const big = await f.send("post", "/admin/cash/deposit", { riderId: r.id, warehouseId: W1, amount: 3801 });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "amount", held: 3800 } });
    const wrongWarehouse = await f.send("post", "/admin/cash/deposit", { riderId: r.id, warehouseId: W2, amount: 100 });
    expect(wrongWarehouse.status).toBe(400);
    expect(wrongWarehouse.body.error.details.held).toBe(0);
    expect(await cashOf(r)).toBe(3800);
  });

  it("cannot take the same cash out twice when two deposits arrive together", async () => {
    const { r } = await withCash(8800);
    const results = await Promise.all([1, 2].map(() => f.send("post", "/admin/cash/deposit", { riderId: r.id, warehouseId: W1, amount: 8800 })));
    expect(results.map(x => x.status).sort()).toEqual([201, 400]);
    expect(await cashOf(r)).toBe(0);
    expect(await col("cash_ledger").countDocuments({ type: "deposit" })).toBe(1);
  });

  it("checks the request, the rider, the warehouse and the manager's scope", async () => {
    const { r } = await withCash(8800);
    const deposit = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/cash/deposit", body, who);
    expect((await deposit({ riderId: r.id, warehouseId: W1, amount: 0 })).status).toBe(400);
    expect((await deposit({ riderId: r.id, warehouseId: W1, amount: -5 })).status).toBe(400);
    expect((await deposit({ riderId: r.id, warehouseId: W1 })).status).toBe(400);
    expect((await deposit({ riderId: "9".repeat(24), warehouseId: W1, amount: 100 })).status).toBe(404);
    expect((await deposit({ riderId: r.id, warehouseId: "9".repeat(24), amount: 100 })).status).toBe(404);
    expect((await deposit({ riderId: r.id, warehouseId: W1, amount: 100 }, scoped(W2))).status).toBe(403);
    expect((await deposit({ riderId: r.id, warehouseId: W1, amount: 100 }, viewer)).status).toBe(403);
    expect((await deposit({ riderId: r.id, warehouseId: W1, amount: 100 }, {})).status).toBe(401);
    expect((await deposit({ riderId: r.id, warehouseId: W1, amount: 100 }, scoped(W1))).status).toBe(201);
  });
});

describe("adjustments", () => {
  it("adds or removes cash with a reason and never edits an earlier line", async () => {
    const { r } = await withCash(8800);
    const adjust = (body: Record<string, unknown>) => f.send("post", "/admin/cash/adjust", { riderId: r.id, warehouseId: W1, ...body });
    const short = await adjust({ amount: -200, note: "Short by 200, rider will repay" });
    expect(short.status, JSON.stringify(short.body)).toBe(201);
    expect(short.body.data).toMatchObject({ type: "adjustment", amount: -200, balanceAfter: 8600, note: "Short by 200, rider will repay" });
    expect((await adjust({ amount: 50, note: "Found" })).body.data.balanceAfter).toBe(8650);
    expect(await col("cash_ledger").countDocuments({})).toBe(3);
  });

  it("needs a reason, a non-zero amount, and the right rider and warehouse", async () => {
    const { r } = await withCash(8800);
    const adjust = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/cash/adjust", { riderId: r.id, warehouseId: W1, ...body }, who);
    expect((await adjust({ amount: -200 })).status).toBe(400);
    expect((await adjust({ amount: -200, note: "   " })).status).toBe(400);
    expect((await adjust({ amount: 0, note: "None" })).status).toBe(400);
    expect((await adjust({ amount: 1.5, note: "Half" })).status).toBe(400);
    expect((await adjust({ amount: -200, note: "x", riderId: "9".repeat(24) })).status).toBe(404);
    expect((await adjust({ amount: -200, note: "x" }, scoped(W2))).status).toBe(403);
    expect((await adjust({ amount: -200, note: "x" }, viewer)).status).toBe(403);
    expect(await cashOf(r)).toBe(8800);
  });
});

describe("reconciliation", () => {
  async function upiItem() {
    const r = await onShift();
    const order = await atDoor(r);
    await collectUpi(r, order.id);
    const item = (await f.get("/admin/reconciliation")).body.data[0];
    return { r, order, item };
  }
  const resolve = (id: string, body: Record<string, unknown>, who = admin) => f.send("post", `/admin/reconciliation/${id}/resolve`, body, who);
  async function seed(type: "overpaid" | "unmatched", r: TestRider, orderNo = "DS-240999-A") {
    const id = "e".repeat(23) + (type === "overpaid" ? "1" : "2");
    await col("cash_reconciliation").insertOne({
      _id: id as never, type, status: "open", orderId: "d".repeat(24), orderNo, riderId: r.id, riderName: r.name, warehouseId: W1, amount: 9900, at: new Date(),
      outcome: null, note: null, bankReference: null, resolvedBy: null, resolvedAt: null,
    });
    return id;
  }

  it("lists open items first-class with counts, and filters them", async () => {
    const { r } = await upiItem();
    await seed("overpaid", r);
    const all = await f.get("/admin/reconciliation");
    expect(all.status).toBe(200);
    expect(all.body.meta).toEqual({ openCount: 2, nextCursor: null });
    expect(all.body.data.map((i: { type: string }) => i.type).sort()).toEqual(["overpaid", "upi_unverified"]);
    expect(all.body.data[0]).toEqual(expect.objectContaining({ id: expect.any(String), orderNo: expect.any(String), riderName: r.name, amount: expect.any(Number), at: expect.stringMatching(/Z$/), status: "open" }));
    expect((await f.get("/admin/reconciliation?type=overpaid")).body.data).toHaveLength(1);
    expect((await f.get("/admin/reconciliation?status=resolved")).body.data).toEqual([]);
    expect((await f.get(`/admin/reconciliation?warehouseId=${W2}`)).body.data).toEqual([]);
    expect((await f.get("/admin/reconciliation?type=weird")).status).toBe(400);
    expect((await f.get("/admin/reconciliation", scoped(W2))).body.meta.openCount).toBe(0);
    expect((await f.get(`/admin/reconciliation?warehouseId=${W1}`, scoped(W2))).status).toBe(403);
  });

  it("verifies a UPI payment against the bank", async () => {
    const { order, item } = await upiItem();
    const res = await resolve(item.id, { outcome: "verified", bankReference: "UPI/4381", note: "Matched in bank statement" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: item.id, status: "resolved", outcome: "verified", bankReference: "UPI/4381", note: "Matched in bank statement", resolvedBy: "000000000000000000000001" });
    expect(f.orders.get(order.id)).toMatchObject({ collectionMethod: "upi_verified", collectionAmount: 8800 });
    expect((await f.get("/admin/reconciliation")).body.meta.openCount).toBe(0);
    expect((await f.get("/admin/reconciliation?status=resolved")).body.data).toHaveLength(1);
  });

  it("raises a discrepancy against the rider when the UPI money never arrived", async () => {
    const { r, order, item } = await upiItem();
    const res = await resolve(item.id, { outcome: "not_received", note: "Not in the bank" });
    expect(res.status).toBe(200);
    expect(await col("cash_ledger").findOne({ orderId: order.id })).toMatchObject({ type: "adjustment", amount: 8800, flags: ["discrepancy"], riderId: r.id, warehouseId: W1 });
    expect(await cashOf(r)).toBe(8800);
    expect(f.orders.get(order.id).collectionMethod).toBe("cash");
  });

  it("refunds or keeps money taken twice, and adjusts cash taken on an order that was not theirs", async () => {
    const { r } = await upiItem();
    const over = await seed("overpaid", r);
    const refund = await resolve(over, { outcome: "refund", note: "Created refund" });
    expect(refund.body.data).toMatchObject({ status: "resolved", outcome: "refund", refund: { id: `refund-${"d".repeat(24)}`, amount: 9900 } });
    expect(f.orders.refunds).toEqual([{ orderId: "d".repeat(24), amount: 9900, reason: expect.any(String) }]);

    const unmatched = await seed("unmatched", r);
    expect((await resolve(unmatched, { outcome: "adjust", amount: 0 })).status).toBe(400);
    expect((await resolve(unmatched, { outcome: "adjust", amount: -9900, note: "Returned to customer" })).status).toBe(200);
    expect(await col("cash_ledger").findOne({ type: "adjustment", amount: -9900 })).toMatchObject({ riderId: r.id, note: "Returned to customer" });
  });

  it("keeps the money when the admin decides to, with no ledger line", async () => {
    const { r } = await upiItem();
    const over = await seed("overpaid", r);
    expect((await resolve(over, { outcome: "keep", note: "Customer wanted a credit" })).body.data.outcome).toBe("keep");
    expect(f.orders.refunds).toEqual([]);
    expect(await col("cash_ledger").countDocuments({})).toBe(0);
  });

  it("closes an item once, takes only outcomes that fit its type, and checks scope and permission", async () => {
    const { r, item } = await upiItem();
    const over = await seed("overpaid", r);
    expect((await resolve(item.id, { outcome: "refund" })).status).toBe(400);
    expect((await resolve(over, { outcome: "verified" })).status).toBe(400);
    expect((await resolve(item.id, { outcome: "dance" })).status).toBe(400);
    expect((await resolve(item.id, { outcome: "verified" }, scoped(W2))).status).toBe(403);
    expect((await resolve(item.id, { outcome: "verified" }, viewer)).status).toBe(403);
    expect((await resolve("9".repeat(24), { outcome: "verified" })).status).toBe(404);
    expect((await resolve(item.id, { outcome: "verified" }, scoped(W1))).status).toBe(200);
    const twice = await resolve(item.id, { outcome: "verified" });
    expect(twice.status).toBe(409);
    expect(twice.body.error.details).toEqual({ reason: "already_resolved" });
    const both = await Promise.all([resolve(over, { outcome: "keep" }), resolve(over, { outcome: "keep" })]);
    expect(both.map(x => x.status).sort()).toEqual([200, 409]);
  });
});

describe("correcting a collection", () => {
  const fix = (id: string, body: Record<string, unknown>, who = admin) => f.send("post", `/admin/orders/${id}/fix-collection`, body, who);

  it("changes the amount through an adjustment, never by editing the original line", async () => {
    const { r, order } = await withCash(8800);
    const res = await fix(order.id, { method: "cash", amount: 8000, reason: "Customer gave 80, not 88" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ id: order.id, orderNo: order.orderNo, status: expect.any(String), paymentStatus: "cod_collected", collection: { method: "cash", amount: 8000 } });
    expect(await col("cash_ledger").findOne({ orderId: order.id, type: "collected" })).toMatchObject({ amount: 8800 });
    expect(await col("cash_ledger").findOne({ orderId: order.id, type: "adjustment" })).toMatchObject({ amount: -800, note: "Customer gave 80, not 88", riderId: r.id, warehouseId: W1 });
    expect(await cashOf(r)).toBe(8000);
    // Fixing it to what it already is changes nothing.
    await fix(order.id, { method: "cash", amount: 8000, reason: "Check" });
    expect(await col("cash_ledger").countDocuments({ orderId: order.id })).toBe(2);
  });

  it("turns a cash record into doorstep UPI, taking the cash out of the rider's hand", async () => {
    const { r, order } = await withCash(8800);
    const res = await fix(order.id, { method: "upi", amount: 8800, reason: "It was a UPI payment" });
    expect(res.body.data.collection).toEqual({ method: "upi_unverified", amount: 8800 });
    expect(await cashOf(r)).toBe(0);
    expect((await f.get("/admin/reconciliation")).body.data).toEqual([expect.objectContaining({ type: "upi_unverified", orderNo: order.orderNo, amount: 8800 })]);
  });

  it("checks the order, the reason, the amount and the manager's scope", async () => {
    const { order } = await withCash(8800);
    expect((await fix(order.id, { method: "cash", amount: 8000 })).status).toBe(400);
    expect((await fix(order.id, { method: "cash", amount: 0, reason: "x" })).status).toBe(400);
    expect((await fix(order.id, { method: "cheque", amount: 100, reason: "x" })).status).toBe(400);
    expect((await fix("9".repeat(24), { method: "cash", amount: 100, reason: "x" })).status).toBe(404);
    expect((await fix(order.id, { method: "cash", amount: 100, reason: "x" }, scoped(W2))).status).toBe(403);
    expect((await fix(order.id, { method: "cash", amount: 100, reason: "x" }, viewer)).status).toBe(403);
    expect((await fix(order.id, { method: "cash", amount: 100, reason: "x" }, {})).status).toBe(401);
  });

  it("cannot adjust cash for an order that no rider ever had", async () => {
    const lonely = ready();
    const res = await fix(lonely.id, { method: "cash", amount: 5000, reason: "Entered by mistake" });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "no_rider" });
  });
});
