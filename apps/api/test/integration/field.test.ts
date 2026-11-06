import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, ZONE1, admin, asPrincipal, startFixture, type Fixture } from "./support/dev2-fixture.js";
import { AT_W1, goOnline, newRider, resetRiderCounter, type TestRider } from "./support/riders.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("field_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); resetRiderCounter(); });

const col = (name: string) => f.h.connection.collection(name);
const ready = (over: Record<string, unknown> = {}) => f.orders.add({ zoneId: ZONE1, warehouseId: W1, ...over });
async function onShift(over: Record<string, unknown> = {}) {
  const r = await newRider(f, over);
  await goOnline(f, r, W1, AT_W1);
  f.msg.person(r.userId, r.phone, [`tok-${r.id}`]);
  return r;
}
async function assigned(r: TestRider, over: Record<string, unknown> = {}) {
  const order = ready(over);
  const res = await f.send("post", `/admin/orders/${order.id}/assign`, { riderId: r.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { order, assignmentId: res.body.data.assignment.id as string };
}
const rider = (r: TestRider, method: "get" | "post", path: string, body?: Record<string, unknown>) => f.send(method, path, body, r.headers);
const pickup = (r: TestRider, id: string, bagCount: number | null = 2) => rider(r, "post", `/rider/orders/${id}/pickup`, { checklist: { itemsVerified: true, bagCount } });
/** Takes an order from assigned to the customer's door. */
async function toDoor(r: TestRider, id: string) {
  expect((await pickup(r, id)).status).toBe(200);
  expect((await rider(r, "post", `/rider/orders/${id}/start-ride`)).status).toBe(200);
  expect((await rider(r, "post", `/rider/orders/${id}/arrived`)).status).toBe(200);
}

describe("the rider's list of work", () => {
  it("shows what is current, with a cursor to ask for only what is new", async () => {
    const r = await onShift();
    expect((await rider(r, "get", "/rider/assignments")).body).toEqual({ data: [], meta: { cursor: "c_0" } });
    const { order, assignmentId } = await assigned(r);
    const all = await rider(r, "get", "/rider/assignments");
    expect(all.status).toBe(200);
    expect(all.body.meta.cursor).toBe("c_1");
    expect(all.body.data).toEqual([{
      event: "assigned",
      assignment: {
        id: assignmentId, status: "assigned", assignedAt: expect.stringMatching(/Z$/), ackDeadlineAt: expect.stringMatching(/Z$/), batch: null,
        orders: [expect.objectContaining({ id: order.id, orderNo: order.orderNo })],
      },
    }]);

    expect((await rider(r, "get", "/rider/assignments?since=c_1")).body).toEqual({ data: [], meta: { cursor: "c_1" } });
    await f.send("post", `/admin/orders/${order.id}/unassign`, { reason: "Changed plan" });
    const news = await rider(r, "get", "/rider/assignments?since=c_1");
    expect(news.body.data.map((e: { event: string }) => e.event)).toEqual(["cancelled"]);
    expect(news.body.meta.cursor).toBe("c_2");
    expect((await rider(r, "get", "/rider/assignments")).body.data).toEqual([]);
    expect((await rider(r, "get", "/rider/assignments?since=c_0")).body.data.map((e: { event: string }) => e.event)).toEqual(["assigned", "cancelled"]);
    expect((await rider(r, "get", "/rider/assignments?since=yesterday")).status).toBe(400);
  });

  it("only ever shows the rider's own work", async () => {
    const a = await onShift();
    const b = await onShift();
    await assigned(a);
    expect((await rider(b, "get", "/rider/assignments")).body.data).toEqual([]);
  });

  it("needs a signed-in rider", async () => {
    for (const [method, path] of [["get", "/rider/assignments"], ["get", "/rider/history"], ["get", `/rider/orders/${"9".repeat(24)}`], ["post", `/rider/assignments/${"9".repeat(24)}/ack`]] as const) {
      expect((await f.send(method, path, undefined, {})).status, path).toBe(401);
    }
  });
});

describe("acknowledging", () => {
  it("is done once, and only for the rider's own live assignment", async () => {
    const r = await onShift();
    const other = await onShift();
    const { assignmentId } = await assigned(r);
    expect((await rider(other, "post", `/rider/assignments/${assignmentId}/ack`)).status).toBe(404);
    const ok = await rider(r, "post", `/rider/assignments/${assignmentId}/ack`);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ id: assignmentId, status: "acknowledged", ackAt: expect.stringMatching(/Z$/) });
    const again = await rider(r, "post", `/rider/assignments/${assignmentId}/ack`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_ACKNOWLEDGED");
    expect((await rider(r, "post", `/rider/assignments/${"9".repeat(24)}/ack`)).status).toBe(404);
    expect((await rider(r, "post", "/rider/assignments/nope/ack")).status).toBe(404);
  });

  it("cannot be done after the order was taken back", async () => {
    const r = await onShift();
    const { order, assignmentId } = await assigned(r);
    await f.send("post", `/admin/orders/${order.id}/unassign`, { reason: "x" });
    expect((await rider(r, "post", `/rider/assignments/${assignmentId}/ack`)).status).toBe(404);
  });
});

describe("looking at an order", () => {
  it("shows the rider what they need and never the delivery code", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const res = await rider(r, "get", `/rider/orders/${order.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      id: order.id, orderNo: order.orderNo, status: "ASSIGNED", groupId: order.groupId,
      warehouse: { id: W1, name: expect.any(String), location: expect.any(Object) },
      paymentMethod: "cod", amountDue: 8800, alreadyPaid: false, otpRequired: true, batchStop: null,
    });
    expect(JSON.stringify(res.body)).not.toContain("4271");
    expect(Object.keys(res.body.data)).not.toContain("otp");
  });

  it("is not available for someone else's order or an unknown one", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    expect((await rider(other, "get", `/rider/orders/${order.id}`)).status).toBe(404);
    expect((await rider(r, "get", `/rider/orders/${"9".repeat(24)}`)).status).toBe(404);
    expect((await rider(r, "get", `/rider/orders/${ready().id}`)).status).toBe(404);
  });

  it("stays visible to the rider after they deliver it", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    f.orders.collect(order.id);
    expect((await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" })).status).toBe(200);
    expect((await rider(r, "get", `/rider/orders/${order.id}`)).body.data.status).toBe("DELIVERED");
  });

  it("tells batch riders which stop this is", async () => {
    const r = await onShift();
    const a = ready(); const b = ready();
    const batch = (await f.send("post", "/admin/batches", { riderId: r.id, orderIds: [a.id, b.id] })).body.data;
    await f.send("post", `/admin/orders/${a.id}/assign`, { riderId: r.id, batchId: batch.id });
    expect((await rider(r, "get", `/rider/orders/${a.id}`)).body.data.batchStop).toEqual({ seq: 2, of: 3 });
  });
});

describe("picking up", () => {
  it("moves the order on, counts as acknowledging, and records the bags", async () => {
    const r = await onShift();
    const { order, assignmentId } = await assigned(r);
    const res = await pickup(r, order.id, 3);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("PICKED_UP");
    expect(f.orders.get(order.id).status).toBe("PICKED_UP");
    expect(f.orders.log.at(-1)).toMatchObject({ to: "PICKED_UP", by: { kind: "rider", id: r.userId }, details: { bagCount: 3, itemsVerified: true } });
    expect(await col("assignments").findOne({ _id: assignmentId as never })).toMatchObject({ status: "acknowledged", ackAt: expect.any(Date), pickup: { at: expect.any(Date), bagCount: 3 } });
    expect((await f.get("/admin/dispatch/alerts")).body.data).toEqual([]);
  });

  it("needs the items checked, an order that is the rider's own, and the right state", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    expect((await rider(r, "post", `/rider/orders/${order.id}/pickup`, { checklist: { itemsVerified: false } })).status).toBe(400);
    expect((await rider(r, "post", `/rider/orders/${order.id}/pickup`, {})).status).toBe(400);
    expect((await pickup(other, order.id)).status).toBe(404);
    expect((await pickup(r, order.id)).status).toBe(200);
    const again = await pickup(r, order.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("starting the ride", () => {
  it("sends the order out for delivery", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await pickup(r, order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/start-ride`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("OUT_FOR_DELIVERY");
  });

  it("is refused before pickup", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const res = await rider(r, "post", `/rider/orders/${order.id}/start-ride`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { from: "ASSIGNED", to: "OUT_FOR_DELIVERY" } });
  });

  it("waits for every pickup in a batch", async () => {
    const r = await onShift();
    const a = ready({ warehouseId: W1 }); const b = ready({ warehouseId: W2 });
    const batch = (await f.send("post", "/admin/batches", { riderId: r.id, orderIds: [a.id, b.id] })).body.data;
    await f.send("post", `/admin/orders/${a.id}/assign`, { riderId: r.id, batchId: batch.id });
    await f.send("post", `/admin/orders/${b.id}/assign`, { riderId: r.id, batchId: batch.id });
    await pickup(r, a.id);
    const early = await rider(r, "post", `/rider/orders/${a.id}/start-ride`);
    expect(early.status).toBe(409);
    expect(early.body.error.details).toEqual({ reason: "pickups_pending" });
    expect((await col("delivery_batches").findOne({ _id: batch.id as never }))?.stops[0].status).toBe("done");
    await pickup(r, b.id);
    expect((await rider(r, "post", `/rider/orders/${a.id}/start-ride`)).status).toBe(200);
    expect((await col("delivery_batches").findOne({ _id: batch.id as never }))?.status).toBe("active");
  });
});

