import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDev2Modules } from "../../src/composition/dev2.js";
import { W1, W2, W3, ZONE1, ZONE2, admin, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { riderFromHeader, actorFromHeader } from "./support/harness.js";
import { AT_W1, goOnline, newRider, resetRiderCounter, type TestRider } from "./support/riders.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("dispatch_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); resetRiderCounter(); });

const col = (name: string) => f.h.connection.collection(name);
const riderDoc = (id: string) => col("riders").findOne({ _id: id as never });
const assignmentDoc = (filter: Record<string, unknown>) => col("assignments").findOne(filter);
const ready = (over: Record<string, unknown> = {}) => f.orders.add({ zoneId: ZONE1, warehouseId: W1, ...over });
const assign = (orderId: string, riderId: string, extra: Record<string, unknown> = {}, who: Record<string, string> = admin) => f.send("post", `/admin/orders/${orderId}/assign`, { riderId, ...extra }, who);
const unassign = (orderId: string, body: Record<string, unknown> = { reason: "Rider unreachable" }) => f.send("post", `/admin/orders/${orderId}/unassign`, body);
const active = async (r: TestRider) => (await riderDoc(r.id))?.activeOrderCount;
/** A rider on shift near the warehouse, with a phone and a device so messages reach them. */
async function onShift(over: Record<string, unknown> = {}, warehouseId = W1, location = AT_W1) {
  const r = await newRider(f, over);
  await goOnline(f, r, warehouseId, location);
  f.msg.person(r.userId, r.phone, [`tok-${r.id}`]);
  return r;
}
const feedOf = async (r: TestRider) => (await col("assignment_feed").find({ riderId: r.id }).sort({ seq: 1 }).toArray()).map(e => e.event);

