import { pbkdf2Sync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, admin, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { resetRiderCounter, type TestRider } from "./support/riders.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("sync_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); resetRiderCounter(); seq = 0; });

const { col, ready, onShift, assigned, as, pickup, toRoad, toDoor } = deliveryHelpers(() => f);
let seq = 0;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const AT_DOOR = { lat: 27.041, lng: 88.2663, accuracyM: 20 };
/** One queued event as the phone would write it. */
function ev(type: string, orderId: string | null, payload: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  seq++;
  return { clientEventId: randomUUID(), seq, type, ...(orderId && { orderId }), deviceTime: ago(1), gps: AT_DOOR, payload, ...over };
}
const sync = (r: TestRider, events: unknown[]) => as(r, "post", "/rider/sync", { events } as never);
const results = (res: { body: { data: { results: { result: string; reason?: string }[] } } }) => res.body.data.results.map(x => (x.reason ? `${x.result}:${x.reason}` : x.result));
const orderStatus = (id: string) => f.orders.get(id).status;
const deliverEvent = (orderId: string, over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) =>
  ev("deliver_offline", orderId, { otp: "4271", otpCheckedLocally: true, ...payload }, over);

describe("the offline bundle", () => {
  it("gives the phone what it needs to finish without signal, with the code only as a salted hash", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await col("media_files").insertOne({
      _id: order.housePhoto!.mediaId as never, kind: "order_photo", status: "ready", uploadedBy: "u", uploaderKind: "customer", ownerType: "order", ownerId: order.id,
      storage: { provider: "fake", key: "private/orders/house.jpg", resource: "image", access: "private", format: "jpg" }, variants: [], createdAt: new Date(), updatedAt: new Date(),
    });
    await pickup(r, order.id);
    const res = await as(r, "get", `/rider/orders/${order.id}/bundle`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = res.body.data;
    expect(b).toMatchObject({
      orderId: order.id, orderNo: order.orderNo, groupId: order.groupId,
      items: [{ name: "Fresh Tomato (Local)", variantLabel: "500 g", qty: 2 }],
      address: { line1: "Cedar Villa, 2nd floor", landmark: "Opposite Planters Club gate", locality: "Chowrasta", location: { lat: 27.041, lng: 88.2663 }, deliveryNotes: "Ring the bell twice" },
      customer: { name: "Asha Rai", phone: "+919876543210" }, amountDue: 8800, paymentMethod: "cod", paymentStatus: "cod_pending",
      upi: { vpa: "darjeelingstores@bank", payeeName: "Darjeeling Stores" }, geofenceMeters: 300, serverTime: expect.stringMatching(/Z$/),
    });
    expect(b.housePhoto).toEqual({ mediaId: order.housePhoto!.mediaId, url: expect.stringContaining("signed.fake.test"), expiresAt: expect.stringMatching(/Z$/) });
    expect(b.voiceNote).toBeNull();
    expect(b.otp).toMatchObject({ algo: "pbkdf2-sha256", iterations: 1000, attemptsMax: 5, salt: expect.stringMatching(/^b64:/), hash: expect.stringMatching(/^b64:/) });
    expect(JSON.stringify(res.body)).not.toContain("4271");
    const salt = Buffer.from(b.otp.salt.slice(4), "base64");
    expect(b.otp.hash).toBe(`b64:${pbkdf2Sync("4271", salt, 1000, 32, "sha256").toString("base64")}`);
    expect(b.otp.hash).not.toBe(`b64:${pbkdf2Sync("4272", salt, 1000, 32, "sha256").toString("base64")}`);
    // A fresh salt every time.
    expect((await as(r, "get", `/rider/orders/${order.id}/bundle`)).body.data.otp.salt).not.toBe(b.otp.salt);
  });

  it("has no code when the order needs none, and keeps working at the door", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { otpRequired: false });
    await toDoor(r, order.id);
    expect((await as(r, "get", `/rider/orders/${order.id}/bundle`)).body.data.otp).toBeNull();
  });

  it("waits for pickup, and is only for the rider's own order", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    const early = await as(r, "get", `/rider/orders/${order.id}/bundle`);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { from: "ASSIGNED" } });
    await pickup(r, order.id);
    expect((await as(other, "get", `/rider/orders/${order.id}/bundle`)).status).toBe(404);
    expect((await as(r, "get", `/rider/orders/${"9".repeat(24)}/bundle`)).status).toBe(404);
    expect((await f.get(`/rider/orders/${order.id}/bundle`, {})).status).toBe(401);
  });
});