describe("arriving", () => {
  it("marks the order arrived with the position", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await pickup(r, order.id);
    await rider(r, "post", `/rider/orders/${order.id}/start-ride`);
    const res = await rider(r, "post", `/rider/orders/${order.id}/arrived`, { location: { lat: 27.05, lng: 88.27 } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ARRIVED");
    expect(f.orders.log.at(-1)).toMatchObject({ to: "ARRIVED", details: { location: { lat: 27.05, lng: 88.27 } } });
  });

  it("works without a position and is refused out of order", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    expect((await rider(r, "post", `/rider/orders/${order.id}/arrived`)).status).toBe(409);
    await pickup(r, order.id);
    await rider(r, "post", `/rider/orders/${order.id}/start-ride`);
    expect((await rider(r, "post", `/rider/orders/${order.id}/arrived`, { location: { lat: 200, lng: 0 } })).status).toBe(400);
    expect((await rider(r, "post", `/rider/orders/${order.id}/arrived`)).status).toBe(200);
  });

  it("arrives for every order of the same checkout dropped at the same door", async () => {
    const r = await onShift();
    const groupId = "7b".repeat(12);
    const a = ready({ groupId, warehouseId: W1 }); const b = ready({ groupId, warehouseId: W2 });
    const res = await f.send("post", `/admin/order-groups/${groupId}/dispatch`, { mode: "same_rider", riderId: r.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await pickup(r, a.id); await pickup(r, b.id);
    await rider(r, "post", `/rider/orders/${a.id}/start-ride`);
    await rider(r, "post", `/rider/orders/${b.id}/start-ride`);
    expect((await rider(r, "post", `/rider/orders/${a.id}/arrived`)).status).toBe(200);
    expect(f.orders.get(b.id).status).toBe("ARRIVED");
    const batch = await col("delivery_batches").findOne({ _id: res.body.data.batch.id as never });
    expect(batch?.stops.at(-1).status).toBe("arrived");
  });
});

describe("the delivery code", () => {
  it("checks the code without changing the order", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const ok = await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "4271" });
    expect(ok.body).toEqual({ data: { valid: true } });
    expect(f.orders.get(order.id).status).toBe("ARRIVED");
  });

  it("counts wrong tries and locks after the limit", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const wrong = await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "0000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: "OTP_MISMATCH", details: { attemptsLeft: 4 } });
    for (let i = 0; i < 3; i++) await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "0000" });
    const last = await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "0000" });
    expect(last.body.error.details.attemptsLeft).toBe(0);
    const locked = await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "4271" });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatchObject({ code: "OTP_LOCKED", details: { attemptsLeft: 0 } });
  });

  it("is checked for format and for who is asking, and passes when no code is needed", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r, { otpRequired: false });
    await toDoor(r, order.id);
    expect((await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "12" })).status).toBe(400);
    expect((await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "abcd" })).status).toBe(400);
    expect((await rider(other, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "4271" })).status).toBe(404);
    expect((await rider(r, "post", `/rider/orders/${order.id}/verify-otp`, { otp: "0000" })).body).toEqual({ data: { valid: true } });
  });
});