describe("suggesting a rider", () => {
  it("ranks eligible riders by fewest active orders, then nearest the warehouse, then longest since an assignment", async () => {
    const near = await onShift({ name: "Near" });
    const farther = await onShift({ name: "Farther" }, W1, { lat: 27.045, lng: 88.268 });
    const busy = await onShift({ name: "Busy" });
    const tieA = await onShift({ name: "Tie A" }, W1, { lat: 27.043, lng: 88.2663 });
    const tieB = await onShift({ name: "Tie B" }, W1, { lat: 27.043, lng: 88.2663 });
    await col("riders").updateOne({ _id: busy.id as never }, { $set: { activeOrderCount: 1 } });
    await col("riders").updateOne({ _id: tieA.id as never }, { $set: { lastAssignedAt: new Date("2026-11-05T09:10:00Z") } });
    await col("riders").updateOne({ _id: tieB.id as never }, { $set: { lastAssignedAt: new Date("2026-11-05T08:40:00Z") } });
    const order = ready();

    const res = await f.get(`/admin/dispatch/suggestions?orderId=${order.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.orderId).toBe(order.id);
    expect(res.body.data.suggested.map((s: { name: string }) => s.name)).toEqual(["Near", "Tie B", "Tie A", "Farther", "Busy"]);
    expect(res.body.data.suggested[0]).toEqual({ riderId: near.id, name: "Near", activeOrders: 0, distanceMeters: expect.any(Number), lastAssignedAt: null, score: 1 });
    expect(res.body.data.suggested[0].distanceMeters).toBeLessThan(10);
    expect(res.body.data.suggested.map((s: { score: number }) => s.score)).toEqual([1, 2, 3, 4, 5]);
    expect(res.body.data.suggested[1].lastAssignedAt).toBe("2026-11-05T08:40:00.000Z");
    expect(farther.id).toBeTruthy();
  });

  it("says why each other rider cannot take the order", async () => {
    await onShift({ name: "Fine" });
    const offline = await newRider(f, { name: "Offline" });
    const brk = await onShift({ name: "On break" });
    await f.send("post", "/rider/shift/break", undefined, brk.headers);
    const elsewhere = await onShift({ name: "Other zone", zoneId: ZONE2, warehouseIds: [W3] }, W3, { lat: 27.25, lng: 88.25 });
    const w2only = await onShift({ name: "W2 only", warehouseIds: [W2] }, W2, { lat: 27.0432, lng: 88.2641 });
    const full = await onShift({ name: "Full" });
    const stale = await onShift({ name: "Stale" });
    await col("riders").updateOne({ _id: full.id as never }, { $set: { activeOrderCount: 2 } });
    await col("riders").updateOne({ _id: stale.id as never }, { $set: { lastLocationAt: new Date(Date.now() - 10 * 60_000) } });
    const res = await f.get(`/admin/dispatch/suggestions?orderId=${ready().id}`);
    const why = Object.fromEntries(res.body.data.ineligible.map((i: { name: string; reasons: string[] }) => [i.name, i.reasons]));
    expect(res.body.data.suggested.map((s: { name: string }) => s.name)).toEqual(["Fine"]);
    expect(why).toEqual({
      Offline: ["offline", "stale_location"], "On break": ["on_break"], "Other zone": ["wrong_zone", "wrong_warehouse"], "W2 only": ["wrong_warehouse"], Full: ["at_capacity"], Stale: ["stale_location"],
    });
    expect([offline.id, elsewhere.id, w2only.id].every(Boolean)).toBe(true);
  });

  it("only works for a ready order the admin may see", async () => {
    await onShift();
    const packing = ready({ status: "PACKING" });
    expect((await f.get(`/admin/dispatch/suggestions?orderId=${packing.id}`)).status).toBe(409);
    expect((await f.get(`/admin/dispatch/suggestions?orderId=${"9".repeat(24)}`)).status).toBe(404);
    expect((await f.get("/admin/dispatch/suggestions")).status).toBe(400);
    const order = ready();
    expect((await f.get(`/admin/dispatch/suggestions?orderId=${order.id}`, viewer)).status).toBe(403);
    expect((await f.get(`/admin/dispatch/suggestions?orderId=${order.id}`, {})).status).toBe(401);
    expect((await f.get(`/admin/dispatch/suggestions?orderId=${order.id}`, scoped(W2))).status).toBe(403);
    expect((await f.get(`/admin/dispatch/suggestions?orderId=${order.id}`, scoped(W1))).status).toBe(200);
  });
});

describe("assigning an order", () => {
  it("assigns, moves the order on, takes the rider's capacity, starts the acknowledgement clock, tells the rider and records it", async () => {
    const r = await onShift();
    const order = ready();
    const res = await assign(order.id, r.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({
      assignment: { id: expect.stringMatching(/^[a-f0-9]{24}$/), orderId: order.id, riderId: r.id, status: "assigned", mode: "manual", ackDeadlineAt: expect.stringMatching(/Z$/), assignedAt: expect.stringMatching(/Z$/), batchId: null },
      order: { id: order.id, status: "ASSIGNED" },
    });
    const a = res.body.data.assignment;
    expect(new Date(a.ackDeadlineAt).getTime() - new Date(a.assignedAt).getTime()).toBe(120_000);
    expect(f.orders.get(order.id).status).toBe("ASSIGNED");
    expect(f.orders.log).toEqual([expect.objectContaining({ orderId: order.id, to: "ASSIGNED", by: { kind: "admin", id: "000000000000000000000001" } })]);
    expect(await active(r)).toBe(1);
    expect((await riderDoc(r.id))?.lastAssignedAt).toEqual(expect.any(Date));
    expect(await feedOf(r)).toEqual(["assigned"]);
    expect(await col("audit_log").countDocuments({ action: "dispatch.assign", entityId: order.id })).toBe(1);

    await f.runJobs();
    expect(f.msg.pushed).toEqual([expect.objectContaining({
      token: `tok-${r.id}`, title: "New order assigned", body: `Order ${order.orderNo} is assigned to you. Acknowledge it now.`, priority: "high",
      data: expect.objectContaining({ type: "assignment", assignmentId: a.id, ackDeadlineAt: a.ackDeadlineAt, deepLink: `dsr://assignment/${a.id}` }),
    })]);
  });

  it("refuses an order that is not ready, or is already assigned, and an unknown order or rider", async () => {
    const r = await onShift();
    const other = await onShift();
    const packing = ready({ status: "PACKING" });
    expect((await assign(packing.id, r.id)).status).toBe(409);
    const order = ready();
    expect((await assign(order.id, r.id)).status).toBe(200);
    const again = await assign(order.id, other.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { from: "ASSIGNED" } });
    expect(await col("assignments").countDocuments({ orderId: order.id, live: true })).toBe(1);
    expect((await assign("9".repeat(24), r.id)).status).toBe(404);
    expect((await assign(ready().id, "9".repeat(24))).status).toBe(404);
    expect((await f.send("post", `/admin/orders/${ready().id}/assign`, {}, admin)).status).toBe(400);
  });

  it("refuses a rider who cannot take it, with the reasons, and changes nothing", async () => {
    const offline = await newRider(f);
    const order = ready();
    const res = await assign(order.id, offline.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "RIDER_NOT_ELIGIBLE", details: { reasons: ["offline", "stale_location"] } });
    expect(f.orders.get(order.id).status).toBe("READY");
    expect(f.orders.log).toEqual([]);
    expect(await active(offline)).toBe(0);
  });

  it("never gives a rider more than the limit, even when two admins assign at the same moment", async () => {
    const r = await onShift();
    const a = ready(); const b = ready(); const c = ready();
    const results = await Promise.all([a, b, c].map(o => assign(o.id, r.id)));
    expect(results.map(x => x.status).sort()).toEqual([200, 200, 409]);
    const refused = results.find(x => x.status === 409)!;
    expect(refused.body.error).toMatchObject({ code: "RIDER_NOT_ELIGIBLE", details: { reasons: expect.arrayContaining(["at_capacity"]) } });
    expect(await active(r)).toBe(2);
    const loser = [a, b, c][results.findIndex(x => x.status === 409)]!;
    expect(f.orders.get(loser.id).status).toBe("READY");
  });

  it("lets only one of two admins assign the same order", async () => {
    const r1 = await onShift();
    const r2 = await onShift();
    const order = ready();
    const results = await Promise.all([assign(order.id, r1.id), assign(order.id, r2.id)]);
    expect(results.map(x => x.status).sort()).toEqual([200, 409]);
    expect(await col("assignments").countDocuments({ orderId: order.id, live: true })).toBe(1);
    expect((await active(r1) ?? 0) + (await active(r2) ?? 0)).toBe(1);
  });

  it("checks permission and warehouse scope", async () => {
    const r = await onShift();
    const order = ready();
    expect((await assign(order.id, r.id, {}, viewer)).status).toBe(403);
    expect((await assign(order.id, r.id, {}, {})).status).toBe(401);
    expect((await assign(order.id, r.id, {}, scoped(W2))).status).toBe(403);
    expect(f.orders.get(order.id).status).toBe("READY");
    expect((await assign(order.id, r.id, {}, scoped(W1))).status).toBe(200);
  });
});

describe("taking an order back", () => {
  it("returns it to ready, frees the rider, tells them, and can then be given to someone else", async () => {
    const r1 = await onShift();
    const r2 = await onShift();
    const order = ready();
    const first = (await assign(order.id, r1.id)).body.data.assignment;
    const res = await unassign(order.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ order: { id: order.id, status: "READY" } });
    expect(f.orders.get(order.id).status).toBe("READY");
    expect(await active(r1)).toBe(0);
    expect(await assignmentDoc({ _id: first.id as never })).toMatchObject({ status: "cancelled", live: false, endReason: "Rider unreachable", endedAt: expect.any(Date) });
    expect(await feedOf(r1)).toEqual(["assigned", "cancelled"]);
    expect(await col("audit_log").countDocuments({ action: "dispatch.unassign", entityId: order.id })).toBe(1);
    await f.runJobs();
    expect(f.msg.pushed.map(p => p.data.type)).toEqual(["assignment", "assignment_cancelled"]);

    expect((await assign(order.id, r2.id)).status).toBe(200);
    expect(await active(r2)).toBe(1);
    expect(await col("assignments").countDocuments({ orderId: order.id })).toBe(2);
  });

  it("is refused once the order has been picked up (use a hand-over) or when nothing is assigned", async () => {
    const r = await onShift();
    const order = ready();
    expect((await unassign(order.id)).status).toBe(409);
    await assign(order.id, r.id);
    f.orders.setStatus(order.id, "PICKED_UP");
    const res = await unassign(order.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { reason: "after_pickup" } });
    expect(await active(r)).toBe(1);
    expect((await unassign("9".repeat(24))).status).toBe(404);
    expect((await unassign(order.id, { reason: "x".repeat(501) })).status).toBe(400);
    expect((await f.send("post", `/admin/orders/${order.id}/unassign`, {}, viewer)).status).toBe(403);
  });
});