describe("syncing the queue", () => {
  it("applies a whole offline delivery in order and says so for each event", async () => {
    const r = await onShift();
    const { order, assignmentId } = await assigned(r);
    const events = [
      ev("ack_assignment", null, { assignmentId }), ev("picked_up", order.id, { checklist: { itemsVerified: true, bagCount: 2 } }),
      ev("start_ride", order.id), ev("arrived", order.id), ev("collect_cash", order.id, { amount: 8800 }),
      deliverEvent(order.id, { deviceTime: ago(10) }),
    ];
    const res = await sync(r, events);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(results(res)).toEqual(Array(6).fill("applied"));
    expect(res.body.data.results.map((x: { clientEventId: string }) => x.clientEventId)).toEqual(events.map(e => e.clientEventId));
    expect(res.body.data.serverTime).toMatch(/Z$/);
    expect(orderStatus(order.id)).toBe("DELIVERED");
    expect(f.orders.get(order.id)).toMatchObject({ deliveredOffline: true, collectionMethod: "cash", collectionAmount: 8800 });
    expect(f.orders.get(order.id).deliveredAt!.toISOString()).toBe(events[5]!.deviceTime);
    expect(await col("cash_ledger").countDocuments({ orderId: order.id, type: "collected", amount: 8800 })).toBe(1);
    expect((await col("riders").findOne({ _id: r.id as never }))?.activeOrderCount).toBe(0);
    expect(await col("offline_reviews").countDocuments({})).toBe(0);
    expect((await col("sync_events").find({ riderId: r.id }).toArray()).map(e => e.result)).toEqual(Array(6).fill("applied"));
  });

  it("applies each event once however often the batch is sent", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const events = [ev("picked_up", order.id, { checklist: { itemsVerified: true } }), ev("start_ride", order.id), ev("arrived", order.id), ev("collect_cash", order.id, { amount: 8800 }), deliverEvent(order.id)];
    expect(results(await sync(r, events))).toEqual(Array(5).fill("applied"));
    expect(results(await sync(r, events))).toEqual(Array(5).fill("duplicate"));
    expect(results(await sync(r, [events[0]]))).toEqual(["duplicate"]);
    expect(await col("cash_ledger").countDocuments({})).toBe(1);
    expect(f.orders.log.filter(l => l.to === "DELIVERED")).toHaveLength(1);
  });

  it("handles two simultaneous sends of the same batch as one", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const events = [ev("picked_up", order.id, { checklist: { itemsVerified: true } }), ev("start_ride", order.id), ev("arrived", order.id)];
    const [a, b] = await Promise.all([sync(r, events), sync(r, events)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(f.orders.log.filter(l => l.to === "PICKED_UP")).toHaveLength(1);
    expect(f.orders.log.filter(l => l.to === "ARRIVED")).toHaveLength(1);
    expect(orderStatus(order.id)).toBe("ARRIVED");
  });

  it("works in sequence order even if the events are listed out of order, and answers in the order received", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const events = [ev("picked_up", order.id, { checklist: { itemsVerified: true } }), ev("start_ride", order.id), ev("arrived", order.id)];
    const res = await sync(r, [events[2], events[0], events[1]]);
    expect(results(res)).toEqual(["applied", "applied", "applied"]);
    expect(res.body.data.results.map((x: { clientEventId: string }) => x.clientEventId)).toEqual([events[2]!.clientEventId, events[0]!.clientEventId, events[1]!.clientEventId]);
    expect(orderStatus(order.id)).toBe("ARRIVED");
  });

  it("treats a step the order has already reached as a repeat, not a conflict", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await pickup(r, order.id);
    expect(results(await sync(r, [ev("picked_up", order.id, { checklist: { itemsVerified: true } })]))).toEqual(["duplicate"]);
    expect(f.orders.log.filter(l => l.to === "PICKED_UP")).toHaveLength(1);
  });

  it("refuses the whole request when it is malformed", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const good = ev("arrived", order.id);
    const bad = async (events: unknown[]) => (await sync(r, events)).status;
    expect(await bad([])).toBe(400);
    expect(await bad(Array.from({ length: 51 }, () => ev("arrived", order.id)))).toBe(400);
    expect(await bad([{ ...good, type: "teleport" }])).toBe(400);
    expect(await bad([{ ...good, orderId: undefined }])).toBe(400);
    expect(await bad([{ ...good, clientEventId: "x" }])).toBe(400);
    expect(await bad([good, { ...ev("start_ride", order.id), clientEventId: good.clientEventId }])).toBe(400);
    expect(await bad([ev("collect_cash", order.id, { amount: -5 })])).toBe(400);
    expect(await bad([ev("collect_cash", order.id, {})])).toBe(400);
    expect(await bad([deliverEvent(order.id, {}, { otp: "12" })])).toBe(400);
    expect(await bad([ev("failed_delivery", order.id, { reason: "bored" })])).toBe(400);
    expect(await bad([ev("ack_assignment", null, { assignmentId: "nope" })])).toBe(400);
    expect(await bad([{ ...good, gps: { lat: 100, lng: 0 } }])).toBe(400);
    expect(await bad([{ ...good, deviceTime: "yesterday" }])).toBe(400);
    expect((await f.send("post", "/rider/sync", { events: [good] }, {})).status).toBe(401);
    expect(await col("sync_events").countDocuments({})).toBe(0);
    expect(orderStatus(order.id)).toBe("ASSIGNED");
  });
});

