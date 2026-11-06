import { expect } from "vitest";
import { W1, W2, ZONE1, type Fixture } from "./dev2-fixture.js";

export const AT_W1 = { lat: 27.041, lng: 88.2663 };
let counter = 0;

export interface TestRider { id: string; userId: string; name: string; phone: string; headers: Record<string, string> }

/** Pre-registers a rider through the admin API, as an admin would. The rider is offline until they start a shift. */
export async function newRider(f: Fixture, over: Record<string, unknown> = {}): Promise<TestRider> {
  counter++;
  const body = { name: `Rider ${counter}`, phone: `98000001${String(counter).padStart(2, "0")}`, zoneId: ZONE1, warehouseIds: [W1, W2], vehicle: "Scooter", ...over };
  const res = await f.send("post", "/admin/riders", body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.data.id, userId: res.body.data.userId, name: res.body.data.name, phone: res.body.data.phone, headers: { "X-Test-Rider": res.body.data.userId } };
}

/** The rider punches in at a warehouse and is online with a fresh position. */
export async function goOnline(f: Fixture, rider: TestRider, warehouseId = W1, location = AT_W1) {
  const res = await f.send("post", "/rider/shift/start", { warehouseId, location, accuracyM: 12 }, rider.headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as { shiftId: string; status: string; punchIn: { distanceFromWarehouseM: number; verified: boolean }; currentWarehouseId: string };
}

export const resetRiderCounter = () => { counter = 0; };
