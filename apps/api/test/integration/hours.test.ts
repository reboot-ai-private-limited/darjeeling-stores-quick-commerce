import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, CUSTOMER_B, W1, W2, W3, ZONE1, ZONE2, admin, customer, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { LOC1 } from "./support/fake-geography.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("hours_integration_test", { realOrders: true }); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); rev = 0; shelf = null; });

const A = customer(CUSTOMER_A);
const B = customer(CUSTOMER_B);
const col = (name: string) => f.h.connection.collection(name);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Open every day, all day. */
const ALWAYS = { hours: [{ days: ALL_DAYS, open: "00:00", close: "23:59" }], lastOrderMinutesBeforeClose: 0, afterHoursMode: "pre_order" };
/** Open every day except today (Indian time), so the store is closed right now. */
const CLOSED_TODAY = () => {
  const today = new Date(Date.now() + 5.5 * 3_600_000).getUTCDay();
  return { hours: [{ days: ALL_DAYS.filter(d => d !== today), open: "07:00", close: "20:00" }], lastOrderMinutesBeforeClose: 15, afterHoursMode: "pre_order" };
};
const SLOTS = { enabled: true, slots: [{ start: "07:00", end: "09:00", capacity: 2 }, { start: "09:00", end: "11:00", capacity: 5 }], cutoffMinutesBeforeSlot: 0, packLeadMinutes: 45 };
const setHours = (id: string, body: Record<string, unknown>, who = admin) => f.send("put", `/admin/warehouses/${id}/hours`, body, who);
const setPreorder = (id: string, body: Record<string, unknown>, who = admin) => f.send("put", `/admin/warehouses/${id}/preorder`, body, who);
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
async function cart(who = A) {
  const { tomato } = await shelves();
  const address = (await f.send("post", "/addresses", HOME, who)).body.data.id as string;
  await f.send("put", "/cart", { clientRev: ++rev, addressId: address, items: [{ productId: tomato.id, variantId: tomato.v500, qty: 2 }] }, who);
}
const quote = (body: Record<string, unknown> = {}, who = A) => f.send("post", "/quotes", { paymentMethod: "cod", ...body }, who);
/** Closes the store today with pre-orders on at the Chowrasta store. */
async function closedWithPreorders(slots = SLOTS) {
  expect((await setHours(W1, CLOSED_TODAY())).status).toBe(200);
  expect((await setHours(W2, { ...CLOSED_TODAY(), afterHoursMode: "closed" })).status).toBe(200);
  expect((await setPreorder(W1, slots)).status).toBe(200);
}
const firstSlot = async (index = 0) => {
  const res = await f.get(`/preorder/slots?zoneId=${ZONE1}`, A);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.slots[index] as { start: string; end: string; label: string; remaining: number; cutoffAt: string };
};

