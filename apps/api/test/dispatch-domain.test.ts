import { describe, expect, it } from "vitest";
import { afterArrived, afterFinished, afterPickup, pickupsDone } from "../src/modules/dispatch/application/batch-service.js";
import { batchLimit, buildStops, ineligibleReasons, rankCandidates, sameStops, type Batch, type DispatchSettings } from "../src/modules/dispatch/domain/dispatch.js";
import { DEFAULT_DISPATCH_SETTINGS } from "../src/modules/dispatch/dispatch.public.js";
import { DEFAULT_RIDER_SETTINGS, haversineMeters, hoursWorked, type Rider, type Shift } from "../src/modules/riders/domain/rider.js";

const NOW = new Date("2026-11-06T10:00:00Z");
const rider = (over: Partial<Rider> = {}): Rider => ({
  id: "r1", userId: "u1", name: "Pema", phone: "9800000001", zoneId: "z1", warehouseIds: ["w1", "w2"], currentWarehouseId: "w1", vehicle: null, photoMediaId: null,
  status: "online", isActive: true, activeOrderCount: 0, lastLocation: { lat: 27, lng: 88 }, lastLocationAt: new Date(NOW.getTime() - 30_000), lastAssignedAt: null,
  currentShiftId: "s1", autoOffline: false, appVersion: null, pendingSyncCount: 0, createdAt: NOW, updatedAt: NOW, ...over,
});
const order = { zoneId: "z1", warehouseId: "w1" };