describe("conflicts", () => {
  it("reports an order cancelled while the rider was offline", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    f.orders.setStatus(order.id, "CANCELLED");
    const res = await sync(r, [ev("picked_up", order.id, { checklist: { itemsVerified: true } })]);
    expect(res.body.data.results[0]).toEqual({ clientEventId: expect.any(String), result: "conflict", reason: "order_cancelled", message: "This order was cancelled." });
    expect(await col("sync_events").findOne({ riderId: r.id })).toMatchObject({ result: "conflict", reason: "order_cancelled" });
  });

  it("reports an order moved to another rider, and one that was never theirs", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r);
    await f.send("post", `/admin/orders/${order.id}/unassign`, { reason: "Swap" });
    await f.send("post", `/admin/orders/${order.id}/assign`, { riderId: other.id });
    const gone = await sync(r, [ev("arrived", order.id)]);
    expect(results(gone)).toEqual(["conflict:reassigned"]);
    expect(gone.body.data.results[0].message).toBe("This order was moved to another rider.");
    const stranger = ready();
    expect(results(await sync(r, [ev("arrived", stranger.id)]))).toEqual(["conflict:not_assigned_to_you"]);
    expect(results(await sync(r, [ev("arrived", "9".repeat(24))]))).toEqual(["conflict:not_assigned_to_you"]);
    expect(orderStatus(order.id)).toBe("ASSIGNED");
  });

  it("reports a step that does not fit, such as arriving before the ride", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await pickup(r, order.id);
    expect(results(await sync(r, [ev("arrived", order.id)]))).toEqual(["conflict:invalid_transition"]);
  });

  it("will not deliver a pay-on-delivery order whose cash was never recorded", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const res = await sync(r, [deliverEvent(order.id)]);
    expect(results(res)).toEqual(["conflict:invalid_transition"]);
    expect(res.body.data.results[0].message).toContain("Record the payment");
    expect(orderStatus(order.id)).toBe("ARRIVED");
  });

  it("tells a second rider that an order was already delivered, but a repeat by the same rider is only a repeat", async () => {
    const r = await onShift();
    const other = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    expect(results(await sync(r, [deliverEvent(order.id)]))).toEqual(["applied"]);
    expect(results(await sync(r, [deliverEvent(order.id)]))).toEqual(["duplicate"]);
    expect(results(await sync(other, [deliverEvent(order.id)]))).toEqual(["conflict:already_delivered"]);
  });

  it("acknowledges an assignment once, and only the rider's own", async () => {
    const r = await onShift();
    const other = await onShift();
    const { assignmentId } = await assigned(r);
    expect(results(await sync(other, [ev("ack_assignment", null, { assignmentId })]))).toEqual(["conflict:not_assigned_to_you"]);
    expect(results(await sync(r, [ev("ack_assignment", null, { assignmentId })]))).toEqual(["applied"]);
    expect(results(await sync(r, [ev("ack_assignment", null, { assignmentId })]))).toEqual(["duplicate"]);
  });
});