describe("warehouse hours", () => {
  it("saves hours and the after-hours mode, and shows them back", async () => {
    const body = { hours: [{ days: [1, 2, 3, 4, 5], open: "07:00", close: "20:00" }, { days: [0, 6], open: "09:00", close: "18:00" }], lastOrderMinutesBeforeClose: 15, afterHoursMode: "pre_order" };
    const res = await setHours(W1, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ warehouseId: W1, ...body, preOrder: { enabled: false, slots: [], cutoffMinutesBeforeSlot: 60, packLeadMinutes: 45 } });
    const again = await setHours(W1, { ...body, afterHoursMode: "closed" });
    expect(again.body.data.afterHoursMode).toBe("closed");
  });

  it("refuses wrong times, days, margins and modes", async () => {
    const ok = { hours: [{ days: [1], open: "07:00", close: "20:00" }], lastOrderMinutesBeforeClose: 15, afterHoursMode: "closed" };
    for (const bad of [
      { ...ok, hours: [] }, { ...ok, hours: [{ days: [], open: "07:00", close: "20:00" }] }, { ...ok, hours: [{ days: [9], open: "07:00", close: "20:00" }] },
      { ...ok, hours: [{ days: [1], open: "7am", close: "20:00" }] }, { ...ok, hours: [{ days: [1], open: "20:00", close: "07:00" }] },
      { ...ok, lastOrderMinutesBeforeClose: -1 }, { ...ok, afterHoursMode: "sometimes" }, { ...ok, extra: 1 },
    ]) expect((await setHours(W1, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await setHours("9".repeat(24), ok)).status).toBe(404);
  });

  it("needs the permission and the warehouse in the caller's scope", async () => {
    const ok = { hours: [{ days: [1], open: "07:00", close: "20:00" }], lastOrderMinutesBeforeClose: 15, afterHoursMode: "closed" };
    expect((await setHours(W1, ok, viewer)).status).toBe(403);
    expect((await setHours(W1, ok, {})).status).toBe(401);
    expect((await setHours(W1, ok, scoped(W2))).status).toBe(403);
    expect((await setHours(W1, ok, scoped(W1))).status).toBe(200);
  });

  it("closes the store outside the hours: browsing stays open, quotes say when it opens", async () => {
    await cart();
    expect((await quote()).status).toBe(201);
    await setHours(W1, CLOSED_TODAY());
    await setHours(W2, CLOSED_TODAY());
    await setHours(W3, CLOSED_TODAY());
    const res = await quote();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "STORE_CLOSED", details: { opensAt: expect.stringMatching(/Z$/), preOrderAvailable: false } });
    expect(new Date(res.body.error.details.opensAt).getTime()).toBeGreaterThan(Date.now());
    expect((await f.get(`/store/status?zoneId=${ZONE1}`, A)).status).toBe(200);
  });

  it("opens again inside the hours", async () => {
    await cart();
    await setHours(W1, ALWAYS);
    expect((await quote()).status).toBe(201);
  });
});

describe("pausing orders", () => {
  const pause = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/ops/pause", body, who);
  const resume = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/ops/resume", body, who);

  it("pauses a warehouse with a message, which blocks quotes while browsing works", async () => {
    await cart();
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const res = await pause({ scope: "warehouse", id: W1, message: "Road blocked at Chowrasta", until });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ scope: "warehouse", id: W1, pause: { active: true, message: "Road blocked at Chowrasta", until } });
    // The other warehouse of the zone is still open, so the zone still takes orders, but not from the paused one.
    expect((await quote()).status).toBe(409);
    await pause({ scope: "warehouse", id: W2, message: "Strike" });
    const blocked = await quote();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: "ZONE_PAUSED", details: { message: expect.any(String) } });
    expect((await f.get(`/store/status?zoneId=${ZONE1}`, A)).status).toBe(200);
  });

  it("pauses a whole zone and lets it resume", async () => {
    await cart();
    expect((await pause({ scope: "zone", id: ZONE1, message: "Landslide" })).status).toBe(200);
    const blocked = await quote();
    expect(blocked.body.error).toMatchObject({ code: "ZONE_PAUSED", details: { message: "Landslide" } });
    expect((await resume({ scope: "zone", id: ZONE1 })).body).toEqual({ data: { ok: true } });
    expect((await quote()).status).toBe(201);
    expect((await resume({ scope: "zone", id: ZONE1 })).status).toBe(200);
  });

  it("ends a timed pause on its own", async () => {
    await cart();
    await pause({ scope: "zone", id: ZONE1, message: "Short stop", until: new Date(Date.now() + 3_600_000).toISOString() });
    await col("ops_pauses").updateOne({ _id: `zone:${ZONE1}` as never }, { $set: { until: new Date(Date.now() - 1000) } });
    expect((await quote()).status).toBe(201);
  });

  it("checks the request, the target and who may do it", async () => {
    expect((await pause({ scope: "zone", id: "9".repeat(24) })).status).toBe(404);
    expect((await pause({ scope: "warehouse", id: "9".repeat(24) })).status).toBe(404);
    expect((await pause({ scope: "planet", id: ZONE1 })).status).toBe(400);
    expect((await pause({ scope: "zone", id: ZONE1, until: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await pause({ scope: "zone", id: ZONE1 }, viewer)).status).toBe(403);
    expect((await pause({ scope: "zone", id: ZONE1 }, {})).status).toBe(401);
    expect((await pause({ scope: "warehouse", id: W1 }, scoped(W2))).status).toBe(403);
    expect((await pause({ scope: "zone", id: ZONE1 }, scoped(W1))).status).toBe(403);
    expect((await pause({ scope: "zone", id: ZONE2 }, scoped(W3))).status).toBe(200);
    expect((await resume({ scope: "warehouse", id: W1 }, scoped(W2))).status).toBe(403);
    expect((await resume({ scope: "zone", id: ZONE1, extra: 1 })).status).toBe(400);
  });
});