describe("who can take an order", () => {
  it("accepts an online rider in the zone and warehouse with room and a fresh position", () => {
    expect(ineligibleReasons(rider(), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual([]);
  });
  it("names every reason", () => {
    expect(ineligibleReasons(rider({ status: "offline", currentShiftId: null }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["offline"]);
    expect(ineligibleReasons(rider({ isActive: false }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["offline"]);
    expect(ineligibleReasons(rider({ status: "on_break" }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["on_break"]);
    expect(ineligibleReasons(rider({ zoneId: "z2" }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["wrong_zone"]);
    expect(ineligibleReasons(rider({ warehouseIds: ["w2"] }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["wrong_warehouse"]);
    expect(ineligibleReasons(rider({ activeOrderCount: 2 }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["at_capacity"]);
    expect(ineligibleReasons(rider({ lastLocationAt: null }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["stale_location"]);
    expect(ineligibleReasons(rider({ lastLocationAt: new Date(NOW.getTime() - 301_000) }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual(["stale_location"]);
    expect(ineligibleReasons(rider({ lastLocationAt: new Date(NOW.getTime() - 300_000) }), order, DEFAULT_RIDER_SETTINGS, NOW)).toEqual([]);
  });
  it("lists several at once, in a fixed order", () => {
    expect(ineligibleReasons(rider({ status: "offline", currentShiftId: null, zoneId: "z2", activeOrderCount: 3, lastLocationAt: null }), order, DEFAULT_RIDER_SETTINGS, NOW))
      .toEqual(["offline", "wrong_zone", "at_capacity", "stale_location"]);
  });
  it("uses the limit it is given", () => {
    expect(ineligibleReasons(rider({ activeOrderCount: 2 }), order, { ...DEFAULT_RIDER_SETTINGS, maxActiveOrders: 3 }, NOW)).toEqual([]);
  });
});

describe("ranking riders", () => {
  const c = (id: string, over: Partial<Rider>, distanceMeters: number | null) => ({ rider: rider({ id, ...over }), distanceMeters });
  it("prefers fewer active orders, then nearer, then the longest wait, then the id", () => {
    const ranked = rankCandidates([
      c("busy", { activeOrderCount: 1 }, 10),
      c("far", {}, 900),
      c("tie-b", { lastAssignedAt: new Date("2026-11-06T09:00:00Z") }, 100),
      c("tie-a", { lastAssignedAt: new Date("2026-11-06T08:00:00Z") }, 100),
      c("unknown", {}, null),
      c("same-1", {}, 50),
      c("same-2", {}, 50),
    ]);
    expect(ranked.map(x => x.rider.id)).toEqual(["same-1", "same-2", "tie-a", "tie-b", "far", "unknown", "busy"]);
  });
  it("does not change its input and treats never-assigned as longest waiting", () => {
    const input = [c("b", { lastAssignedAt: new Date("2026-11-06T08:00:00Z") }, 5), c("a", {}, 5)];
    expect(rankCandidates(input).map(x => x.rider.id)).toEqual(["a", "b"]);
    expect(input.map(x => x.rider.id)).toEqual(["b", "a"]);
  });
});

describe("batch limit", () => {
  it("is the smaller of the batch size and what a rider may carry", () => {
    expect(batchLimit(DEFAULT_DISPATCH_SETTINGS)).toBe(2);
    expect(batchLimit({ ...DEFAULT_DISPATCH_SETTINGS, maxActiveOrders: 5 } as DispatchSettings)).toBe(3);
  });
});

describe("planning stops", () => {
  const o = (id: string, groupId: string, warehouseId: string) => ({ id, groupId, warehouseId });
  it("picks up at each warehouse once, then drops once per checkout", () => {
    const stops = buildStops([o("a", "g1", "w1"), o("b", "g1", "w2"), o("c", "g2", "w1")]);
    expect(stops.map(s => [s.seq, s.type, s.warehouseId ?? null, s.orderIds])).toEqual([
      [1, "pickup", "w1", ["a", "c"]], [2, "pickup", "w2", ["b"]], [3, "drop", null, ["a", "b"]], [4, "drop", null, ["c"]],
    ]);
    expect(stops.every(s => s.status === "pending" && s.doneOrderIds.length === 0)).toBe(true);
  });
  it("follows a given pickup order", () => {
    expect(buildStops([o("a", "g1", "w1"), o("b", "g1", "w2")], ["w2", "w1"]).slice(0, 2).map(s => s.warehouseId)).toEqual(["w2", "w1"]);
  });
  it("accepts caller stops that cover each order once, and renumbers them", () => {
    const orders = [o("a", "g1", "w1"), o("b", "g2", "w2")];
    const stops = sameStops(["a", "b"], [
      { type: "pickup", warehouseId: "w2", orderIds: ["b"] }, { type: "pickup", warehouseId: "w1", orderIds: ["a"] }, { type: "drop", orderIds: ["b"] }, { type: "drop", orderIds: ["a"] },
    ], orders);
    expect(stops?.map(s => [s.seq, s.type, s.orderIds])).toEqual([[1, "pickup", ["b"]], [2, "pickup", ["a"]], [3, "drop", ["b"]], [4, "drop", ["a"]]]);
  });
  it("refuses stops that miss, repeat or misplace an order", () => {
    const orders = [o("a", "g1", "w1"), o("b", "g2", "w2")];
    const pick = (warehouseId: string, ...ids: string[]) => ({ type: "pickup" as const, warehouseId, orderIds: ids });
    const drop = (...ids: string[]) => ({ type: "drop" as const, orderIds: ids });
    expect(sameStops(["a", "b"], [pick("w1", "a"), drop("a", "b")], orders)).toBeNull();
    expect(sameStops(["a", "b"], [pick("w1", "a"), pick("w2", "b"), drop("a")], orders)).toBeNull();
    expect(sameStops(["a", "b"], [pick("w1", "a", "b"), drop("a", "b")], orders)).toBeNull();
    expect(sameStops(["a", "b"], [pick("w1", "a"), pick("w2", "b", "b"), drop("a", "b")], orders)).toBeNull();
    expect(sameStops(["a", "b"], [{ type: "pickup", orderIds: ["a"] }, pick("w2", "b"), drop("a", "b")], orders)).toBeNull();
  });
});

describe("progress through a batch", () => {
  const base = (): Batch => ({
    id: "b1", riderId: "r1", zoneId: "z1", status: "planned", orderIds: ["a", "b"], createdBy: "admin", createdAt: NOW, updatedAt: NOW,
    stops: buildStops([{ id: "a", groupId: "g1", warehouseId: "w1" }, { id: "b", groupId: "g1", warehouseId: "w2" }]),
  });
  it("starts the batch at the first pickup and finishes a pickup stop when everything there is collected", () => {
    const one = afterPickup(base(), "a", NOW);
    expect(one.status).toBe("active");
    expect(one.stops[0]).toMatchObject({ status: "done", doneOrderIds: ["a"], doneAt: NOW });
    expect(pickupsDone(one)).toBe(false);
    expect(pickupsDone(afterPickup(one, "b", NOW))).toBe(true);
    expect(afterPickup(one, "a", NOW).stops[0]!.doneOrderIds).toEqual(["a"]);
  });
  it("marks a stop with several orders arrived until all are collected", () => {
    const batch: Batch = { ...base(), orderIds: ["a", "c"], stops: buildStops([{ id: "a", groupId: "g1", warehouseId: "w1" }, { id: "c", groupId: "g2", warehouseId: "w1" }]) };
    const part = afterPickup(batch, "a", NOW);
    expect(part.stops[0]).toMatchObject({ status: "arrived", doneOrderIds: ["a"] });
    expect(afterPickup(part, "c", NOW).stops[0]!.status).toBe("done");
  });
  it("marks the drop arrived, then done only when each order there is finished, and completes the batch", () => {
    let batch = afterPickup(afterPickup(base(), "a", NOW), "b", NOW);
    batch = afterArrived(batch, ["a", "b"], NOW);
    expect(batch.stops[2]).toMatchObject({ type: "drop", status: "arrived", arrivedAt: NOW });
    batch = afterFinished(batch, "a", NOW);
    expect(batch.stops[2]).toMatchObject({ status: "arrived", doneOrderIds: ["a"] });
    expect(batch.status).toBe("active");
    batch = afterFinished(batch, "b", NOW);
    expect(batch.stops[2]).toMatchObject({ status: "done", doneAt: NOW });
    expect(batch.status).toBe("done");
  });
  it("ignores an arrival for orders not at any drop", () => {
    expect(afterArrived(base(), ["zzz"], NOW).stops.every(s => s.status === "pending")).toBe(true);
  });
});

describe("distance and hours", () => {
  it("measures metres between two points", () => {
    expect(haversineMeters({ lat: 27.041, lng: 88.2663 }, { lat: 27.041, lng: 88.2663 })).toBe(0);
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBe(111_195);
    expect(haversineMeters({ lat: 27.041, lng: 88.2663 }, { lat: 27.042, lng: 88.2663 })).toBe(111);
  });
  it("counts hours worked without breaks, including one still open", () => {
    const shift: Shift = {
      id: "s", riderId: "r", warehouseId: "w", startedAt: new Date("2026-11-06T04:00:00Z"), endedAt: null,
      punchIn: { location: { lat: 0, lng: 0 }, accuracyM: null, distanceFromWarehouseM: 0, verified: true },
      breaks: [{ from: new Date("2026-11-06T06:00:00Z"), to: new Date("2026-11-06T06:30:00Z") }], switches: [], endedBy: null,
    };
    expect(hoursWorked(shift, new Date("2026-11-06T10:00:00Z"))).toBe(5.5);
    expect(hoursWorked({ ...shift, breaks: [{ from: new Date("2026-11-06T09:00:00Z"), to: null }] }, new Date("2026-11-06T10:00:00Z"))).toBe(5);
    expect(hoursWorked(shift, new Date("2026-11-06T03:00:00Z"))).toBe(0);
  });
});