describe("offline delivery checks", () => {
  it("does not deliver when the server finds the code wrong, and sends it to an admin who can accept it", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    f.orders.collect(order.id);
    const res = await sync(r, [deliverEvent(order.id, {}, { otp: "0000" })]);
    expect(res.body.data.results[0]).toMatchObject({ result: "conflict", reason: "otp_mismatch", message: "The OTP did not match. An admin will review this delivery." });
    expect(orderStatus(order.id)).toBe("ARRIVED");
    const list = await f.get("/admin/offline-reviews");
    expect(list.body.data).toEqual([{
      orderId: order.id, orderNo: order.orderNo, riderName: r.name, deliveredAt: expect.stringMatching(/Z$/), syncedAt: expect.stringMatching(/Z$/), flags: ["otp_mismatch"],
      distanceFromAddressM: expect.any(Number), amountDue: 8800, collection: { method: "cash", amount: 8800 }, deliveryPending: true, reviewStatus: "open",
    }]);
    expect(list.body.meta).toEqual({ openCount: 1, nextCursor: null });

    const done = await f.send("post", `/admin/offline-reviews/${order.id}/resolve`, { outcome: "accepted", note: "Customer confirmed by phone" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ reviewStatus: "resolved", outcome: "accepted", note: "Customer confirmed by phone" });
    expect(orderStatus(order.id)).toBe("DELIVERED");
    expect(f.orders.get(order.id).deliveredOffline).toBe(true);
    expect((await col("riders").findOne({ _id: r.id as never }))?.activeOrderCount).toBe(0);
  });

  it("sends a rejected wrong-code delivery to failed delivery", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    f.orders.collect(order.id);
    await sync(r, [deliverEvent(order.id, {}, { otp: "0000" })]);
    const res = await f.send("post", `/admin/offline-reviews/${order.id}/resolve`, { outcome: "rejected", note: "Customer says nothing arrived" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(orderStatus(order.id)).toBe("FAILED_DELIVERY");
    expect(((await f.get("/admin/dispatch/alerts")).body.data as { type: string }[]).map(a => a.type)).toContain("failed_delivery");
  });

  it("delivers but flags a delivery far from the address, and lets the admin accept it", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    const res = await sync(r, [deliverEvent(order.id, { gps: { lat: 27.0468, lng: 88.2663, accuracyM: 15 } })]);
    expect(results(res)).toEqual(["applied"]);
    expect(orderStatus(order.id)).toBe("DELIVERED");
    const item = (await f.get("/admin/offline-reviews")).body.data[0];
    expect(item).toMatchObject({ flags: ["far_from_address"], deliveryPending: false, reviewStatus: "open" });
    expect(item.distanceFromAddressM).toBeGreaterThan(600);
    expect((await f.send("post", `/admin/offline-reviews/${order.id}/resolve`, { outcome: "accepted" })).status).toBe(200);
    expect(orderStatus(order.id)).toBe("DELIVERED");
  });

  it("takes back a delivery the admin rejects, so it can be resolved like any failed delivery", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    await sync(r, [deliverEvent(order.id, { gps: { lat: 27.0468, lng: 88.2663 } })]);
    const res = await f.send("post", `/admin/offline-reviews/${order.id}/resolve`, { outcome: "rejected", note: "Photo shows the wrong door" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(orderStatus(order.id)).toBe("FAILED_DELIVERY");
    const alert = ((await f.get("/admin/dispatch/alerts")).body.data as { type: string; orderId: string }[]).find(a => a.type === "failed_delivery");
    expect(alert?.orderId).toBe(order.id);
    const again = await f.send("post", `/admin/orders/${order.id}/failed/resolve`, { action: "redispatch" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(orderStatus(order.id)).toBe("READY");
  });

  it("flags a device clock that is far ahead and uses the server time instead", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(results(await sync(r, [deliverEvent(order.id, { deviceTime: future })]))).toEqual(["applied"]);
    expect(f.orders.get(order.id).deliveredAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await f.get("/admin/offline-reviews")).body.data[0].flags).toEqual(["time_skew"]);
  });

  it("flags several things at once", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    await sync(r, [deliverEvent(order.id, { deviceTime: new Date(Date.now() + 3_600_000).toISOString(), gps: { lat: 27.1, lng: 88.4 } })]);
    expect((await f.get("/admin/offline-reviews")).body.data[0].flags.sort()).toEqual(["far_from_address", "time_skew"]);
  });

  it("does not flag an ordinary offline delivery", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    await sync(r, [deliverEvent(order.id, { deviceTime: ago(30), gps: { lat: 27.0411, lng: 88.2664 } })]);
    expect((await f.get("/admin/offline-reviews")).body.data).toEqual([]);
  });

  it("lists reviews with filters and scope, and checks who may resolve them", async () => {
    const r = await onShift();
    const a = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, a.order.id);
    await sync(r, [deliverEvent(a.order.id, { gps: { lat: 27.0468, lng: 88.2663 } })]);
    expect((await f.get("/admin/offline-reviews?status=resolved")).body.data).toEqual([]);
    expect((await f.get(`/admin/offline-reviews?warehouseId=${W1}`)).body.data).toHaveLength(1);
    expect((await f.get(`/admin/offline-reviews?warehouseId=${W2}`)).body.data).toEqual([]);
    expect((await f.get("/admin/offline-reviews?status=weird")).status).toBe(400);
    expect((await f.get(`/admin/offline-reviews?warehouseId=${W1}`, scoped(W2))).status).toBe(403);
    expect((await f.get("/admin/offline-reviews", scoped(W2))).body.meta.openCount).toBe(0);
    expect((await f.get("/admin/offline-reviews", viewer)).status).toBe(403);
    expect((await f.get("/admin/offline-reviews", {})).status).toBe(401);
    const resolve = (body: Record<string, unknown>, who = admin) => f.send("post", `/admin/offline-reviews/${a.order.id}/resolve`, body, who);
    expect((await resolve({ outcome: "maybe" })).status).toBe(400);
    expect((await resolve({ outcome: "accepted" }, scoped(W2))).status).toBe(403);
    expect((await resolve({ outcome: "accepted" }, viewer)).status).toBe(403);
    expect((await f.send("post", `/admin/offline-reviews/${"9".repeat(24)}/resolve`, { outcome: "accepted" })).status).toBe(404);
    const both = await Promise.all([resolve({ outcome: "accepted" }), resolve({ outcome: "accepted" })]);
    expect(both.map(x => x.status).sort()).toEqual([200, 409]);
    expect((await resolve({ outcome: "accepted" })).body.error.details).toEqual({ reason: "already_resolved" });
    expect((await f.get("/admin/offline-reviews?status=resolved")).body.data).toHaveLength(1);
  });
});