describe("pre-order slots", () => {
  it("are saved with a cutoff and a packing lead, and refuse overlaps", async () => {
    await setHours(W1, ALWAYS);
    const res = await setPreorder(W1, SLOTS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.preOrder).toEqual(SLOTS);
    for (const bad of [
      { ...SLOTS, slots: [{ start: "07:00", end: "09:00", capacity: 5 }, { start: "08:00", end: "10:00", capacity: 5 }] }, { ...SLOTS, slots: [] }, { ...SLOTS, slots: [{ start: "09:00", end: "07:00", capacity: 5 }] },
      { ...SLOTS, slots: [{ start: "07:00", end: "09:00", capacity: 0 }] }, { ...SLOTS, cutoffMinutesBeforeSlot: -5 },
    ]) expect((await setPreorder(W1, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await setPreorder(W1, { ...SLOTS, enabled: false, slots: [] })).status).toBe(200);
    expect((await setPreorder("9".repeat(24), SLOTS)).status).toBe(404);
    expect((await setPreorder(W1, SLOTS, viewer)).status).toBe(403);
    expect((await setPreorder(W1, SLOTS, scoped(W2))).status).toBe(403);
  });

  it("can be set before the hours and are kept when the hours change", async () => {
    expect((await setPreorder(W1, SLOTS)).status).toBe(200);
    const hours = await setHours(W1, ALWAYS);
    expect(hours.body.data.preOrder).toEqual(SLOTS);
  });

  it("are listed for the customer only while the store is closed, with places left", async () => {
    await setHours(W1, ALWAYS);
    await setPreorder(W1, SLOTS);
    expect((await f.get(`/preorder/slots?zoneId=${ZONE1}`, A)).body.data).toEqual({ available: false, slots: [] });
    await closedWithPreorders();
    const res = await f.get(`/preorder/slots?zoneId=${ZONE1}`, A);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.slots[0]).toEqual({ start: expect.stringMatching(/T07:00:00\+05:30$/), end: expect.stringMatching(/T09:00:00\+05:30$/), label: expect.stringMatching(/7.9 AM$/), remaining: 2, cutoffAt: expect.stringMatching(/\+05:30$/) });
    expect(res.body.data.slots.map((s: { remaining: number }) => s.remaining).slice(0, 2)).toEqual([2, 5]);
    expect((await f.get("/preorder/slots", A)).status).toBe(400);
    expect((await f.get(`/preorder/slots?zoneId=${"9".repeat(24)}`, A)).status).toBe(404);
    expect((await f.get(`/preorder/slots?zoneId=${ZONE1}`, {})).status).toBe(401);
  });

  it("show no slots while paused or when the warehouse does not offer them", async () => {
    await setHours(W2, { ...CLOSED_TODAY(), afterHoursMode: "closed" });
    await setHours(W1, { ...CLOSED_TODAY(), afterHoursMode: "closed" });
    await setPreorder(W1, SLOTS);
    expect((await f.get(`/preorder/slots?zoneId=${ZONE1}`, A)).body.data.available).toBe(false);
    await setHours(W1, CLOSED_TODAY());
    expect((await f.get(`/preorder/slots?zoneId=${ZONE1}`, A)).body.data.available).toBe(true);
    await f.send("post", "/admin/ops/pause", { scope: "warehouse", id: W1 });
    expect((await f.get(`/preorder/slots?zoneId=${ZONE1}`, A)).body.data.available).toBe(false);
  });

  it("make the closed message say pre-orders are possible", async () => {
    await cart();
    await closedWithPreorders();
    await setHours(W2, CLOSED_TODAY());
    const res = await quote();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "STORE_CLOSED", details: { preOrderAvailable: true } });
  });
});

