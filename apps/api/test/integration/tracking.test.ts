import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "./support/harness.js";
import { customer, startFixture, W1, type Fixture } from "./support/dev2-fixture.js";
import { deliveryHelpers } from "./support/delivery.js";
import { AT_W1, newRider, resetRiderCounter, type TestRider } from "./support/riders.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("tracking_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); resetRiderCounter(); });

const { col, onShift, assigned, as, pickup, toRoad, toDoor } = deliveryHelpers(() => f);
const OWNER = customer("c".repeat(24));
const NEAR_HOME = { lat: 27.0412, lng: 88.2665 };
const ping = (r: TestRider, points: unknown) => as(r, "post", "/rider/location", { points } as never);
const point = (over: Record<string, unknown> = {}) => ({ location: AT_W1, accuracyM: 10, speedKmh: 18, at: new Date().toISOString(), ...over });
/** Times just after the rider punched in, so a ping is newer than the position the shift start recorded. */
const ahead = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
const riderDoc = (id: string) => col("riders").findOne({ _id: id as never });
const track = (orderId: string, who: Record<string, string> = OWNER) => f.get(`/orders/${orderId}/tracking`, who);

describe("the rider's location pings", () => {
  it("keeps every point, updates the rider's position, and says how often to ping", async () => {
    const r = await onShift();
    const res = await ping(r, [point({ at: ahead(1), location: { lat: 27.05, lng: 88.27 } }), point({ at: ahead(2), location: { lat: 27.051, lng: 88.271 } })]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ accepted: 2, nextPingSeconds: 60, serverTime: expect.stringMatching(/Z$/) });
    expect((await riderDoc(r.id))?.lastLocation).toMatchObject({ coordinates: [88.271, 27.051] });
    expect(await col("rider_locations").countDocuments({ riderId: r.id })).toBe(2);
    expect(await col("rider_locations").findOne({ riderId: r.id, accuracyM: 10 })).toMatchObject({ speedKmh: 18, location: expect.any(Object) });
    // Ping more often while carrying an order.
    await assigned(r);
    expect((await ping(r, [point()])).body.data.nextPingSeconds).toBe(10);
  });

  it("never lets an older buffered point replace a newer position, and ignores a replay", async () => {
    const r = await onShift();
    await ping(r, [point({ at: ahead(3), location: { lat: 27.06, lng: 88.28 } })]);
    const old = [point({ at: ahead(2), location: { lat: 27.01, lng: 88.21 } })];
    const res = await ping(r, old);
    expect(res.body.data.accepted).toBe(1);
    expect((await riderDoc(r.id))?.lastLocation).toMatchObject({ coordinates: [88.28, 27.06] });
    expect(await col("rider_locations").countDocuments({ riderId: r.id })).toBe(2);
    await ping(r, old);
    expect(await col("rider_locations").countDocuments({ riderId: r.id })).toBe(2);
  });

  it("handles a batch with a replayed point in the middle and keeps the rest", async () => {
    const r = await onShift();
    const a = point({ at: ahead(4) });
    await ping(r, [a]);
    const res = await ping(r, [point({ at: ahead(5) }), a, point({ at: ahead(3) })]);
    expect(res.status).toBe(200);
    expect(await col("rider_locations").countDocuments({ riderId: r.id })).toBe(3);
  });

  it("treats a time in the future as now and drops points older than a week", async () => {
    const r = await onShift();
    const res = await ping(r, [point({ at: new Date(Date.now() + 3_600_000).toISOString() }), point({ at: new Date(Date.now() - 8 * 86_400_000).toISOString() })]);
    expect(res.body.data.accepted).toBe(1);
    const stored = await col("rider_locations").find({ riderId: r.id }).toArray();
    expect(stored).toHaveLength(1);
    expect((stored[0]!.at as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("brings back a rider the server had marked offline for being silent", async () => {
    const r = await onShift();
    await col("riders").updateOne({ _id: r.id as never }, { $set: { status: "offline", autoOffline: true } });
    await ping(r, [point()]);
    expect(await riderDoc(r.id)).toMatchObject({ status: "online", autoOffline: false });
  });

  it("needs a rider on shift, and a valid request", async () => {
    const off = await newRider(f);
    const refused = await ping(off, [point()]);
    expect(refused.status).toBe(403);
    expect(await col("rider_locations").countDocuments({})).toBe(0);
    const r = await onShift();
    expect((await ping(r, [])).status).toBe(400);
    expect((await ping(r, Array.from({ length: 201 }, (_, i) => point({ at: ahead(i + 1) })))).status).toBe(400);
    expect((await ping(r, [point({ location: { lat: 91, lng: 0 } })])).status).toBe(400);
    expect((await ping(r, [point({ at: "yesterday" })])).status).toBe(400);
    expect((await ping(r, [point({ speedKmh: -5 })])).status).toBe(400);
    expect((await as(r, "post", "/rider/location", {})).status).toBe(400);
    expect((await f.send("post", "/rider/location", { points: [point()] }, {})).status).toBe(401);
    const big = await ping(r, Array.from({ length: 200 }, (_, i) => point({ at: ahead(i + 1) })));
    expect(big.body.data.accepted).toBe(200);
  });
});

describe("the live ETA", () => {
  async function onTheRoad() {
    const r = await onShift();
    const { order } = await assigned(r);
    await toRoad(r, order.id);
    return { r, order };
  }

  it("is worked out from the rider's position once the ride has started", async () => {
    const { r, order } = await onTheRoad();
    await ping(r, [point({ at: ahead(1), location: { lat: 27.0412, lng: 88.2665 } })]);
    const eta = await col("order_etas").findOne({ _id: order.id as never });
    expect(eta).toMatchObject({ riderId: r.id, minutes: 1, etaAt: expect.any(Date), updatedAt: expect.any(Date) });
    await ping(r, [point({ at: ahead(2), location: { lat: 27.07, lng: 88.3 } })]);
    // Within a minute of the last time: not worked out again.
    expect((await col("order_etas").findOne({ _id: order.id as never }))?.minutes).toBe(1);
    await col("order_etas").updateOne({ _id: order.id as never }, { $set: { updatedAt: new Date(Date.now() - 61_000) } });
    await ping(r, [point({ at: ahead(3), location: { lat: 27.07, lng: 88.3 } })]);
    const later = await col("order_etas").findOne({ _id: order.id as never });
    expect(later?.minutes).toBeGreaterThan(5);
  });

  it("is not worked out before the ride, or for an order the rider has finished", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    await ping(r, [point()]);
    expect(await col("order_etas").countDocuments({})).toBe(0);
    await toDoor(r, order.id);
    f.orders.collect(order.id);
    await as(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" });
    await col("order_etas").deleteMany({});
    await ping(r, [point({ at: ahead(4) })]);
    expect(await col("order_etas").countDocuments({})).toBe(0);
  });
});

describe("tracking an order as the customer", () => {
  it("shows only the promised time before the order is picked up", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const res = await track(order.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({
      orderId: order.id, orderNo: order.orderNo, status: "ASSIGNED",
      eta: { promisedAt: "2026-11-05T11:05:00.000Z", liveEtaMinutes: null, liveEtaAt: null, updatedAt: null },
      rider: null,
      timeline: [{ status: "ASSIGNED", at: expect.stringMatching(/Z$/) }],
      group: { groupNo: order.groupNo, children: [{ id: order.id, orderNo: order.orderNo, status: "ASSIGNED", promisedAt: "2026-11-05T11:05:00.000Z" }] },
      deliveryOtp: "4271",
    });
  });

  it("shows the rider, the position and the live ETA once the order is on the road", async () => {
    const r = await onShift({ name: "Pema Sherpa" });
    const { order } = await assigned(r);
    await pickup(r, order.id);
    await ping(r, [point({ location: NEAR_HOME, at: ahead(1) })]);
    const afterPickup = (await track(order.id)).body.data;
    expect(afterPickup.status).toBe("PICKED_UP");
    expect(afterPickup.rider).toEqual({ name: "Pema Sherpa", phone: r.phone, location: NEAR_HOME, lastLocationAt: expect.stringMatching(/Z$/) });
    expect(afterPickup.eta.liveEtaMinutes).toBeNull();

    await as(r, "post", `/rider/orders/${order.id}/start-ride`);
    await ping(r, [point({ location: NEAR_HOME, at: ahead(2) })]);
    const onRoad = (await track(order.id)).body.data;
    expect(onRoad.status).toBe("OUT_FOR_DELIVERY");
    expect(onRoad.eta).toMatchObject({ liveEtaMinutes: 1, liveEtaAt: expect.stringMatching(/Z$/), updatedAt: expect.stringMatching(/Z$/) });
    expect(onRoad.timeline.map((t: { status: string }) => t.status)).toEqual(["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"]);

    await as(r, "post", `/rider/orders/${order.id}/arrived`);
    const arrived = (await track(order.id)).body.data;
    expect(arrived.eta.liveEtaMinutes).toBe(0);
    expect(arrived.rider.location).toEqual(NEAR_HOME);
  });

  it("hides the rider and the code once the order is delivered", async () => {
    const r = await onShift();
    const { order } = await assigned(r, { paymentMethod: "online", alreadyPaid: true, paymentStatus: "paid" });
    await toDoor(r, order.id);
    await as(r, "post", `/rider/orders/${order.id}/deliver`, { otp: "4271" });
    const done = (await track(order.id)).body.data;
    expect(done).toMatchObject({ status: "DELIVERED", rider: null, deliveryOtp: null });
    expect(done.eta.liveEtaMinutes).toBeNull();
  });

  it("has no code when the order needs none, and lists the other orders of the checkout", async () => {
    const groupId = "7e".repeat(12);
    const a = f.orders.add({ zoneId: "1".repeat(24), warehouseId: W1, groupId, otpRequired: false });
    const b = f.orders.add({ zoneId: "1".repeat(24), warehouseId: W1, groupId, status: "PACKING" });
    const res = (await track(a.id)).body.data;
    expect(res.deliveryOtp).toBeNull();
    expect(res.group.children.map((c: { id: string; status: string }) => [c.id, c.status]).sort()).toEqual([[a.id, "READY"], [b.id, "PACKING"]].sort());
  });

  it("is only for the customer who placed the order", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    expect((await track(order.id, customer("d".repeat(24)))).status).toBe(404);
    expect((await track("9".repeat(24))).status).toBe(404);
    expect((await track("nope")).status).toBe(404);
    expect((await track(order.id, {})).status).toBe(401);
  });

  it("never shows another customer's stops to a customer, even when the rider carries both", async () => {
    const r = await onShift();
    const mine = await assigned(r);
    const theirs = await assigned(r, { customerUserId: "d".repeat(24), address: { line1: "Secret Villa", landmark: "x", locality: "Other", location: { lat: 27.1, lng: 88.3 }, locationAccuracyM: 10, deliveryNotes: null } });
    await pickup(r, mine.order.id);
    await pickup(r, theirs.order.id);
    const body = JSON.stringify((await track(mine.order.id)).body);
    expect(body).not.toContain(theirs.order.id);
    expect(body).not.toContain("Secret Villa");
  });
});

describe("the public tracking link", () => {
  const link = (orderId: string, hours?: number) => f.mods.tracking.service.link(orderId, hours);
  const open = (token: string) => request(f.app).get(`${api}/track/${token}`);

  it("works without a login and shows no address, phone or other customers", async () => {
    const r = await onShift({ name: "Pema Sherpa" });
    const { order } = await assigned(r);
    await pickup(r, order.id);
    await ping(r, [point({ location: NEAR_HOME, at: ahead(1) })]);
    const { token, expiresAt } = link(order.id);
    const res = await open(token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({
      orderNo: order.orderNo, status: "PICKED_UP",
      eta: { promisedAt: "2026-11-05T11:05:00.000Z", liveEtaMinutes: null, updatedAt: null },
      rider: { firstName: "Pema", location: NEAR_HOME, lastLocationAt: expect.stringMatching(/Z$/) },
      destination: { location: { lat: 27.041, lng: 88.2663 } },
      expiresAt: expiresAt.toISOString(),
    });
    const text = JSON.stringify(res.body);
    for (const secret of [r.phone, "Cedar Villa", "Asha", "Planters", order.customer.phone]) expect(text).not.toContain(secret);
  });

  it("has no rider before pickup", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    expect((await open(link(order.id).token)).body.data.rider).toBeNull();
  });

  it("answers 404 for a link that is wrong, expired, edited or taken back, so it cannot be probed", async () => {
    const r = await onShift();
    const { order } = await assigned(r);
    const { token } = link(order.id);
    expect((await open("garbage")).status).toBe(404);
    expect((await open(`${token}x`)).status).toBe(404);
    expect((await open(token.replace(/.$/, c => (c === "A" ? "B" : "A")))).status).toBe(404);
    expect((await open(`${Buffer.from(JSON.stringify({ o: order.id, e: Date.now() + 1e9 })).toString("base64url")}.${token.split(".")[1]}`)).status).toBe(404);
    expect((await open(link(order.id, -1).token)).status).toBe(404);
    expect((await open(link("9".repeat(24)).token)).status).toBe(404);
    expect((await open(token)).status).toBe(200);
    await f.mods.tracking.service.revoke(order.id);
    expect((await open(token)).status).toBe(404);
    expect((await open("a".repeat(500))).status).toBe(404);
  });
});
