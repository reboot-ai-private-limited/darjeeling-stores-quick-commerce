import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { W1, W2, W3, ZONE1, ZONE2, admin, asPrincipal, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";
import { AT_W1, goOnline, newRider, resetRiderCounter } from "./support/riders.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("riders_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); resetRiderCounter(); });

const col = (name: string) => f.h.connection.collection(name);
const riderDoc = (id: string) => col("riders").findOne({ _id: id as never });
const shiftDoc = (id: string) => col("rider_shifts").findOne({ _id: id as never });
const MALL_ROAD = { lat: 27.0432, lng: 88.2641 };
const FAR = { lat: 27.09, lng: 88.29 };

describe("registering riders", () => {
  it("creates the rider and their login together, records who did it, and starts them offline", async () => {
    const res = await f.send("post", "/admin/riders", { name: "Pema Sherpa", phone: "98000 00010", zoneId: ZONE1, warehouseIds: [W1, W2, W1], vehicle: "Scooter" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/), userId: expect.any(String), name: "Pema Sherpa", phone: "+919800000010", zoneId: ZONE1, warehouseIds: [W1, W2],
      currentWarehouseId: null, vehicle: "Scooter", status: "offline", activeOrderCount: 0, lastLocation: null, lastLocationAt: null, appVersion: null,
      pendingSyncCount: 0, isActive: true,
    });
    expect([...f.accounts.accounts.values()]).toEqual([expect.objectContaining({ userId: res.body.data.userId, name: "Pema Sherpa", phone: "+919800000010", active: true })]);
  });

  it("refuses a phone that already has an account, and a rider whose warehouses are outside the zone", async () => {
    await newRider(f, { phone: "9800000010" });
    const again = await f.send("post", "/admin/riders", { name: "Other", phone: "+919800000010", zoneId: ZONE1, warehouseIds: [W1] });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "CONFLICT", details: { field: "phone" } });
    expect(await col("riders").countDocuments({})).toBe(1);

    const outside = await f.send("post", "/admin/riders", { name: "Far", phone: "9800000011", zoneId: ZONE1, warehouseIds: [W1, W3] });
    expect(outside.status).toBe(400);
    expect(outside.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { reason: "warehouse_outside_zone", warehouseId: W3 } });
    expect((await f.send("post", "/admin/riders", { name: "Z", phone: "9800000012", zoneId: "9".repeat(24), warehouseIds: [W1] })).status).toBe(404);
    expect((await f.send("post", "/admin/riders", { name: "W", phone: "9800000013", zoneId: ZONE1, warehouseIds: ["9".repeat(24)] })).status).toBe(404);
    expect(f.accounts.accounts.size).toBe(1);
  });

  it("checks the request and the caller", async () => {
    const ok = { name: "Pema", phone: "9800000010", zoneId: ZONE1, warehouseIds: [W1] };
    const bad = async (over: Record<string, unknown>) => (await f.send("post", "/admin/riders", { ...ok, ...over })).status;
    expect(await bad({ name: "" })).toBe(400);
    expect(await bad({ phone: "12345" })).toBe(400);
    expect(await bad({ warehouseIds: [] })).toBe(400);
    expect(await bad({ zoneId: "zone_1" })).toBe(400);
    expect(await bad({ extra: 1 })).toBe(400);
    expect((await f.send("post", "/admin/riders", ok, viewer)).status).toBe(403);
    expect((await f.send("post", "/admin/riders", ok, {})).status).toBe(401);
    expect((await f.send("post", "/admin/riders", { ...ok, warehouseIds: [W2] }, scoped(W1))).status).toBe(403);
    expect((await f.send("post", "/admin/riders", ok, scoped(W1))).status).toBe(201);
  });
});