describe("ordering for a slot", () => {
  async function preorder(who = A, slotIndex = 0) {
    await cart(who);
    const slot = await firstSlot(slotIndex);
    const q = await quote({ scheduledWindow: { start: slot.start, end: slot.end } }, who);
    return { slot, q };
  }
  const place = (quoteId: string, who = A) => f.send("post", "/orders", { quoteId, paymentMethod: "cod" }, { ...who, "Idempotency-Key": randomUUID() });

  it("is quoted at the slot's end, placed, and keeps its place in the slot", async () => {
    await closedWithPreorders();
    const { slot, q } = await preorder();
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body.data.scheduledWindow).toEqual({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString() });
    expect(q.body.data.allocation[0].eta.promisedAt).toBe(new Date(slot.end).toISOString());
    const res = await place(q.body.data.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const child = res.body.data.group.children[0];
    expect(child).toMatchObject({ status: "CONFIRMED", scheduledWindow: { start: new Date(slot.start).toISOString() } });
    expect((await firstSlot()).remaining).toBe(1);
    expect(await col("preorder_bookings").countDocuments({ _id: child.id as never })).toBe(1);
  });

  it("gives the place back when the order is cancelled", async () => {
    await closedWithPreorders();
    const { q } = await preorder();
    const child = (await place(q.body.data.id)).body.data.group.children[0];
    expect((await firstSlot()).remaining).toBe(1);
    expect((await f.send("post", `/admin/orders/${child.id}/cancel`, { reason: "Changed mind" })).status).toBe(200);
    expect((await firstSlot()).remaining).toBe(2);
    expect(await col("preorder_bookings").countDocuments({})).toBe(0);
  });

  it("refuses once the slot is full, and never lets more orders in than the capacity", async () => {
    await closedWithPreorders({ ...SLOTS, slots: [{ start: "07:00", end: "09:00", capacity: 1 }, { start: "09:00", end: "11:00", capacity: 5 }] });
    const first = await preorder(A);
    const second = await preorder(B);
    expect(first.q.status).toBe(201);
    expect(second.q.status).toBe(201);
    const results = await Promise.all([place(first.q.body.data.id, A), place(second.q.body.data.id, B)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const refused = results.find(r => r.status === 409)!;
    expect(refused.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "slot_full" } });
    expect(await col("preorder_bookings").countDocuments({})).toBe(1);
    expect((await firstSlot()).remaining).toBe(0);
    // A full slot stops new quotes too, and the stock the refused order took is back.
    await cart(B);
    const slot = await firstSlot();
    const again = await quote({ scheduledWindow: { start: slot.start, end: slot.end } }, B);
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ reason: "slot_full" });
    expect((await col("warehouse_products").findOne({ warehouseId: W1 }))!.stockGrams).toBe(20_000 - 1000);
  });

  it("refuses a slot that does not exist, a pre-order while open, and a paused store", async () => {
    await closedWithPreorders();
    await cart();
    const slot = await firstSlot();
    expect((await quote({ scheduledWindow: { start: slot.start, end: new Date(new Date(slot.end).getTime() + 60_000).toISOString() } })).status).toBe(400);
    expect((await quote({ scheduledWindow: { start: "2026-12-01T07:00:00+05:30", end: "2026-12-01T09:00:00+05:30" } })).status).toBe(400);
    await f.send("post", "/admin/ops/pause", { scope: "zone", id: ZONE1, message: "Landslide" });
    expect((await quote({ scheduledWindow: { start: slot.start, end: slot.end } })).body.error.code).toBe("ZONE_PAUSED");
    await f.send("post", "/admin/ops/resume", { scope: "zone", id: ZONE1 });
    await setHours(W1, ALWAYS);
    const open = await quote({ scheduledWindow: { start: slot.start, end: slot.end } });
    expect(open.status).toBe(400);
    expect(open.body.error.details).toEqual({ field: "scheduledWindow" });
  });

  it("refuses a slot whose booking time has passed", async () => {
    await closedWithPreorders({ ...SLOTS, cutoffMinutesBeforeSlot: 0, slots: [{ start: "07:00", end: "09:00", capacity: 5 }] });
    await cart();
    const slot = await firstSlot();
    await col("warehouse_hours").updateOne({ _id: W1 as never }, { $set: { "preOrder.cutoffMinutesBeforeSlot": 60 * 24 * 3 } });
    const res = await quote({ scheduledWindow: { start: slot.start, end: slot.end } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "cutoff_passed" } });
  });

  it("is listed for the packing team with when to start packing and how full each slot is", async () => {
    await closedWithPreorders();
    const a = await preorder(A);
    await place(a.q.body.data.id, A);
    const date = a.slot.start.slice(0, 10);
    const res = await f.get(`/admin/preorders?date=${date}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([{
      orderId: expect.any(String), orderNo: expect.stringMatching(/^DS-/), scheduledWindow: { start: a.slot.start, end: a.slot.end }, status: "CONFIRMED", itemCount: 2,
      packingStartsAt: expect.stringMatching(/T06:15:00\+05:30$/),
    }]);
    expect(res.body.meta.count).toBe(1);
    expect(res.body.meta.bySlot).toEqual([{ start: "07:00", booked: 1, capacity: 2 }, { start: "09:00", booked: 0, capacity: 5 }]);
    expect((await f.get(`/admin/preorders?date=${date}&warehouseId=${W2}`)).body.data).toEqual([]);
    expect((await f.get(`/admin/preorders?date=${date}&slotStart=09:00`)).body.data).toEqual([]);
    expect((await f.get(`/admin/preorders?date=${date}&slotStart=07:00`)).body.data).toHaveLength(1);
    expect((await f.get("/admin/preorders?date=tomorrow")).status).toBe(400);
    expect((await f.get(`/admin/preorders?date=${date}`, viewer)).status).toBe(403);
    expect((await f.get(`/admin/preorders?date=${date}&warehouseId=${W1}`, scoped(W2))).status).toBe(403);
    expect((await f.get(`/admin/preorders?date=${date}`, scoped(W2))).body.data).toEqual([]);
    expect((await f.get(`/admin/preorders?date=${date}`, {})).status).toBe(401);
  });
});

describe("reading a warehouse's hours (for the admin editor)", () => {
  it("shows the defaults before the first save, then what was saved, and any pause", async () => {
    const before = await f.get(`/admin/warehouses/${W1}/hours`, admin);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.data).toMatchObject({ configured: false, hours: [], lastOrderMinutesBeforeClose: 15, afterHoursMode: "closed", pause: null, warehouse: { id: W1 } });
    expect(before.body.data.preOrder).toMatchObject({ enabled: false, slots: [], cutoffMinutesBeforeSlot: 60, packLeadMinutes: 45 });

    expect((await setHours(W1, ALWAYS)).status).toBe(200);
    expect((await setPreorder(W1, SLOTS)).status).toBe(200);
    const saved = (await f.get(`/admin/warehouses/${W1}/hours`, admin)).body.data;
    expect(saved).toMatchObject({ configured: true, lastOrderMinutesBeforeClose: 0, afterHoursMode: "pre_order", pause: null });
    expect(saved.hours).toEqual(ALWAYS.hours);
    expect(saved.preOrder.slots).toHaveLength(2);

    expect((await f.send("post", "/admin/ops/pause", { scope: "warehouse", id: W1, message: "Road blocked", until: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200);
    expect((await f.get(`/admin/warehouses/${W1}/hours`, admin)).body.data.pause).toMatchObject({ active: true, message: "Road blocked" });
    await f.send("post", "/admin/ops/resume", { scope: "warehouse", id: W1 });
    expect((await f.get(`/admin/warehouses/${W1}/hours`, admin)).body.data.pause).toBeNull();
  });

  it("keeps staff to their own warehouses and needs a login", async () => {
    expect((await f.get(`/admin/warehouses/${W2}/hours`, scoped(W1))).status).toBe(403);
    expect((await f.get(`/admin/warehouses/${W1}/hours`, {})).status).toBe(401);
    expect((await f.get(`/admin/warehouses/${"e".repeat(24)}/hours`, admin)).status).toBe(404);
  });
});