describe("cash that arrives from the queue", () => {
  it("records doorstep UPI as unverified for the admin", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    expect(results(await sync(r, [ev("collect_upi_unverified", order.id, { amount: 8800, note: "GPay 11:02" })]))).toEqual(["applied"]);
    expect(f.orders.get(order.id)).toMatchObject({ collectionMethod: "upi_unverified", collectionAmount: 8800 });
    expect((await f.get("/admin/reconciliation")).body.data).toEqual([expect.objectContaining({ type: "upi_unverified", orderNo: order.orderNo })]);
    expect(await col("cash_ledger").countDocuments({})).toBe(0);
  });

  it("records cash taken on an order the customer had paid online as overpaid, ready for a refund", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    f.orders.patch(order.id, { alreadyPaid: true, paymentStatus: "paid" });
    const res = await sync(r, [ev("collect_cash", order.id, { amount: 8800 })]);
    expect(res.body.data.results[0]).toMatchObject({ result: "conflict", reason: "already_paid_online" });
    expect(await col("cash_ledger").findOne({ orderId: order.id })).toMatchObject({ amount: 8800, flags: ["overpaid"], riderId: r.id });
    const item = (await f.get("/admin/reconciliation")).body.data[0];
    expect(item).toMatchObject({ type: "overpaid", amount: 8800 });
    const refund = await f.send("post", `/admin/reconciliation/${item.id}/resolve`, { outcome: "refund" });
    expect(refund.body.data.refund).toEqual({ id: `refund-${order.id}`, amount: 8800 });
    expect(f.orders.get(order.id).collectionRecorded).toBe(false);
  });

  it("records cash on a cancelled or reassigned order as unmatched, never dropping it", async () => {
    const r = await onShift();
    const other = await onShift();
    const a = await assigned(r);
    const b = await assigned(r, { amountDue: 5000 });
    await toDoor(r, a.order.id);
    f.orders.setStatus(a.order.id, "CANCELLED");
    await f.send("post", `/admin/orders/${b.order.id}/unassign`, { reason: "Swap" });
    await f.send("post", `/admin/orders/${b.order.id}/assign`, { riderId: other.id });
    const res = await sync(r, [ev("collect_cash", a.order.id, { amount: 8800 }), ev("collect_cash", b.order.id, { amount: 5000 })]);
    expect(results(res)).toEqual(["conflict:order_cancelled", "conflict:reassigned"]);
    expect(await col("cash_ledger").countDocuments({ flags: "unmatched", riderId: r.id })).toBe(2);
    expect(await col("cash_reconciliation").countDocuments({ type: "unmatched", status: "open" })).toBe(2);
    expect(await f.get("/admin/cash/riders").then(x => x.body.meta.totalInHand)).toBe(13800);
    const unmatched = (await f.get("/admin/reconciliation?type=unmatched")).body.data[0];
    expect((await f.send("post", `/admin/reconciliation/${unmatched.id}/resolve`, { outcome: "adjust", amount: -unmatched.amount, note: "Returned" })).status).toBe(200);
  });

  it("records the real cash but reports a wrong amount", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    expect(results(await sync(r, [ev("collect_cash", order.id, { amount: 9000 })]))).toEqual(["conflict:invalid_transition"]);
    expect(await col("cash_ledger").findOne({ orderId: order.id })).toMatchObject({ amount: 9000, flags: ["unmatched"] });
    expect(f.orders.get(order.id).collectionRecorded).toBe(false);
  });

  it("treats cash already recorded online as a repeat", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    expect((await as(r, "post", `/rider/orders/${order.id}/collect-cash`, { amount: 8800 })).status).toBe(200);
    expect(results(await sync(r, [ev("collect_cash", order.id, { amount: 8800 })]))).toEqual(["duplicate"]);
    expect(await col("cash_ledger").countDocuments({})).toBe(1);
  });
});