describe("a split order", () => {
  function split() {
    const groupId = "9a".repeat(12);
    const a = ready({ groupId, warehouseId: W1 });
    const b = ready({ groupId, warehouseId: W2 });
    return { groupId, a, b };
  }

  it("goes to one rider as a batch: a pickup at each warehouse, then one drop", async () => {
    const r = await onShift();
    const { groupId, a, b } = split();
    const res = await f.send("post", `/admin/order-groups/${groupId}/dispatch`, { mode: "same_rider", riderId: r.id, pickupOrder: [W2, W1] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.batch).toEqual({
      id: expect.any(String), riderId: r.id, zoneId: ZONE1, status: "planned", createdBy: "000000000000000000000001",
      stops: [
        { seq: 1, type: "pickup", warehouseId: W2, orderIds: [b.id], status: "pending" },
        { seq: 2, type: "pickup", warehouseId: W1, orderIds: [a.id], status: "pending" },
        { seq: 3, type: "drop", orderIds: [a.id, b.id], status: "pending" },
      ],
    });
    expect(res.body.data.assignments.map((x: { orderId: string; batchId: string }) => [x.orderId, x.batchId])).toEqual([[a.id, res.body.data.batch.id], [b.id, res.body.data.batch.id]]);
    expect([f.orders.get(a.id).status, f.orders.get(b.id).status]).toEqual(["ASSIGNED", "ASSIGNED"]);
    expect(await active(r)).toBe(2);
    expect(await col("audit_log").countDocuments({ action: "dispatch.dispatch_group" })).toBe(1);
  });

  it("refuses the same rider when they cannot serve both warehouses, are full, or a child is not ready", async () => {
    const w1only = await onShift({ warehouseIds: [W1] });
    const { groupId, a, b } = split();
    const dispatch = (body: Record<string, unknown>) => f.send("post", `/admin/order-groups/${groupId}/dispatch`, body);
    const wrong = await dispatch({ mode: "same_rider", riderId: w1only.id });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toMatchObject({ code: "RIDER_NOT_ELIGIBLE", details: { reasons: ["wrong_warehouse"] } });

    const both = await onShift();
    await col("riders").updateOne({ _id: both.id as never }, { $set: { activeOrderCount: 1 } });
    const full = await dispatch({ mode: "same_rider", riderId: both.id });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("RIDER_NOT_ELIGIBLE");
    expect([f.orders.get(a.id).status, f.orders.get(b.id).status]).toEqual(["READY", "READY"]);
    expect(await active(both)).toBe(1);
    expect(await col("delivery_batches").countDocuments({ status: "planned" })).toBe(0);

    await col("riders").updateOne({ _id: both.id as never }, { $set: { activeOrderCount: 0 } });
    f.orders.setStatus(b.id, "PACKING");
    const notReady = await dispatch({ mode: "same_rider", riderId: both.id });
    expect(notReady.status).toBe(409);
    expect(notReady.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { orderId: b.id } });
    expect((await dispatch({ mode: "same_rider", riderId: both.id, pickupOrder: [W1] })).status).toBe(409);
    f.orders.setStatus(b.id, "READY");
    expect((await dispatch({ mode: "same_rider", riderId: both.id, pickupOrder: [W1] })).status).toBe(400);
  });

  it("undoes a half-finished group dispatch: nothing stays assigned and the rider is not charged", async () => {
    const r = await onShift();
    const { groupId, a, b } = split();
    // The rider has room for one more order on paper, but the second claim will fail.
    await col("riders").updateOne({ _id: r.id as never }, { $set: { activeOrderCount: 1 } });
    const res = await f.send("post", `/admin/order-groups/${groupId}/dispatch`, { mode: "same_rider", riderId: r.id });
    expect(res.status).toBe(409);
    expect([f.orders.get(a.id).status, f.orders.get(b.id).status]).toEqual(["READY", "READY"]);
    expect(await active(r)).toBe(1);
    expect(await col("assignments").countDocuments({ live: true })).toBe(0);
    expect((await col("delivery_batches").find({}).toArray()).every(batch => batch.status === "cancelled")).toBe(true);
  });

  it("can instead go to different riders, one per order", async () => {
    const r1 = await onShift();
    const r2 = await onShift();
    const { groupId, a, b } = split();
    const res = await f.send("post", `/admin/order-groups/${groupId}/dispatch`, { mode: "different_riders", assignments: [{ orderId: a.id, riderId: r1.id }, { orderId: b.id, riderId: r2.id }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.batch).toBeNull();
    expect(res.body.data.assignments.map((x: { riderId: string }) => x.riderId)).toEqual([r1.id, r2.id]);
    expect([await active(r1), await active(r2)]).toEqual([1, 1]);
  });

  it("checks the group, its orders and the request", async () => {
    const r = await onShift();
    const { groupId, a } = split();
    const dispatch = (id: string, body: Record<string, unknown>, who = admin) => f.send("post", `/admin/order-groups/${id}/dispatch`, body, who);
    expect((await dispatch("9".repeat(24), { mode: "same_rider", riderId: r.id })).status).toBe(404);
    expect((await dispatch(groupId, { mode: "different_riders", assignments: [{ orderId: "9".repeat(24), riderId: r.id }] })).status).toBe(400);
    expect((await dispatch(groupId, { mode: "different_riders", assignments: [{ orderId: a.id, riderId: r.id }, { orderId: a.id, riderId: r.id }] })).status).toBe(400);
    expect((await dispatch(groupId, { mode: "sideways" })).status).toBe(400);
    expect((await dispatch(groupId, { mode: "same_rider", riderId: r.id }, viewer)).status).toBe(403);
    expect((await dispatch(groupId, { mode: "same_rider", riderId: r.id }, scoped(W1))).status).toBe(403);
    f.orders.setStatus(a.id, "CANCELLED");
    expect((await dispatch(groupId, { mode: "same_rider", riderId: r.id, pickupOrder: [W2] })).status).toBe(200);
  });
});

describe("batches", () => {
  const create = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/batches", body, who);

  it("builds a batch for a rider with stops in a sensible order, and lists it", async () => {
    const r = await onShift();
    const a = ready({ groupId: "a1".repeat(12), warehouseId: W1 });
    const b = ready({ groupId: "a2".repeat(12), warehouseId: W2 });
    const res = await create({ riderId: r.id, orderIds: [a.id, b.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ riderId: r.id, zoneId: ZONE1, status: "planned", createdBy: "000000000000000000000001" });
    expect(res.body.data.stops.map((s: { type: string; warehouseId?: string; orderIds: string[] }) => [s.type, s.warehouseId ?? null, s.orderIds])).toEqual([
      ["pickup", W1, [a.id]], ["pickup", W2, [b.id]], ["drop", null, [a.id]], ["drop", null, [b.id]],
    ]);
    expect(f.orders.get(a.id).status).toBe("READY");
    expect((await f.get("/admin/batches")).body.data).toEqual([res.body.data]);
    expect((await f.get(`/admin/batches?riderId=${r.id}&status=planned`)).body.data).toHaveLength(1);
    expect((await f.get("/admin/batches?status=done")).body.data).toEqual([]);
    expect((await f.get("/admin/batches?status=lost")).status).toBe(400);
  });

  it("takes the caller's stop order when it covers every order once, and refuses one that does not", async () => {
    const r = await onShift();
    const a = ready({ warehouseId: W1 });
    const b = ready({ warehouseId: W2 });
    const stops = [
      { type: "pickup", warehouseId: W2, orderIds: [b.id] }, { type: "pickup", warehouseId: W1, orderIds: [a.id] },
      { type: "drop", orderIds: [b.id] }, { type: "drop", orderIds: [a.id] },
    ];
    const res = await create({ riderId: r.id, orderIds: [a.id, b.id], stops });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.stops.map((s: { seq: number; type: string }) => [s.seq, s.type])).toEqual([[1, "pickup"], [2, "pickup"], [3, "drop"], [4, "drop"]]);
    expect(res.body.data.stops[0].warehouseId).toBe(W2);
    const c = ready({ warehouseId: W1 });
    const d = ready({ warehouseId: W2 });
    expect((await create({ riderId: r.id, orderIds: [c.id, d.id], stops: stops.slice(0, 3) })).status).toBe(400);
    expect((await create({ riderId: r.id, orderIds: [c.id, d.id], stops: [{ type: "pickup", warehouseId: W1, orderIds: [c.id, d.id] }, { type: "drop", orderIds: [c.id, d.id] }] })).status).toBe(400);
  });

  it("holds at most three orders, only ready ones in the rider's zone, and an order in only one batch", async () => {
    const r = await onShift();
    const four = [ready(), ready(), ready(), ready()];
    const over = await create({ riderId: r.id, orderIds: four.map(o => o.id) });
    expect(over.status).toBe(400);
    expect(over.body.error.details).toMatchObject({ reason: "batch_limit" });
    const notReady = ready({ status: "PACKING" });
    expect((await create({ riderId: r.id, orderIds: [notReady.id] })).status).toBe(409);
    const abroad = ready({ zoneId: ZONE2, warehouseId: W3 });
    const wrongZone = await create({ riderId: r.id, orderIds: [abroad.id] });
    expect(wrongZone.status).toBe(409);
    expect(wrongZone.body.error).toMatchObject({ code: "RIDER_NOT_ELIGIBLE", details: { reasons: ["wrong_zone", "wrong_warehouse"] } });
    const first = await create({ riderId: r.id, orderIds: [four[0]!.id] });
    expect(first.status).toBe(201);
    const dupe = await create({ riderId: r.id, orderIds: [four[0]!.id] });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.details).toMatchObject({ batchId: first.body.data.id });
    expect((await create({ riderId: r.id, orderIds: [] })).status).toBe(400);
    expect((await create({ riderId: "9".repeat(24), orderIds: [four[1]!.id] })).status).toBe(404);
    expect((await create({ riderId: r.id, orderIds: ["9".repeat(24)] })).status).toBe(404);
    expect((await create({ riderId: r.id, orderIds: [four[1]!.id] }, viewer)).status).toBe(403);
  });

  it("assigns orders into it and keeps the rider and orders matching", async () => {
    const r = await onShift();
    const other = await onShift();
    const a = ready(); const b = ready(); const outside = ready();
    const batch = (await create({ riderId: r.id, orderIds: [a.id, b.id] })).body.data;
    expect((await assign(outside.id, r.id, { batchId: batch.id })).status).toBe(409);
    expect((await assign(a.id, other.id, { batchId: batch.id })).status).toBe(409);
    expect((await assign(a.id, r.id, { batchId: "9".repeat(24) })).status).toBe(404);
    const done = await assign(a.id, r.id, { batchId: batch.id });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.assignment.batchId).toBe(batch.id);
  });

  it("reorders stops, adds and removes orders while planned, and refuses once it has started or an assigned order is removed", async () => {
    const r = await onShift();
    const a = ready({ warehouseId: W1 }); const b = ready({ warehouseId: W2 }); const c = ready({ warehouseId: W1 });
    const batch = (await create({ riderId: r.id, orderIds: [a.id, b.id] })).body.data;
    const put = (body: Record<string, unknown>, id = batch.id) => f.send("put", `/admin/batches/${id}`, body);

    const reordered = await put({ stops: [
      { type: "pickup", warehouseId: W2, orderIds: [b.id] }, { type: "pickup", warehouseId: W1, orderIds: [a.id] }, { type: "drop", orderIds: [a.id] }, { type: "drop", orderIds: [b.id] },
    ] });
    expect(reordered.status, JSON.stringify(reordered.body)).toBe(200);
    expect(reordered.body.data.stops[0]).toMatchObject({ seq: 1, type: "pickup", warehouseId: W2 });
    const full = await put({ addOrderIds: [c.id] });
    expect(full.status).toBe(400);
    expect(full.body.error.details).toMatchObject({ reason: "batch_limit" });
    const removed = await put({ removeOrderIds: [b.id] });
    expect(removed.body.data.stops.flatMap((x: { orderIds: string[] }) => x.orderIds)).not.toContain(b.id);
    const added = await put({ addOrderIds: [c.id] });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.data.stops.flatMap((x: { orderIds: string[] }) => x.orderIds).filter((id: string) => id === c.id)).toHaveLength(2);
    expect((await put({ removeOrderIds: ["9".repeat(24)] })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ stops: [] })).status).toBe(400);
    expect((await put({ addOrderIds: [a.id] }, "9".repeat(24))).status).toBe(404);

    await assign(a.id, r.id, { batchId: batch.id });
    const blocked = await put({ removeOrderIds: [a.id] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toMatchObject({ reason: "assigned" });
    await col("delivery_batches").updateOne({ _id: batch.id as never }, { $set: { status: "active" } });
    const started = await put({ addOrderIds: [c.id] });
    expect(started.status).toBe(409);
    expect(started.body.error.details).toEqual({ reason: "not_planned" });
  });

  it("cancels a batch that has not started, leaving assigned orders with their rider", async () => {
    const r = await onShift();
    const a = ready(); const b = ready();
    const batch = (await create({ riderId: r.id, orderIds: [a.id, b.id] })).body.data;
    await assign(a.id, r.id, { batchId: batch.id });
    const res = await f.send("post", `/admin/batches/${batch.id}/cancel`);
    expect(res.body).toEqual({ data: { ok: true } });
    expect((await col("delivery_batches").findOne({ _id: batch.id as never }))?.status).toBe("cancelled");
    expect((await assignmentDoc({ orderId: a.id, live: true }))?.batchId).toBeNull();
    expect(f.orders.get(a.id).status).toBe("ASSIGNED");
    expect((await f.send("post", `/admin/batches/${batch.id}/cancel`)).status).toBe(409);
    expect((await f.send("post", `/admin/batches/${"9".repeat(24)}/cancel`)).status).toBe(404);
    expect((await create({ riderId: r.id, orderIds: [b.id] })).status).toBe(201);
  });
});

