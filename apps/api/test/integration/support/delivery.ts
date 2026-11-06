import { expect } from "vitest";
import { W1, ZONE1, type Fixture } from "./dev2-fixture.js";
import { AT_W1, goOnline, newRider, type TestRider } from "./riders.js";

/** Helpers shared by the cash, tracking and sync tests: a rider on shift, an assigned order, and the walk to the door. */
export function deliveryHelpers(fixture: () => Fixture) {
  const f = new Proxy({} as Fixture, { get: (_t, key) => (fixture() as never)[key] });
  const col = (name: string) => f.h.connection.collection(name);
  /** Ready an hour ago, so a delivery time a few minutes back is believable. */
  const ready = (over: Record<string, unknown> = {}) => f.orders.add({ zoneId: ZONE1, warehouseId: W1, readyAt: new Date(Date.now() - 3_600_000), ...over });
  async function onShift(over: Record<string, unknown> = {}): Promise<TestRider> {
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
  const as = (r: TestRider, method: "get" | "post" | "put", path: string, body?: Record<string, unknown>) => f.send(method, path, body, r.headers);
  const pickup = (r: TestRider, id: string) => as(r, "post", `/rider/orders/${id}/pickup`, { checklist: { itemsVerified: true, bagCount: 2 } });
  async function toRoad(r: TestRider, id: string) {
    expect((await pickup(r, id)).status).toBe(200);
    expect((await as(r, "post", `/rider/orders/${id}/start-ride`)).status).toBe(200);
  }
  async function toDoor(r: TestRider, id: string) {
    await toRoad(r, id);
    expect((await as(r, "post", `/rider/orders/${id}/arrived`)).status).toBe(200);
  }
  const riderOf = async (r: TestRider) => (await f.mods.riders.service.byId(r.id))!;
  return { col, ready, onShift, assigned, as, pickup, toRoad, toDoor, riderOf };
}