describe("failures and positions from the queue", () => {
  it("applies a failed delivery once", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await toDoor(r, order.id);
    const res = await sync(r, [ev("failed_delivery", order.id, { reason: "customer_unreachable", note: "Phone off" })]);
    expect(results(res)).toEqual(["applied"]);
    expect(orderStatus(order.id)).toBe("FAILED_DELIVERY");
    expect(results(await sync(r, [ev("failed_delivery", order.id, { reason: "customer_unreachable" })]))).toEqual(["duplicate"]);
  });

  it("keeps the positions it receives, and reports them when the rider was not on shift", async () => {
    const r = await onShift();
    const points = [{ location: { lat: 27.05, lng: 88.27 }, accuracyM: 10, speedKmh: 20, at: new Date(Date.now() + 2000).toISOString() }];
    expect(results(await sync(r, [ev("location_batch", null, { points })]))).toEqual(["applied"]);
    expect(await col("rider_locations").countDocuments({ riderId: r.id })).toBe(1);
    await as(r, "post", "/rider/shift/end");
    expect(results(await sync(r, [ev("location_batch", null, { points: [{ ...points[0], at: new Date(Date.now() + 4000).toISOString() }] })]))).toEqual(["conflict:invalid_transition"]);
  });

  it("applies everything it can in a mixed batch", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const stranger = ready();
    const res = await sync(r, [ev("picked_up", order.id, { checklist: { itemsVerified: true } }), ev("arrived", stranger.id), ev("start_ride", order.id)]);
    expect(results(res)).toEqual(["applied", "conflict:not_assigned_to_you", "applied"]);
    expect(orderStatus(order.id)).toBe("OUT_FOR_DELIVERY");
    void toRoad;
  });
});