describe("delivering", () => {
  it("completes a prepaid order with the code, frees the rider and puts it in the history", async () => {
    const r = await onShift();
    const { order, assignmentId } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid", amountDue: 0 });
    await toDoor(r, order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271", location: { lat: 27.05, lng: 88.27 }, accuracyM: 15 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ id: order.id, status: "DELIVERED", deliveredAt: expect.stringMatching(/Z$/), groupStatus: expect.any(String) });
    expect(f.orders.get(order.id).status).toBe("DELIVERED");
    expect(await col("assignments").findOne({ _id: assignmentId as never })).toMatchObject({ status: "completed", live: false, outcome: "delivered", completedAt: expect.any(Date) });
    expect((await col("riders").findOne({ _id: r.id as never }))?.activeOrderCount).toBe(0);
    const hist = await rider(r, "get", "/rider/history");
    expect(hist.body.data).toEqual([expect.objectContaining({ orderId: order.id, orderNo: order.orderNo, status: "DELIVERED", deliveredAt: res.body.data.deliveredAt })]);
    expect(hist.body.meta).toEqual({ nextCursor: null, deliveredToday: 1 });
  });

  it("needs cash recorded first on a pay-on-delivery order", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const blocked = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toEqual({ reason: "collection_required" });
    f.orders.collect(order.id, "upi");
    expect((await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" })).status).toBe(200);
  });

  it("needs the right code, and counts wrong ones", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    f.orders.collect(order.id);
    expect((await rider(r, "post", `/rider/orders/${order.id}/deliver`, {})).status).toBe(400);
    const wrong = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "1111" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: "OTP_MISMATCH", details: { attemptsLeft: 4 } });
    expect(f.orders.get(order.id).status).toBe("ARRIVED");
  });

  it("does not need a code when the order has none", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { otpRequired: false, paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    expect((await rider(r, "post", `/rider/orders/${order.id}/deliver`, {})).status).toBe(200);
  });

  it("must come after arriving", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await pickup(r, order.id);
    f.orders.collect(order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("says so when it was already delivered, and uses the offline time within a day", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    const earlier = new Date(Date.now() - 30 * 60_000).toISOString();
    const done = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271", deliveredAt: earlier });
    expect(done.status).toBe(200);
    expect(done.body.data.deliveredAt).toBe(earlier);
    const again = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ reason: "already_delivered" });
  });

  it("refuses a delivery time in the future or over a day ago", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    for (const t of [new Date(Date.now() + 3_600_000), new Date(Date.now() - 2 * 24 * 3_600_000)]) {
      const res = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271", deliveredAt: t.toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ field: "deliveredAt" });
    }
    expect(f.orders.get(order.id).status).toBe("ARRIVED");
  });

  it("is only for the rider's own order", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    f.orders.collect(order.id);
    expect((await rider(other, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" })).status).toBe(404);
  });

  it("delivers every order of the checkout at the door with one code, skipping any whose cash is not yet recorded", async () => {
    const r = await onShift();
    const groupId = "5c".repeat(12);
    const a = ready({ groupId, warehouseId: W1 });
    const b = ready({ groupId, warehouseId: W2 });
    await f.send("post", `/admin/order-groups/${groupId}/dispatch`, { mode: "same_rider", riderId: r.id });
    await pickup(r, a.id); await pickup(r, b.id);
    await rider(r, "post", `/rider/orders/${a.id}/start-ride`);
    await rider(r, "post", `/rider/orders/${b.id}/start-ride`);
    await rider(r, "post", `/rider/orders/${a.id}/arrived`);
    expect(f.orders.get(b.id).status).toBe("ARRIVED");
    f.orders.collect(a.id);
    const res = await rider(r, "post", `/rider/orders/${a.id}/deliver`, { otp: "4271" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([f.orders.get(a.id).status, f.orders.get(b.id).status]).toEqual(["DELIVERED", "ARRIVED"]);
    f.orders.collect(b.id);
    expect((await rider(r, "post", `/rider/orders/${b.id}/deliver`, { otp: "4271" })).status).toBe(200);
    expect((await col("riders").findOne({ _id: r.id as never }))?.activeOrderCount).toBe(0);
    expect((await col("delivery_batches").findOne({}))?.status).toBe("done");
    expect((await rider(r, "get", "/rider/history")).body.meta.deliveredToday).toBe(2);
  });

  it("delivers a sibling together when its cash is already recorded", async () => {
    const r = await onShift();
    const groupId = "6d".repeat(12);
    const a = ready({ groupId, warehouseId: W1 });
    const b = ready({ groupId, warehouseId: W2 });
    await f.send("post", `/admin/order-groups/${groupId}/dispatch`, { mode: "same_rider", riderId: r.id });
    await pickup(r, a.id); await pickup(r, b.id);
    await rider(r, "post", `/rider/orders/${a.id}/start-ride`);
    await rider(r, "post", `/rider/orders/${b.id}/start-ride`);
    await rider(r, "post", `/rider/orders/${a.id}/arrived`);
    f.orders.collect(a.id); f.orders.collect(b.id);
    expect((await rider(r, "post", `/rider/orders/${a.id}/deliver`, { otp: "4271" })).status).toBe(200);
    expect([f.orders.get(a.id).status, f.orders.get(b.id).status]).toEqual(["DELIVERED", "DELIVERED"]);
    expect((await rider(r, "get", "/rider/history")).body.meta.deliveredToday).toBe(2);
  });
});

describe("a failed delivery", () => {
  it("is reported with a reason and ends the rider's job, leaving the order for dispatch", async () => {
    const r = await onShift();
    const { order, assignmentId } = await assigned(r);
    await toDoor(r, order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/failed`, { reason: "customer_unreachable", note: "Phone off" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("FAILED_DELIVERY");
    expect(await col("assignments").findOne({ _id: assignmentId as never })).toMatchObject({ status: "completed", live: false, outcome: "failed", endReason: "customer_unreachable" });
    expect((await col("riders").findOne({ _id: r.id as never }))?.activeOrderCount).toBe(0);
    expect(f.orders.log.at(-1)).toMatchObject({ to: "FAILED_DELIVERY", details: { reason: "customer_unreachable", note: "Phone off" } });
    const alert = ((await f.get("/admin/dispatch/alerts")).body.data as { type: string; reason?: string }[]).find(a => a.type === "failed_delivery");
    expect(alert).toMatchObject({ orderId: order.id, reason: "customer_unreachable" });
    const hist = await rider(r, "get", "/rider/history");
    expect(hist.body.data[0]).toMatchObject({ orderId: order.id, status: "FAILED_DELIVERY", deliveredAt: null });
    expect(hist.body.meta.deliveredToday).toBe(0);
  });

  it("can carry a photo as evidence, which only the rider's own upload may be", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const up = await f.send("post", "/media/upload-url", { kind: "failed_delivery_photo", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal(`rider:${r.userId}`));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    f.storage.upload(up.body.data.upload.fields.key);
    await f.send("post", "/media/complete", { mediaId: up.body.data.mediaId }, asPrincipal(`rider:${r.userId}`));
    const res = await rider(r, "post", `/rider/orders/${order.id}/failed`, { reason: "refused", photoMediaId: up.body.data.mediaId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await col("media_files").findOne({ _id: up.body.data.mediaId as never })).toMatchObject({ ownerType: "order", ownerId: order.id });
  });

  it("refuses an unknown photo without changing the order", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/failed`, { reason: "refused", photoMediaId: "9".repeat(24) });
    expect(res.status).toBe(404);
    expect(f.orders.get(order.id).status).toBe("ARRIVED");
  });

  it("needs a known reason, an order that is on its way, and the rider's own order", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    expect((await rider(r, "post", `/rider/orders/${order.id}/failed`, { reason: "bored" })).status).toBe(400);
    expect((await rider(r, "post", `/rider/orders/${order.id}/failed`, {})).status).toBe(400);
    const early = await rider(r, "post", `/rider/orders/${order.id}/failed`, { reason: "weather" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("INVALID_TRANSITION");
    await toDoor(r, order.id);
    expect((await rider(other, "post", `/rider/orders/${order.id}/failed`, { reason: "weather" })).status).toBe(404);
  });

  it("lets dispatch send the same order out again to a different rider", async () => {
    const r = await onShift();
    const next = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    await rider(r, "post", `/rider/orders/${order.id}/failed`, { reason: "customer_unreachable" });
    expect((await f.send("post", `/admin/orders/${order.id}/failed/resolve`, { action: "redispatch" })).status).toBe(200);
    expect((await f.send("post", `/admin/orders/${order.id}/assign`, { riderId: next.id })).status).toBe(200);
    expect((await rider(next, "get", `/rider/orders/${order.id}`)).status).toBe(200);
    expect((await rider(r, "get", `/rider/orders/${order.id}`)).status).toBe(200);
  });
});

describe("reporting a problem", () => {
  it("tells dispatch without changing anything", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await pickup(r, order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/problem`, { type: "vehicle_issue", note: "Flat tyre" });
    expect(res.body).toEqual({ data: { ok: true } });
    expect(f.orders.get(order.id).status).toBe("PICKED_UP");
    expect(await col("rider_problems").findOne({ orderId: order.id })).toMatchObject({ riderId: r.id, type: "vehicle_issue", note: "Flat tyre" });
    expect(((await f.get("/admin/dispatch/alerts")).body.data as { type: string; problem?: string }[]).find(a => a.type === "rider_problem")).toMatchObject({ orderId: order.id, problem: "vehicle_issue" });
  });

  it("needs a known type and the rider's own order", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    expect((await rider(r, "post", `/rider/orders/${order.id}/problem`, { type: "boredom" })).status).toBe(400);
    expect((await rider(other, "post", `/rider/orders/${order.id}/problem`, { type: "other" })).status).toBe(404);
  });
});

describe("the history", () => {
  async function deliverOne(r: TestRider, at?: Date) {
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    const res = await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271", ...(at && { deliveredAt: at.toISOString() }) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return order;
  }

  it("lists finished jobs newest first, in pages, for this rider only", async () => {
    const r = await onShift();
    const other = await onShift();
    const first = await deliverOne(r);
    const second = await deliverOne(r);
    const third = await deliverOne(r);
    await deliverOne(other);
    const page1 = await rider(r, "get", "/rider/history?limit=2");
    expect(page1.body.data.map((x: { orderId: string }) => x.orderId)).toEqual([third.id, second.id]);
    expect(page1.body.meta.nextCursor).toEqual(expect.stringMatching(/^[a-f0-9]{24}$/));
    const page2 = await rider(r, "get", `/rider/history?limit=2&cursor=${page1.body.meta.nextCursor}`);
    expect(page2.body.data.map((x: { orderId: string }) => x.orderId)).toEqual([first.id]);
    expect(page2.body.meta).toEqual({ nextCursor: null, deliveredToday: 3 });
    expect((await rider(r, "get", "/rider/history?limit=0")).status).toBe(400);
    expect((await rider(r, "get", "/rider/history?limit=101")).status).toBe(400);
    expect((await rider(r, "get", "/rider/history?cursor=zzz")).status).toBe(400);
  });

  it("can be limited to a time range, and counts only today's deliveries as today", async () => {
    const r = await onShift();
    await deliverOne(r);
    await col("assignments").updateOne({ riderId: r.id }, { $set: { completedAt: new Date(Date.now() - 3 * 24 * 3_600_000) } });
    await deliverOne(r);
    const all = await rider(r, "get", "/rider/history");
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta.deliveredToday).toBe(1);
    const recent = await rider(r, "get", `/rider/history?from=${new Date(Date.now() - 24 * 3_600_000).toISOString()}`);
    expect(recent.body.data).toHaveLength(1);
    const old = await rider(r, "get", `/rider/history?to=${new Date(Date.now() - 24 * 3_600_000).toISOString()}`);
    expect(old.body.data).toHaveLength(1);
  });
});

describe("ending a shift", () => {
  it("is refused while an order is still being carried, and allowed once it is delivered", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await pickup(r, order.id);
    expect((await rider(r, "post", "/rider/shift/end")).status).toBe(409);
    await rider(r, "post", `/rider/orders/${order.id}/start-ride`);
    await rider(r, "post", `/rider/orders/${order.id}/arrived`);
    await rider(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" });
    expect((await rider(r, "post", "/rider/shift/end")).status).toBe(200);
    expect(admin).toBeTruthy();
  });
});