describe("finding riders", () => {
  it("lists and filters riders and shows one", async () => {
    const pema = await newRider(f, { name: "Pema Sherpa" });
    const tashi = await newRider(f, { name: "Tashi Lepcha", warehouseIds: [W2] });
    const karma = await newRider(f, { name: "Karma Bhutia", zoneId: ZONE2, warehouseIds: [W3] });
    await goOnline(f, pema);
    const names = async (q: string) => (await f.get(`/admin/riders${q}`)).body.data.map((r: { name: string }) => r.name);
    expect(await names("")).toEqual(["Karma Bhutia", "Pema Sherpa", "Tashi Lepcha"]);
    expect(await names(`?zoneId=${ZONE1}`)).toEqual(["Pema Sherpa", "Tashi Lepcha"]);
    expect(await names(`?warehouseId=${W2}`)).toEqual(["Pema Sherpa", "Tashi Lepcha"]);
    expect(await names(`?warehouseId=${W3}`)).toEqual(["Karma Bhutia"]);
    expect(await names("?status=online")).toEqual(["Pema Sherpa"]);
    expect(await names("?status=offline")).toEqual(["Karma Bhutia", "Tashi Lepcha"]);
    expect(await names("?q=lepcha")).toEqual(["Tashi Lepcha"]);
    expect(await names(`?q=${tashi.phone.slice(-4)}`)).toEqual(["Tashi Lepcha"]);
    expect((await f.get("/admin/riders")).body.meta).toEqual({ count: 3 });
    const one = await f.get(`/admin/riders/${pema.id}`);
    expect(one.body.data).toMatchObject({ id: pema.id, status: "online", currentWarehouseId: W1, lastLocation: AT_W1, lastLocationAt: expect.stringMatching(/Z$/) });
    expect((await f.get(`/admin/riders/${"9".repeat(24)}`)).status).toBe(404);
    expect((await f.get("/admin/riders/not-an-id")).status).toBe(404);
    expect((await f.get("/admin/riders?status=lost")).status).toBe(400);
    expect(karma.id).toBeTruthy();
  });

  it("shows a scoped admin only the riders of their warehouses, and the permission is needed", async () => {
    const here = await newRider(f, { name: "Here", warehouseIds: [W1] });
    const there = await newRider(f, { name: "There", zoneId: ZONE2, warehouseIds: [W3] });
    const mine = await f.get("/admin/riders", scoped(W1));
    expect(mine.body.data.map((r: { name: string }) => r.name)).toEqual(["Here"]);
    expect((await f.get(`/admin/riders/${here.id}`, scoped(W1))).status).toBe(200);
    expect((await f.get(`/admin/riders/${there.id}`, scoped(W1))).status).toBe(404);
    expect((await f.get("/admin/riders", viewer)).status).toBe(403);
    expect((await f.get("/admin/riders", {})).status).toBe(401);
  });
});