describe("reassigning an order before pickup", () => {
  it("gives an assigned order to another rider in one step and offers the others as suggestions", async () => {
    const old = await onShift({ name: "Old" });
    const next = await onShift({ name: "Next" });
    const order = ready();
    const first = (await assign(order.id, old.id)).body.data.assignment;

    const options = await f.get(`/admin/dispatch/suggestions?orderId=${order.id}`);
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    expect(options.body.data.currentRiderId).toBe(old.id);
    expect(options.body.data.suggested.map((r: { riderId: string }) => r.riderId)).toEqual([next.id]);

    const res = await f.send("post", `/admin/orders/${order.id}/reassign`, { toRiderId: next.id, reason: "Closer to the customer" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.assignment).toMatchObject({ orderId: order.id, riderId: next.id, status: "assigned" });
    expect(res.body.data.order).toEqual({ id: order.id, status: "ASSIGNED" });
    expect(await assignmentDoc({ _id: first.id as never })).toMatchObject({ live: false });
    expect(await assignmentDoc({ _id: res.body.data.assignment.id as never })).toMatchObject({ live: true, riderId: next.id });

    // handing it to the rider who already has it is refused
    expect((await f.send("post", `/admin/orders/${order.id}/reassign`, { toRiderId: next.id })).status).toBe(400);
  });

  it("is refused once the order has been picked up (use a hand-over instead)", async () => {
    const old = await onShift({ name: "Old" });
    const next = await onShift({ name: "Next" });
    const order = ready();
    await assign(order.id, old.id);
    f.orders.setStatus(order.id, "OUT_FOR_DELIVERY");
    expect((await f.send("post", `/admin/orders/${order.id}/reassign`, { toRiderId: next.id })).status).toBe(409);
  });
});

describe("handing an order to another rider", () => {
  it("moves a picked-up order to a new rider who must acknowledge, without changing its status", async () => {
    const old = await onShift({ name: "Old" });
    const next = await onShift({ name: "Next" });
    const order = ready();
    const first = (await assign(order.id, old.id)).body.data.assignment;
    f.orders.setStatus(order.id, "OUT_FOR_DELIVERY");
    await col("assignments").updateOne({ _id: first.id as never }, { $set: { pickup: { at: new Date(), bagCount: 2 }, status: "acknowledged", ackAt: new Date() } });

    const res = await f.send("post", `/admin/orders/${order.id}/handover`, { toRiderId: next.id, reason: "Scooter breakdown at Hill Cart Road" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({
      assignment: expect.objectContaining({ id: expect.any(String), orderId: order.id, riderId: next.id, status: "assigned", ackDeadlineAt: expect.stringMatching(/Z$/) }),
      order: { id: order.id, status: "OUT_FOR_DELIVERY" },
    });
    expect(res.body.data.assignment.id).not.toBe(first.id);
    expect(await assignmentDoc({ _id: first.id as never })).toMatchObject({ status: "reassigned", live: false, endReason: "Scooter breakdown at Hill Cart Road" });
    expect(await assignmentDoc({ _id: res.body.data.assignment.id as never })).toMatchObject({ live: true, handoverFromId: first.id, pickup: { bagCount: 2 } });
    expect([await active(old), await active(next)]).toEqual([0, 1]);
    expect(f.orders.get(order.id).status).toBe("OUT_FOR_DELIVERY");
    expect(f.orders.events).toEqual([expect.objectContaining({ orderId: order.id, type: "handover", details: expect.objectContaining({ fromRiderId: old.id, toRiderId: next.id }) })]);
    expect(await feedOf(old)).toEqual(["assigned", "reassigned_away"]);
    expect(await feedOf(next)).toEqual(["assigned"]);
    await f.runJobs();
    expect(f.msg.pushed.filter(p => p.token === `tok-${next.id}`).map(p => p.data.type)).toEqual(["handover"]);
    expect(f.msg.pushed.filter(p => p.token === `tok-${old.id}`).map(p => p.data.type)).toEqual(["assignment", "assignment_cancelled"]);
    expect(await col("audit_log").countDocuments({ action: "dispatch.handover" })).toBe(1);
  });

  it("works for a rider who is not allowed at the order's warehouse, since the goods have already left it", async () => {
    const old = await onShift();
    const w2 = await onShift({ warehouseIds: [W2] }, W2, { lat: 27.0432, lng: 88.2641 });
    const order = ready();
    await assign(order.id, old.id);
    f.orders.setStatus(order.id, "PICKED_UP");
    expect((await f.send("post", `/admin/orders/${order.id}/handover`, { toRiderId: w2.id, reason: "Breakdown" })).status).toBe(200);
  });

  it("is refused before pickup, to the same rider, to a rider who cannot take it, and without a reason", async () => {
    const old = await onShift();
    const next = await onShift();
    const offline = await newRider(f);
    const order = ready();
    const handover = (body: Record<string, unknown>) => f.send("post", `/admin/orders/${order.id}/handover`, body);
    await assign(order.id, old.id);
    const early = await handover({ toRiderId: next.id, reason: "Early" });
    expect(early.status).toBe(409);
    expect(early.body.error.details).toMatchObject({ reason: "before_pickup" });
    f.orders.setStatus(order.id, "PICKED_UP");
    expect((await handover({ toRiderId: old.id, reason: "Same" })).status).toBe(400);
    const nope = await handover({ toRiderId: offline.id, reason: "Offline" });
    expect(nope.status).toBe(409);
    expect(nope.body.error.code).toBe("RIDER_NOT_ELIGIBLE");
    await col("riders").updateOne({ _id: next.id as never }, { $set: { activeOrderCount: 2 } });
    expect((await handover({ toRiderId: next.id, reason: "Full" })).body.error.details).toEqual({ reasons: ["at_capacity"] });
    expect((await handover({ toRiderId: "9".repeat(24), reason: "Nobody" })).status).toBe(404);
    expect((await handover({ toRiderId: next.id })).status).toBe(400);
    expect(await active(old)).toBe(1);
    expect((await f.send("post", `/admin/orders/${ready().id}/handover`, { toRiderId: next.id, reason: "x" })).status).toBe(409);
  });
});

describe("a failed delivery", () => {
  async function failed(over: Record<string, unknown> = {}) {
    const r = await onShift();
    const order = ready(over);
    await assign(order.id, r.id);
    f.orders.setStatus(order.id, "FAILED_DELIVERY");
    await col("assignments").updateOne({ orderId: order.id }, { $set: { status: "completed", live: false, outcome: "failed", endReason: "road_blocked", completedAt: new Date() } });
    return { r, order };
  }
  const resolve = (id: string, body: Record<string, unknown>, who = admin) => f.send("post", `/admin/orders/${id}/failed/resolve`, body, who);

  it("can be sent out again", async () => {
    const { order } = await failed();
    const res = await resolve(order.id, { action: "redispatch", note: "Customer will be home at 6 PM" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ order: { id: order.id, status: "READY" }, refund: null });
    expect(f.orders.get(order.id).status).toBe("READY");
    expect(await assignmentDoc({ orderId: order.id })).toMatchObject({ failedResolvedAt: expect.any(Date) });
    expect(await col("audit_log").countDocuments({ action: "dispatch.resolve_failed", entityId: order.id })).toBe(1);
  });

  it("can be cancelled with the goods returned or written off, and refunds a prepaid order", async () => {
    const cod = await failed();
    const good = await resolve(cod.order.id, { action: "cancel_return", goodsCondition: "good", note: "Customer refused" });
    expect(good.body.data).toEqual({ order: { id: cod.order.id, status: "CANCELLED" }, refund: null });
    expect(f.orders.returns).toEqual([{ orderId: cod.order.id, goodsCondition: "good", note: "Customer refused" }]);

    const prepaid = await failed({ paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid", amountDue: 12500 });
    const spoiled = await resolve(prepaid.order.id, { action: "cancel_return", goodsCondition: "spoiled" });
    expect(spoiled.body.data.refund).toEqual({ id: `refund-${prepaid.order.id}`, amount: 12500 });
    expect(f.orders.returns.at(-1)).toMatchObject({ goodsCondition: "spoiled", note: null });
  });

  it("needs the goods condition to cancel, a failed order, and the orders permission", async () => {
    const { order } = await failed();
    expect((await resolve(order.id, { action: "cancel_return" })).status).toBe(400);
    expect((await resolve(order.id, { action: "cancel_return", goodsCondition: "damaged" })).status).toBe(400);
    expect((await resolve(order.id, { action: "vanish" })).status).toBe(400);
    expect((await resolve(order.id, { action: "redispatch" }, viewer)).status).toBe(403);
    expect((await resolve(order.id, { action: "redispatch" }, {})).status).toBe(401);
    expect((await resolve(order.id, { action: "redispatch" }, scoped(W2))).status).toBe(403);
    expect((await resolve("9".repeat(24), { action: "redispatch" })).status).toBe(404);
    expect((await resolve(ready().id, { action: "redispatch" })).status).toBe(409);
    expect((await resolve(order.id, { action: "redispatch" })).status).toBe(200);
    expect((await resolve(order.id, { action: "redispatch" })).status).toBe(409);
  });
});

describe("the dispatch board", () => {
  it("lists assignments with their acknowledgement status, filtered by status, rider and warehouse", async () => {
    const r1 = await onShift({ name: "Pema" });
    const r2 = await onShift({ name: "Tashi" });
    const a = ready(); const b = ready({ warehouseId: W2 });
    await assign(a.id, r1.id);
    await assign(b.id, r2.id);
    await col("assignments").updateOne({ orderId: a.id }, { $set: { ackDeadlineAt: new Date(Date.now() - 5000) } });
    const all = await f.get("/admin/assignments");
    expect(all.status).toBe(200);
    expect(all.body.meta).toEqual({ count: 2 });
    expect(all.body.data.find((x: { orderId: string }) => x.orderId === a.id)).toEqual({
      id: expect.any(String), orderId: a.id, orderNo: a.orderNo, riderId: r1.id, riderName: "Pema", status: "assigned", ackDeadlineAt: expect.stringMatching(/Z$/), overdue: true,
    });
    expect(all.body.data.find((x: { orderId: string }) => x.orderId === b.id).overdue).toBe(false);
    expect((await f.get(`/admin/assignments?riderId=${r2.id}`)).body.data).toHaveLength(1);
    expect((await f.get(`/admin/assignments?warehouseId=${W2}`)).body.data).toHaveLength(1);
    expect((await f.get("/admin/assignments?status=acknowledged")).body.data).toEqual([]);
    expect((await f.get("/admin/assignments?status=rejected")).status).toBe(400);
    expect((await f.get("/admin/assignments", scoped(W1))).body.data).toHaveLength(1);
    expect((await f.get(`/admin/assignments?warehouseId=${W2}`, scoped(W1))).status).toBe(403);
    expect((await f.get("/admin/assignments", viewer)).status).toBe(403);
  });

  it("raises an alert for each thing that needs attention", async () => {
    const quiet = await onShift({ name: "Quiet" });
    const sick = await onShift({ name: "Sick" });
    const gone = await onShift({ name: "Gone" });
    const unacked = ready(); const trouble = ready(); const waiting = ready(); const failedOrder = ready();
    await assign(unacked.id, quiet.id);
    await assign(trouble.id, sick.id);
    await col("assignments").updateOne({ orderId: unacked.id }, { $set: { ackDeadlineAt: new Date(Date.now() - 3 * 60_000), whatsappSentAt: new Date() } });
    await col("rider_problems").insertOne({ _id: "p".repeat(24) as never, orderId: trouble.id, riderId: sick.id, assignmentId: "x", type: "vehicle_issue", note: "Puncture", createdAt: new Date() });
    f.orders.patch(waiting.id, { readyAt: new Date(Date.now() - 9 * 60_000) });
    await assign(failedOrder.id, sick.id);
    f.orders.setStatus(failedOrder.id, "FAILED_DELIVERY");
    await col("assignments").updateOne({ orderId: failedOrder.id }, { $set: { status: "completed", live: false, outcome: "failed", endReason: "weather", completedAt: new Date() } });
    await col("riders").updateOne({ _id: gone.id as never }, { $set: { status: "offline", autoOffline: true, activeOrderCount: 1 } });

    const alerts = (await f.get("/admin/dispatch/alerts")).body.data as Record<string, unknown>[];
    const byType = (type: string) => alerts.filter(a => a.type === type);
    expect(byType("ack_overdue")).toEqual([{ type: "ack_overdue", orderId: unacked.id, riderId: quiet.id, since: expect.stringMatching(/Z$/), message: expect.stringMatching(/^Quiet has not acknowledged for \d+ min \(WhatsApp sent\)$/) }]);
    expect(byType("rider_problem")).toEqual([expect.objectContaining({ orderId: trouble.id, riderId: sick.id, problem: "vehicle_issue", note: "Puncture" })]);
    expect(byType("order_delayed")).toEqual([{ type: "order_delayed", orderId: waiting.id, state: "READY", minutes: 9 }]);
    expect(byType("rider_offline")).toEqual([{ type: "rider_offline", riderId: gone.id, hasActiveOrder: true }]);
    expect(byType("failed_delivery")).toEqual([expect.objectContaining({ orderId: failedOrder.id, riderId: sick.id, reason: "weather" })]);
    expect((await f.get("/admin/dispatch/alerts", scoped(W3))).body.data).toEqual([]);
    expect((await f.get("/admin/dispatch/alerts", viewer)).status).toBe(403);
  });

  it("clears an alert once it has been dealt with", async () => {
    const r = await onShift();
    const order = ready();
    await assign(order.id, r.id);
    await col("assignments").updateOne({ orderId: order.id }, { $set: { ackDeadlineAt: new Date(Date.now() - 60_000) } });
    expect(((await f.get("/admin/dispatch/alerts")).body.data as { type: string }[]).map(a => a.type)).toContain("ack_overdue");
    await f.send("post", `/rider/assignments/${(await assignmentDoc({ orderId: order.id }))!._id}/ack`, undefined, r.headers);
    expect(((await f.get("/admin/dispatch/alerts")).body.data as { type: string }[]).map(a => a.type)).not.toContain("ack_overdue");
  });

  it("shows riders on shift on the map with what they carry, filtered by zone and warehouse", async () => {
    const r1 = await onShift({ name: "Pema" });
    const r2 = await onShift({ name: "Karma", zoneId: ZONE2, warehouseIds: [W3] }, W3, { lat: 27.25, lng: 88.25 });
    await newRider(f, { name: "Off duty" });
    const order = ready();
    await assign(order.id, r1.id);
    const res = await f.get("/admin/riders/live");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.find((x: { riderId: string }) => x.riderId === r1.id)).toEqual({
      riderId: r1.id, name: "Pema", status: "online", currentWarehouseId: W1, location: AT_W1, lastLocationAt: expect.stringMatching(/Z$/),
      activeOrders: [{ orderId: order.id, orderNo: order.orderNo, status: "ASSIGNED" }],
    });
    expect(res.body.data).toHaveLength(2);
    expect((await f.get(`/admin/riders/live?zoneId=${ZONE2}`)).body.data.map((x: { riderId: string }) => x.riderId)).toEqual([r2.id]);
    expect((await f.get(`/admin/riders/live?warehouseId=${W1}`)).body.data.map((x: { riderId: string }) => x.riderId)).toEqual([r1.id]);
    expect((await f.get("/admin/riders/live", scoped(W1))).body.data.map((x: { riderId: string }) => x.riderId)).toEqual([r1.id]);
    expect((await f.get("/admin/riders/live", viewer)).status).toBe(403);
    expect((await f.get("/admin/riders/live", {})).status).toBe(401);
    // A real rider named "live" must not be confused with the map: this path is registered ahead of /admin/riders/:id.
    expect((await f.get(`/admin/riders/${r1.id}`)).status).toBe(200);
  });
});

describe("unacknowledged orders", () => {
  it("messages the rider by WhatsApp once, after the deadline, and shows it on the board", async () => {
    const r = await onShift({ name: "Pema" });
    const order = ready();
    await assign(order.id, r.id);
    expect(await f.mods.dispatch.assign.sweepAcks()).toBe(0);
    await col("assignments").updateOne({ orderId: order.id }, { $set: { ackDeadlineAt: new Date(Date.now() - 1000) } });
    expect(await f.mods.dispatch.assign.sweepAcks()).toBe(1);
    expect(await f.mods.dispatch.assign.sweepAcks()).toBe(0);
    await f.runJobs();
    expect(f.msg.whatsapped).toEqual([expect.objectContaining({ to: r.phone, templateName: "assignment_unacknowledged_v1", params: ["Pema", order.orderNo] })]);
    expect(await assignmentDoc({ orderId: order.id })).toMatchObject({ escalatedAt: expect.any(Date), whatsappSentAt: expect.any(Date) });
    const alert = ((await f.get("/admin/dispatch/alerts")).body.data as { type: string; message: string }[]).find(a => a.type === "ack_overdue");
    expect(alert?.message).toContain("(WhatsApp sent)");
  });

  it("stays quiet when the rider acknowledges in time, or the order was taken back or reassigned", async () => {
    const r1 = await onShift();
    const r2 = await onShift();
    const acked = ready(); const taken = ready(); const moved = ready();
    const a = (await assign(acked.id, r1.id)).body.data.assignment;
    await assign(taken.id, r1.id);
    await f.send("post", `/rider/assignments/${a.id}/ack`, undefined, r1.headers);
    await unassign(taken.id);
    await assign(moved.id, r2.id);
    f.orders.setStatus(moved.id, "PICKED_UP");
    await f.send("post", `/admin/orders/${moved.id}/handover`, { toRiderId: r1.id, reason: "Swap" });
    await col("assignments").updateMany({}, { $set: { ackDeadlineAt: new Date(Date.now() - 5000) } });
    // Only the new rider's hand-over assignment is still waiting; everything else's clock was cancelled.
    expect(await f.mods.dispatch.assign.sweepAcks()).toBe(1);
    await f.runJobs();
    expect(f.msg.whatsapped.map(m => m.to)).toEqual([r1.phone]);
  });
});

describe("what the orders module tells dispatch", () => {
  it("takes the order back from a rider when it is cancelled, and warns them when it is paid", async () => {
    const r = await onShift();
    const cancelled = ready(); const paid = ready();
    await assign(cancelled.id, r.id);
    await assign(paid.id, r.id);
    await f.mods.dispatch.hooks.onOrderPaid(paid.id);
    await f.mods.dispatch.hooks.onOrderCancelled(cancelled.id);
    await f.mods.dispatch.hooks.onOrderCancelled(ready().id);
    expect(await active(r)).toBe(1);
    expect(await assignmentDoc({ orderId: cancelled.id })).toMatchObject({ status: "cancelled", live: false, endReason: "order_cancelled" });
    expect(await feedOf(r)).toEqual(["assigned", "assigned", "payment_paid", "cancelled"]);
    await f.runJobs();
    expect(f.msg.pushed.map(p => p.data.type).sort()).toEqual(["assignment", "assignment", "assignment_cancelled", "payment_paid"]);
    expect(f.msg.pushed.find(p => p.data.type === "payment_paid")).toMatchObject({ title: "Already paid", body: `Order ${paid.orderNo} is already paid. Do not collect cash.` });
  });

  it("hands ready orders to the best rider in auto mode, and does nothing in manual mode", async () => {
    const near = await onShift({ name: "Near" });
    await onShift({ name: "Far" }, W1, { lat: 27.045, lng: 88.268 });
    const order = ready();
    expect(await f.mods.dispatch.hooks.autoAssignPending()).toBe(0);
    expect(f.orders.get(order.id).status).toBe("READY");

    const auto = createDev2Modules({
      connection: f.h.connection, storage: f.storage.provider, geography: f.geo.geography, orders: f.orders.port, riderIdentity: f.accounts.identity,
      deliverySettings: { assignmentMode: "auto" }, push: f.msg.push, whatsapp: f.msg.whatsapp, contacts: f.msg.contacts, devices: f.msg.devices,
      rider: riderFromHeader, auth: actorFromHeader,
    });
    expect(await auto.dispatch.hooks.autoAssignPending()).toBe(1);
    expect(f.orders.get(order.id).status).toBe("ASSIGNED");
    expect(await assignmentDoc({ orderId: order.id })).toMatchObject({ riderId: near.id, mode: "auto", assignedBy: null });
    expect(f.orders.log.at(-1)).toMatchObject({ to: "ASSIGNED", by: { kind: "system", id: "dispatch" } });
    expect(await auto.dispatch.hooks.autoAssignPending()).toBe(0);
  });

  it("leaves an order waiting when nobody can take it", async () => {
    const auto = createDev2Modules({ connection: f.h.connection, storage: f.storage.provider, geography: f.geo.geography, orders: f.orders.port, deliverySettings: { assignmentMode: "auto" } });
    const order = ready();
    expect(await auto.dispatch.hooks.autoAssignPending()).toBe(0);
    expect(f.orders.get(order.id).status).toBe("READY");
  });
});