describe("changing riders", () => {
  it("edits name, vehicle and warehouses, renames the login, and records it", async () => {
    const r = await newRider(f, { name: "Pema" });
    const res = await f.send("put", `/admin/riders/${r.id}`, { name: "Pema Sherpa", vehicle: "Bike", warehouseIds: [W2] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Pema Sherpa", vehicle: "Bike", warehouseIds: [W2] });
    expect(f.accounts.accounts.get(r.userId)!.name).toBe("Pema Sherpa");
    expect((await f.send("put", `/admin/riders/${r.id}`, { vehicle: null })).body.data.vehicle).toBeNull();
  });

  it("keeps the zone rule on every change", async () => {
    const r = await newRider(f);
    expect((await f.send("put", `/admin/riders/${r.id}`, { warehouseIds: [W3] })).status).toBe(400);
    expect((await f.send("put", `/admin/riders/${r.id}`, { zoneId: ZONE2 })).status).toBe(400);
    const moved = await f.send("put", `/admin/riders/${r.id}`, { zoneId: ZONE2, warehouseIds: [W3] });
    expect(moved.body.data).toMatchObject({ zoneId: ZONE2, warehouseIds: [W3] });
    expect((await f.send("put", `/admin/riders/${"9".repeat(24)}`, { name: "x" })).status).toBe(404);
    expect((await f.send("put", `/admin/riders/${r.id}`, { phone: "9800000099" })).status).toBe(400);
    expect((await f.send("put", `/admin/riders/${r.id}`, { name: "" })).status).toBe(400);
  });

  it("does not let a rider on shift change zone or lose the warehouse they are working at", async () => {
    const r = await newRider(f);
    await goOnline(f, r);
    const zone = await f.send("put", `/admin/riders/${r.id}`, { zoneId: ZONE2, warehouseIds: [W3] });
    expect(zone.status).toBe(409);
    expect(zone.body.error.details).toEqual({ reason: "on_shift" });
    const away = await f.send("put", `/admin/riders/${r.id}`, { warehouseIds: [W2] });
    expect(away.status).toBe(409);
    expect(away.body.error.details).toEqual({ reason: "current_warehouse" });
    expect((await f.send("put", `/admin/riders/${r.id}`, { warehouseIds: [W1] })).status).toBe(200);
  });

  it("takes a profile picture the admin uploaded, and replaces it", async () => {
    const r = await newRider(f);
    const upload = async () => {
      const res = await f.send("post", "/media/upload-url", { kind: "rider_photo", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal("admin"));
      f.storage.upload(res.body.data.upload.fields.key);
      await f.send("post", "/media/complete", { mediaId: res.body.data.mediaId }, asPrincipal("admin"));
      return { id: res.body.data.mediaId as string, key: res.body.data.upload.fields.key as string };
    };
    const first = await upload();
    expect((await f.send("put", `/admin/riders/${r.id}`, { photoMediaId: first.id })).status).toBe(200);
    expect((await f.get("/rider/me", r.headers)).body.data.photo).toEqual({ mediaId: first.id });
    const second = await upload();
    await f.send("put", `/admin/riders/${r.id}`, { photoMediaId: second.id });
    expect(f.storage.removed).toEqual([first.key]);
    expect((await f.send("put", `/admin/riders/${r.id}`, { photoMediaId: "9".repeat(24) })).status).toBe(404);
  });

  it("switches a rider off and on: no login, no shift, sessions ended", async () => {
    const r = await newRider(f);
    const shift = await goOnline(f, r);
    const off = await f.send("post", `/admin/riders/${r.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ status: "deactivated", isActive: false });
    expect(f.accounts.accounts.get(r.userId)!.active).toBe(false);
    expect(await shiftDoc(shift.shiftId)).toMatchObject({ endedBy: "admin", endedAt: expect.any(Date) });
    expect((await f.get("/rider/me", r.headers)).status).toBe(403);
    expect((await f.send("post", "/rider/shift/start", { warehouseId: W1, location: AT_W1 }, r.headers)).status).toBe(403);
    expect((await f.get("/admin/riders?status=deactivated")).body.data.map((x: { id: string }) => x.id)).toEqual([r.id]);

    const on = await f.send("post", `/admin/riders/${r.id}/reactivate`);
    expect(on.body.data).toMatchObject({ status: "offline", isActive: true });
    expect(f.accounts.accounts.get(r.userId)!.active).toBe(true);
    expect((await f.get("/rider/me", r.headers)).status).toBe(200);
    expect((await f.send("post", `/admin/riders/${r.id}/deactivate`, undefined, viewer)).status).toBe(403);
  });

  it("ends a shift from the admin side, unless the rider is carrying orders", async () => {
    const r = await newRider(f);
    const shift = await goOnline(f, r);
    // An order the rider has already collected from the warehouse.
    const at = new Date();
    await col("assignments").insertOne({
      _id: "c".repeat(24) as never, orderId: "d".repeat(24), riderId: r.id, batchId: null, status: "acknowledged", live: true, mode: "manual", assignedBy: null, assignedAt: at,
      ackDeadlineAt: at, ackAt: at, escalatedAt: null, whatsappSentAt: null, outcome: null, completedAt: null, endedAt: null, endReason: null, handoverFromId: null,
      zoneId: ZONE1, warehouseId: W1, groupId: "e".repeat(24), pickup: { at, bagCount: 1 }, failedResolvedAt: null, createdAt: at, updatedAt: at,
    });
    const refused = await f.send("post", `/admin/riders/${r.id}/force-offline`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: "picked_up_orders" });
    expect((await riderDoc(r.id))?.status).toBe("online");
    const forced = await f.send("post", `/admin/riders/${r.id}/force-offline`, { force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.data.status).toBe("offline");
    expect(await shiftDoc(shift.shiftId)).toMatchObject({ endedBy: "admin" });
    expect((await f.send("post", `/admin/riders/${r.id}/force-offline`, { force: "yes" })).status).toBe(400);
    // Nothing left to end: asking again is harmless.
    expect((await f.send("post", `/admin/riders/${r.id}/force-offline`, { force: true })).status).toBe(200);
  });
});

describe("shifts and attendance", () => {
  it("lists a rider's shifts and everyone's, with filters and paging", async () => {
    const a = await newRider(f, { name: "A" });
    const b = await newRider(f, { name: "B" });
    await goOnline(f, a, W1);
    await f.send("post", "/rider/shift/end", undefined, a.headers);
    await goOnline(f, a, W2, MALL_ROAD);
    await goOnline(f, b, W1);
    const all = await f.get("/admin/shifts");
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(3);
    expect(all.body.data[0]).toEqual({
      id: expect.any(String), riderId: b.id, warehouseId: W1, startedAt: expect.stringMatching(/Z$/), endedAt: null, punchIn: { distanceFromWarehouseM: expect.any(Number), verified: true }, breaks: [], endedBy: null,
    });
    const mine = await f.get(`/admin/riders/${a.id}/shifts`);
    expect(mine.body.data.map((s: { warehouseId: string; endedBy: string | null }) => [s.warehouseId, s.endedBy])).toEqual([[W2, null], [W1, "rider"]]);
    const page = await f.get("/admin/shifts?limit=2");
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.nextCursor).toBe(page.body.data[1].id);
    expect((await f.get(`/admin/shifts?limit=2&cursor=${page.body.meta.nextCursor}`)).body.data).toHaveLength(1);
    expect((await f.get(`/admin/shifts?riderId=${b.id}`)).body.data).toHaveLength(1);
    expect((await f.get(`/admin/shifts?warehouseId=${W2}`)).body.data).toHaveLength(1);
    expect((await f.get(`/admin/shifts?from=${new Date(Date.now() + 60_000).toISOString()}`)).body.data).toEqual([]);
    expect((await f.get(`/admin/riders/${"9".repeat(24)}/shifts`)).status).toBe(404);
    expect((await f.get("/admin/shifts?limit=0")).status).toBe(400);
    expect((await f.get("/admin/shifts", viewer)).status).toBe(403);
    expect((await f.get("/admin/shifts", {})).status).toBe(401);
    expect((await f.get("/admin/shifts", scoped(W2))).body.data).toHaveLength(1);
  });
});

describe("a rider's own profile", () => {
  it("shows the profile, warehouses and the settings the app reads", async () => {
    const r = await newRider(f, { name: "Pema Sherpa" });
    const res = await f.get("/rider/me", r.headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      riderId: r.id, name: "Pema Sherpa", phone: r.phone, photo: null, zoneId: ZONE1,
      warehouses: [{ id: W1, name: "Chowrasta store", location: AT_W1 }, { id: W2, name: "Mall Road store", location: MALL_ROAD }],
      status: "offline", currentWarehouseId: null, currentShift: null, activeOrderCount: 0, pendingSyncCount: 0,
      settings: { locationPingSecondsOnOrder: 10, locationPingSecondsIdle: 60, ackTimeoutSeconds: 120, deliveryOtpEnabled: true, maxActiveOrders: 2 },
    });
    const shift = await goOnline(f, r);
    const online = (await f.get("/rider/me", r.headers)).body.data;
    expect(online).toMatchObject({ status: "online", currentWarehouseId: W1, currentShift: { id: shift.shiftId, warehouseId: W1, startedAt: expect.stringMatching(/Z$/) } });
  });

  it("is only for signed-in, active, registered riders", async () => {
    expect((await f.get("/rider/me", {})).status).toBe(401);
    expect((await f.get("/rider/me", { "X-Test-Rider": "7".repeat(24) })).status).toBe(403);
    expect((await f.get("/rider/me", admin)).status).toBe(401);
  });
});

describe("starting a shift", () => {
  it("punches in, reporting the distance from the warehouse", async () => {
    const r = await newRider(f);
    const res = await f.send("post", "/rider/shift/start", { warehouseId: W1, location: { lat: 27.0411, lng: 88.2664 }, accuracyM: 12 }, r.headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ shiftId: expect.stringMatching(/^[a-f0-9]{24}$/), status: "online", punchIn: { distanceFromWarehouseM: expect.any(Number), verified: true }, currentWarehouseId: W1 });
    expect(res.body.data.punchIn.distanceFromWarehouseM).toBeLessThan(30);
    expect(await riderDoc(r.id)).toMatchObject({ status: "online", currentShiftId: res.body.data.shiftId, currentWarehouseId: W1, lastLocation: { type: "Point", coordinates: [88.2664, 27.0411] } });
    expect(await shiftDoc(res.body.data.shiftId)).toMatchObject({ riderId: r.id, warehouseId: W1, endedAt: null });
  });

  it("allows punching in from too far away but flags it for the admin", async () => {
    const r = await newRider(f);
    const res = await f.send("post", "/rider/shift/start", { warehouseId: W1, location: FAR }, r.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.punchIn).toEqual({ distanceFromWarehouseM: expect.any(Number), verified: false });
    expect(res.body.data.punchIn.distanceFromWarehouseM).toBeGreaterThan(150);
    expect((await f.get(`/admin/riders/${r.id}/shifts`)).body.data[0].punchIn.verified).toBe(false);
  });

  it("refuses a second shift, a warehouse the rider may not serve, and bad input", async () => {
    const r = await newRider(f, { warehouseIds: [W1] });
    const start = (body: Record<string, unknown>) => f.send("post", "/rider/shift/start", body, r.headers);
    const notAllowed = await start({ warehouseId: W2, location: AT_W1 });
    expect(notAllowed.status).toBe(403);
    expect(notAllowed.body.error).toMatchObject({ code: "FORBIDDEN", details: { reason: "warehouse_not_allowed" } });
    expect((await start({ warehouseId: W1, location: AT_W1 })).status).toBe(200);
    const second = await start({ warehouseId: W1, location: AT_W1 });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "shift_open" } });
    expect((await start({ location: AT_W1 })).status).toBe(400);
    expect((await start({ warehouseId: W1, location: { lat: 95, lng: 0 } })).status).toBe(400);
    expect((await start({ warehouseId: W1, location: AT_W1, extra: 1 })).status).toBe(400);
    expect(await col("rider_shifts").countDocuments({ riderId: r.id })).toBe(1);
  });

  it("lets only one of several simultaneous starts through", async () => {
    const r = await newRider(f);
    const results = await Promise.all([1, 2, 3, 4].map(() => f.send("post", "/rider/shift/start", { warehouseId: W1, location: AT_W1 }, r.headers)));
    expect(results.map(x => x.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await col("rider_shifts").countDocuments({ riderId: r.id })).toBe(1);
  });
});

describe("working a shift", () => {
  it("switches warehouse within the allowed ones and keeps a record", async () => {
    const r = await newRider(f);
    const { shiftId } = await goOnline(f, r);
    const res = await f.send("post", "/rider/shift/switch-warehouse", { warehouseId: W2 }, r.headers);
    expect(res.body).toEqual({ data: { currentWarehouseId: W2 } });
    expect(await riderDoc(r.id)).toMatchObject({ currentWarehouseId: W2 });
    expect((await shiftDoc(shiftId))?.switches).toEqual([expect.objectContaining({ from: W1, to: W2 })]);
    expect((await f.send("post", "/rider/shift/switch-warehouse", { warehouseId: W3 }, r.headers)).status).toBe(403);
    expect((await f.send("post", "/rider/shift/switch-warehouse", { warehouseId: W2 }, r.headers)).status).toBe(200);
    expect((await shiftDoc(shiftId))?.switches).toHaveLength(1);
  });

  it("needs a shift to switch, break, resume or end", async () => {
    const r = await newRider(f);
    for (const path of ["/rider/shift/switch-warehouse", "/rider/shift/break", "/rider/shift/resume", "/rider/shift/end"]) {
      const res = await f.send("post", path, path.includes("switch") ? { warehouseId: W1 } : undefined, r.headers);
      expect(res.status, path).toBe(409);
      expect(res.body.error.details, path).toEqual({ reason: "no_shift" });
    }
  });

  it("goes on a break and comes back, and cannot do either twice", async () => {
    const r = await newRider(f);
    const { shiftId } = await goOnline(f, r);
    expect((await f.send("post", "/rider/shift/resume", undefined, r.headers)).status).toBe(409);
    expect((await f.send("post", "/rider/shift/break", undefined, r.headers)).body.data).toEqual({ status: "on_break" });
    expect((await f.get("/rider/me", r.headers)).body.data.status).toBe("on_break");
    expect((await f.send("post", "/rider/shift/break", undefined, r.headers)).status).toBe(409);
    expect((await f.send("post", "/rider/shift/resume", undefined, r.headers)).body.data).toEqual({ status: "online" });
    const breaks = (await shiftDoc(shiftId))?.breaks;
    expect(breaks).toEqual([{ from: expect.any(Date), to: expect.any(Date) }]);
  });

  it("ends the shift with the hours worked, closing any break", async () => {
    const r = await newRider(f);
    const { shiftId } = await goOnline(f, r);
    await col("rider_shifts").updateOne({ _id: shiftId as never }, { $set: { startedAt: new Date(Date.now() - 8.4 * 3_600_000) } });
    await f.send("post", "/rider/shift/break", undefined, r.headers);
    const res = await f.send("post", "/rider/shift/end", undefined, r.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.shiftId).toBe(shiftId);
    expect(res.body.data.hoursWorked).toBeGreaterThanOrEqual(8.3);
    expect(res.body.data.hoursWorked).toBeLessThanOrEqual(8.4);
    expect(await shiftDoc(shiftId)).toMatchObject({ endedBy: "rider", breaks: [{ to: expect.any(Date) }] });
    expect(await riderDoc(r.id)).toMatchObject({ status: "offline", currentShiftId: null, currentWarehouseId: null });
    expect((await f.send("post", "/rider/shift/end", undefined, r.headers)).status).toBe(409);
    expect((await goOnline(f, r)).shiftId).not.toBe(shiftId);
  });

  it("will not end a shift with orders in hand or offline deliveries unsent", async () => {
    const r = await newRider(f);
    await goOnline(f, r);
    await col("riders").updateOne({ _id: r.id as never }, { $set: { activeOrderCount: 1 } });
    const busy = await f.send("post", "/rider/shift/end", undefined, r.headers);
    expect(busy.status).toBe(409);
    expect(busy.body.error.details).toEqual({ reason: "active_orders" });
    await col("riders").updateOne({ _id: r.id as never }, { $set: { activeOrderCount: 0, pendingSyncCount: 2 } });
    const unsent = await f.send("post", "/rider/shift/end", undefined, r.headers);
    expect(unsent.body.error.details).toEqual({ reason: "unsynced_events" });
    await f.send("post", `/admin/riders/${r.id}/force-offline`, { force: true });
    expect((await riderDoc(r.id))?.status).toBe("offline");
  });

  it("sets the rider's own profile picture and replaces it", async () => {
    const r = await newRider(f);
    const upload = async () => {
      const res = await f.send("post", "/media/upload-url", { kind: "rider_photo", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal(`rider:${r.userId}`));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      f.storage.upload(res.body.data.upload.fields.key);
      await f.send("post", "/media/complete", { mediaId: res.body.data.mediaId }, asPrincipal(`rider:${r.userId}`));
      return { id: res.body.data.mediaId as string, key: res.body.data.upload.fields.key as string };
    };
    const first = await upload();
    expect((await f.send("put", "/rider/profile/photo", { mediaId: first.id }, r.headers)).body).toEqual({ data: { ok: true } });
    expect((await f.get("/rider/me", r.headers)).body.data.photo).toEqual({ mediaId: first.id });
    expect((await f.send("put", "/rider/profile/photo", { mediaId: first.id }, r.headers)).status).toBe(200);
    const second = await upload();
    await f.send("put", "/rider/profile/photo", { mediaId: second.id }, r.headers);
    expect(f.storage.removed).toEqual([first.key]);
    expect((await f.send("put", "/rider/profile/photo", { mediaId: "9".repeat(24) }, r.headers)).status).toBe(404);
    expect((await f.send("put", "/rider/profile/photo", { mediaId: "nope" }, r.headers)).status).toBe(400);
  });
});

describe("a phone that goes quiet", () => {
  it("is marked offline after ten minutes without a position, and back online on the next one", async () => {
    const r = await newRider(f);
    await goOnline(f, r);
    await col("riders").updateOne({ _id: r.id as never }, { $set: { lastLocationAt: new Date(Date.now() - 11 * 60_000) } });
    const silent = await f.mods.riders.service.sweepSilent();
    expect(silent.map(x => x.id)).toEqual([r.id]);
    expect(await riderDoc(r.id)).toMatchObject({ status: "offline", autoOffline: true, currentShiftId: expect.any(String) });
    expect(await f.mods.riders.service.sweepSilent()).toEqual([]);
    await f.mods.riders.service.recordLocation(r.id, AT_W1, new Date());
    expect(await riderDoc(r.id)).toMatchObject({ status: "online", autoOffline: false, lastLocation: { coordinates: [88.2663, 27.041] } });
  });

  it("leaves a rider with a recent position, one not on shift, and one on a break (until silent too)", async () => {
    const fresh = await newRider(f);
    const idle = await newRider(f);
    await goOnline(f, fresh);
    expect(await f.mods.riders.service.sweepSilent()).toEqual([]);
    expect((await riderDoc(idle.id))?.status).toBe("offline");
  });
});
