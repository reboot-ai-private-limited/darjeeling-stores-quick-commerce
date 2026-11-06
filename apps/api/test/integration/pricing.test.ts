import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_A, W1, W3, ZONE1, ZONE2, admin, asPrincipal, customer, scoped, startFixture, viewer, type Fixture } from "./support/dev2-fixture.js";

let f: Fixture;
beforeAll(async () => { f = await startFixture("pricing_integration_test"); }, 180_000);
afterAll(async () => { await f?.h.stop(); }, 60_000);
beforeEach(async () => { await f.reset(); });

const col = (name: string) => f.h.connection.collection(name);
const TIERS = [{ from: 0, to: 29999, fee: 4000 }, { from: 30000, to: 59999, fee: 2000 }, { from: 60000, to: null, fee: 0 }];
const feeBody = (over: Record<string, unknown> = {}) => ({ type: "delivery_fee", zoneIds: [ZONE1], minOrder: 10000, feeBasis: "afterDiscount", tiers: TIERS, ...over });
const NIGHT = { start: "22:00", end: "06:00", tz: "Asia/Kolkata", days: [0, 1, 2, 3, 4, 5, 6] };
const rule = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/delivery-rules", body, who);
const preview = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/delivery-rules/preview", body, who);
const DAY = "2026-11-05T14:30:00+05:30";
const LATE = "2026-11-05T23:00:00+05:30";

describe("delivery fee rules", () => {
  it("creates a rule, shows it, and audits the change", async () => {
    const res = await rule(feeBody());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({ id: expect.stringMatching(/^[a-f0-9]{24}$/), type: "delivery_fee", zoneIds: [ZONE1], isActive: true, alwaysFree: false, minOrder: 10000, feeBasis: "afterDiscount", tiers: TIERS });
    expect((await f.get(`/admin/delivery-rules/${res.body.data.id}`)).body.data).toEqual(res.body.data);
    expect(await col("audit_log").countDocuments({ action: "pricing.rule_create" })).toBe(1);
  });

  it("refuses tiers with a gap, a wrong start or no open end, and a rule with no zone or an unknown one", async () => {
    for (const tiers of [
      [{ from: 0, to: 100, fee: 1 }, { from: 200, to: null, fee: 0 }], [{ from: 10, to: null, fee: 0 }], [{ from: 0, to: 100, fee: 1 }], [],
    ]) {
      const res = await rule(feeBody({ tiers }));
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ field: "tiers" });
    }
    expect((await rule(feeBody({ zoneIds: [] }))).status).toBe(400);
    expect((await rule(feeBody({ zoneIds: ["9".repeat(24)] }))).status).toBe(400);
    expect((await rule(feeBody({ feeBasis: "sideways" }))).status).toBe(400);
    expect((await rule(feeBody({ extra: 1 }))).status).toBe(400);
    expect((await rule({ type: "magic" })).status).toBe(400);
  });

  it("allows one active fee rule per zone, and says which one is in the way", async () => {
    const first = (await rule(feeBody())).body.data;
    const clash = await rule(feeBody({ zoneIds: [ZONE1, ZONE2] }));
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: "CONFLICT", details: { ruleId: first.id } });
    expect((await rule(feeBody({ zoneIds: [ZONE2] }))).status).toBe(201);
    // Once the first is switched off, a new rule for its zone is fine, and the old one cannot come back beside it.
    await f.send("delete", `/admin/delivery-rules/${first.id}`);
    expect((await rule(feeBody({ tiers: [{ from: 0, to: null, fee: 1000 }] }))).status).toBe(201);
    const back = await f.send("put", `/admin/delivery-rules/${first.id}`, { isActive: true });
    expect(back.status).toBe(409);
  });

  it("accepts an always-free zone with no tiers", async () => {
    const res = await rule({ type: "delivery_fee", zoneIds: [ZONE1], alwaysFree: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await preview({ zoneId: ZONE1, subtotal: 100 })).body.data.total).toBe(0);
  });

  it("lists and filters rules", async () => {
    const fee1 = (await rule(feeBody())).body.data;
    await rule(feeBody({ zoneIds: [ZONE2] }));
    const rain = (await rule({ type: "surcharge", kind: "rain", zoneIds: [ZONE1], amount: 1500, extraMinutes: 10 })).body.data;
    const all = await f.get("/admin/delivery-rules");
    expect(all.body.meta).toEqual({ count: 3 });
    expect((await f.get(`/admin/delivery-rules?zoneId=${ZONE2}`)).body.data).toHaveLength(1);
    expect((await f.get("/admin/delivery-rules?type=surcharge")).body.data.map((r: { id: string }) => r.id)).toEqual([rain.id]);
    await f.send("delete", `/admin/delivery-rules/${fee1.id}`);
    expect((await f.get("/admin/delivery-rules?isActive=false")).body.data.map((r: { id: string }) => r.id)).toEqual([fee1.id]);
    expect((await f.get("/admin/delivery-rules?type=other")).status).toBe(400);
    expect((await f.get("/admin/delivery-rules/" + "9".repeat(24))).status).toBe(404);
  });

  it("edits only what is sent, still checks the whole rule, and does not change the type", async () => {
    const created = (await rule(feeBody())).body.data;
    const ok = await f.send("put", `/admin/delivery-rules/${created.id}`, { minOrder: 15000 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ minOrder: 15000, tiers: TIERS, zoneIds: [ZONE1] });
    expect((await f.send("put", `/admin/delivery-rules/${created.id}`, { tiers: [{ from: 5, to: null, fee: 0 }] })).status).toBe(400);
    expect((await f.send("put", `/admin/delivery-rules/${created.id}`, { type: "surcharge" })).status).toBe(400);
    expect((await f.send("put", `/admin/delivery-rules/${created.id}`, {})).status).toBe(400);
    expect((await f.send("put", `/admin/delivery-rules/${"9".repeat(24)}`, { minOrder: 1 })).status).toBe(404);
    expect((await f.get(`/admin/delivery-rules/${created.id}`)).body.data.minOrder).toBe(15000);
  });

  it("deactivates a rule without deleting it", async () => {
    const created = (await rule(feeBody())).body.data;
    expect((await f.send("delete", `/admin/delivery-rules/${created.id}`)).body).toEqual({ data: { ok: true } });
    expect((await f.get(`/admin/delivery-rules/${created.id}`)).body.data.isActive).toBe(false);
    expect((await f.send("delete", `/admin/delivery-rules/${"9".repeat(24)}`)).status).toBe(404);
  });

  it("limits a manager to zones whose every warehouse they manage, and needs the permission", async () => {
    // Zone 1 has two warehouses, so a manager of one of them may not set its fees; zone 2 has one.
    expect((await rule(feeBody(), scoped(W1))).status).toBe(403);
    expect((await rule(feeBody({ zoneIds: [ZONE2] }), scoped(W3))).status).toBe(201);
    expect((await rule({ type: "surcharge", kind: "other", amount: 100 }, scoped(W3))).status).toBe(403);
    expect((await f.get("/admin/delivery-rules", scoped(W1))).body.data).toEqual([]);
    expect((await f.get("/admin/delivery-rules", scoped(W3))).body.data).toHaveLength(1);
    expect((await rule(feeBody(), viewer)).status).toBe(403);
    expect((await rule(feeBody(), {})).status).toBe(401);
    expect((await f.get("/admin/delivery-rules", viewer)).status).toBe(403);
  });
});

describe("surcharges", () => {
  it("needs a window for late-night, and checks the times and days", async () => {
    const night = (window: unknown) => rule({ type: "surcharge", kind: "late_night", zoneIds: [ZONE1], amount: 2000, extraMinutes: 5, window });
    expect((await night(NIGHT)).status).toBe(201);
    expect((await night(null)).status).toBe(400);
    expect((await night({ ...NIGHT, start: "25:00" })).status).toBe(400);
    expect((await night({ ...NIGHT, days: [] })).status).toBe(400);
    expect((await night({ ...NIGHT, days: [7] })).status).toBe(400);
    expect((await night({ ...NIGHT, tz: "UTC" })).status).toBe(400);
  });

  it("previews the exact bill, with surcharges only when they apply", async () => {
    await rule(feeBody());
    await rule({ type: "surcharge", kind: "rain", zoneIds: [ZONE1], amount: 1500, extraMinutes: 10 });
    await rule({ type: "surcharge", kind: "late_night", zoneIds: [ZONE1], amount: 2000, extraMinutes: 5, window: NIGHT });
    const day = await preview({ zoneId: ZONE1, subtotal: 35000, at: DAY });
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(day.body.data).toEqual({
      charges: [
        { type: "delivery_fee", label: "Delivery fee", amount: 2000, ruleId: expect.any(String) },
        { type: "surcharge_rain", label: "Rain surcharge", amount: 1500, ruleId: expect.any(String) },
      ],
      surchargeCapApplied: false, extraMinutes: 10, total: 3500, nextFreeDeliveryAt: 60000, feeShares: [2000],
    });
    const late = await preview({ zoneId: ZONE1, subtotal: 35000, at: LATE });
    expect(late.body.data).toMatchObject({ total: 5500, extraMinutes: 15 });
    expect(late.body.data.charges.map((c: { type: string }) => c.type)).toEqual(["delivery_fee", "surcharge_rain", "surcharge_late_night"]);
    expect((await preview({ zoneId: ZONE1, subtotal: 70000, at: DAY })).body.data).toMatchObject({ total: 1500, nextFreeDeliveryAt: null });
    expect((await preview({ zoneId: ZONE1, subtotal: 31000, discount: 2000, at: DAY })).body.data.charges[0].amount).toBe(4000);
    expect((await preview({ zoneId: ZONE2, subtotal: 35000, at: DAY })).body.data.total).toBe(0);
  });

  it("splits the fee between deliveries and applies the cap", async () => {
    await rule(feeBody({ tiers: [{ from: 0, to: null, fee: 3001 }] }));
    await rule({ type: "surcharge", kind: "rain", zoneIds: [ZONE1], amount: 4000, extraMinutes: 10 });
    await rule({ type: "surcharge", kind: "other", zoneIds: [], amount: 3000, extraMinutes: 0 });
    const res = await preview({ zoneId: ZONE1, subtotal: 100, at: DAY, splitIntoWarehouses: 2 });
    expect(res.body.data.feeShares).toEqual([1501, 1500]);
    // The default cap is 5000 paise for all surcharges together.
    expect(res.body.data.charges.filter((c: { type: string }) => c.type !== "delivery_fee").map((c: { amount: number }) => c.amount)).toEqual([4000, 1000]);
    expect(res.body.data).toMatchObject({ surchargeCapApplied: true, total: 8001 });
  });

  it("checks the preview request", async () => {
    expect((await preview({ zoneId: ZONE1 })).status).toBe(400);
    expect((await preview({ zoneId: ZONE1, subtotal: -5 })).status).toBe(400);
    expect((await preview({ zoneId: ZONE1, subtotal: 5, splitIntoWarehouses: 0 })).status).toBe(400);
    expect((await preview({ zoneId: "9".repeat(24), subtotal: 5 })).status).toBe(400);
    expect((await preview({ zoneId: ZONE1, subtotal: 5 }, viewer)).status).toBe(403);
  });
});

describe("rain mode", () => {
  const rain = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/ops/rain", body, who);
  const soon = () => new Date(Date.now() + 3_600_000).toISOString();

  it("switches rain on for zones with a time it ends, and the surcharge appears in the bill", async () => {
    await rule(feeBody());
    const until = soon();
    const on = await rain({ on: true, until, zoneIds: [ZONE1] });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.data).toEqual({ ruleId: expect.any(String), isActive: true, activeUntil: until });
    const bill = await preview({ zoneId: ZONE1, subtotal: 35000 });
    expect(bill.body.data.charges.map((c: { type: string; amount: number }) => [c.type, c.amount])).toEqual([["delivery_fee", 2000], ["surcharge_rain", 1500]]);
    expect(bill.body.data.extraMinutes).toBe(10);
    // Turning it on again changes the same rule.
    const again = await rain({ on: true, until: null, zoneIds: [ZONE1] });
    expect(again.body.data.ruleId).toBe(on.body.data.ruleId);
    expect(again.body.data.activeUntil).toBeNull();
    expect(await col("delivery_rules").countDocuments({ kind: "rain" })).toBe(1);
  });

  it("switches it off", async () => {
    const on = await rain({ on: true, until: soon(), zoneIds: [ZONE1] });
    const off = await rain({ on: false, zoneIds: [ZONE1] });
    expect(off.body.data).toEqual({ ruleId: on.body.data.ruleId, isActive: false, activeUntil: null });
    expect((await preview({ zoneId: ZONE1, subtotal: 35000 })).body.data.total).toBe(0);
    expect((await rain({ on: false, zoneIds: [ZONE1] })).body.data.ruleId).toBeNull();
  });

  it("stops charging at the end time, and the sweep switches the rule off for good", async () => {
    const on = await rain({ on: true, until: soon(), zoneIds: [ZONE1] });
    await col("delivery_rules").updateOne({ _id: on.body.data.ruleId as never }, { $set: { activeUntil: new Date(Date.now() - 1000) } });
    expect((await preview({ zoneId: ZONE1, subtotal: 35000 })).body.data.total).toBe(0);
    expect(await f.mods.pricing.service.expireRain()).toBe(1);
    expect((await col("delivery_rules").findOne({ _id: on.body.data.ruleId as never }))?.isActive).toBe(false);
    expect(await f.mods.pricing.service.expireRain()).toBe(0);
  });

  it("checks the request and the permission", async () => {
    expect((await rain({ on: true, until: new Date(Date.now() - 1000).toISOString(), zoneIds: [ZONE1] })).status).toBe(400);
    expect((await rain({ on: "yes" })).status).toBe(400);
    expect((await rain({ on: true, zoneIds: ["9".repeat(24)] })).status).toBe(400);
    expect((await rain({ on: true, zoneIds: [ZONE1] }, viewer)).status).toBe(403);
    expect((await rain({ on: true, zoneIds: [ZONE1] }, {})).status).toBe(401);
    expect((await rain({ on: true, zoneIds: [ZONE1] }, scoped(W1))).status).toBe(403);
    expect((await rain({ on: true, zoneIds: [ZONE2] }, scoped(W3))).status).toBe(200);
  });
});

const coupon = (body: Record<string, unknown> = {}, who = admin) => f.send("post", "/admin/coupons", { code: "welcome50", type: "flat", value: 5000, minOrder: 20000, ...body }, who);

describe("coupons", () => {
  it("creates a coupon with the code in capitals, and reads it back", async () => {
    const res = await coupon({ perUserLimit: 1, totalLimit: 500, firstOrderOnly: true, zoneIds: [ZONE1], startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String), code: "WELCOME50", type: "flat", value: 5000, maxDiscount: null, minOrder: 20000, perUserLimit: 1, totalLimit: 500, usedCount: 0,
      firstOrderOnly: true, zoneIds: [ZONE1], warehouseIds: [], startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z", isActive: true, description: null,
    });
    expect((await f.get(`/admin/coupons/${res.body.data.id}`)).body.data).toEqual(res.body.data);
    expect(await col("audit_log").countDocuments({ action: "pricing.coupon_create" })).toBe(1);
  });

  it("refuses a duplicate code and invalid values", async () => {
    await coupon();
    const dupe = await coupon({ code: "WELCOME50" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.details).toEqual({ code: "WELCOME50" });
    expect((await coupon({ code: "x", type: "flat" })).status).toBe(400);
    expect((await coupon({ code: "BAD CODE" })).status).toBe(400);
    expect((await coupon({ code: "PCT", type: "percent", value: 101 })).status).toBe(400);
    expect((await coupon({ code: "PCT", type: "percent", value: 0 })).status).toBe(400);
    expect((await coupon({ code: "FLAT", type: "flat", value: 0 })).status).toBe(400);
    expect((await coupon({ code: "DATES", startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" })).status).toBe(400);
    expect((await coupon({ code: "ZONE", zoneIds: ["9".repeat(24)] })).status).toBe(400);
    expect((await coupon({ code: "FREE", type: "free_delivery", value: 0 })).status).toBe(201);
  });

  it("lists, edits and deactivates", async () => {
    const a = (await coupon({ code: "AAA" })).body.data;
    const b = (await coupon({ code: "BBB" })).body.data;
    const page = await f.get("/admin/coupons?limit=1");
    expect(page.body.data.map((c: { code: string }) => c.code)).toEqual(["BBB"]);
    expect((await f.get(`/admin/coupons?limit=1&cursor=${page.body.meta.nextCursor}`)).body.data.map((c: { code: string }) => c.code)).toEqual(["AAA"]);
    const edited = await f.send("put", `/admin/coupons/${a.id}`, { value: 7000, code: "AAA2" });
    expect(edited.body.data).toMatchObject({ code: "AAA2", value: 7000 });
    expect((await f.send("put", `/admin/coupons/${a.id}`, { code: "BBB" })).status).toBe(409);
    expect((await f.send("put", `/admin/coupons/${a.id}`, { type: "percent", value: 150 })).status).toBe(400);
    expect((await f.send("put", `/admin/coupons/${a.id}`, {})).status).toBe(400);
    expect((await f.send("post", `/admin/coupons/${b.id}/deactivate`)).body.data.isActive).toBe(false);
    expect((await f.get("/admin/coupons?isActive=false")).body.data.map((c: { code: string }) => c.code)).toEqual(["BBB"]);
    expect((await f.get(`/admin/coupons/${"9".repeat(24)}`)).status).toBe(404);
    expect((await f.send("post", `/admin/coupons/${"9".repeat(24)}/deactivate`)).status).toBe(404);
  });

  it("will not set a total limit below the uses so far", async () => {
    const c = (await coupon({ code: "LIM", totalLimit: 5 })).body.data;
    await f.mods.pricing.service.hold("u1".repeat(12), c.id, "g1".repeat(12), 500);
    await f.mods.pricing.service.hold("u2".repeat(12), c.id, "g2".repeat(12), 500);
    expect((await f.send("put", `/admin/coupons/${c.id}`, { totalLimit: 1 })).status).toBe(400);
    expect((await f.send("put", `/admin/coupons/${c.id}`, { totalLimit: 2 })).status).toBe(200);
  });

  it("needs the pricing permission and respects zones a manager does not manage", async () => {
    expect((await coupon({}, viewer)).status).toBe(403);
    expect((await coupon({}, {})).status).toBe(401);
    expect((await f.get("/admin/coupons", viewer)).status).toBe(403);
    expect((await coupon({ code: "ZONEA", zoneIds: [ZONE1] }, scoped(W1))).status).toBe(403);
    expect((await coupon({ code: "ZONEB", zoneIds: [ZONE2] }, scoped(W3))).status).toBe(201);
    expect((await coupon({ code: "ALL" }, scoped(W3))).status).toBe(403);
  });

  it("shows customers the coupons they can use now and why the others cannot be", async () => {
    await coupon({ code: "WELCOME50", firstOrderOnly: true, description: "₹50 off your first order" });
    await coupon({ code: "FREEDEL", type: "free_delivery", value: 0, minOrder: 30000 });
    await coupon({ code: "ZONE2ONLY", zoneIds: [ZONE2] });
    await coupon({ code: "OLD", endsAt: new Date(Date.now() - 1000).toISOString() });
    await coupon({ code: "OFF", isActive: false });
    const res = await f.get(`/coupons/available?zoneId=${ZONE1}&subtotal=25000`, customer(CUSTOMER_A));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([
      { code: "WELCOME50", type: "flat", description: "₹50 off your first order", value: 5000, minOrder: 20000, applicable: true, reason: null },
      { code: "FREEDEL", type: "free_delivery", description: "Free delivery", value: 0, minOrder: 30000, applicable: false, reason: "min_order" },
      { code: "ZONE2ONLY", type: "flat", description: "₹50 off", value: 5000, minOrder: 20000, applicable: false, reason: "not_applicable" },
    ]);
    expect(res.body.meta).toEqual({ count: 3 });
    expect((await f.get(`/coupons/available?zoneId=${ZONE1}`, customer(CUSTOMER_A))).body.data[0].reason).toBe("min_order");
    expect((await f.get("/coupons/available", customer(CUSTOMER_A))).status).toBe(400);
    expect((await f.get(`/coupons/available?zoneId=${ZONE1}`, {})).status).toBe(401);
  });

  it("greys out a first-order coupon for a customer who has ordered, and one that has run out", async () => {
    const orders = { orderCount: async () => 3 };
    const mods = (await import("../../src/composition/dev2.js")).createDev2Modules({ connection: f.h.connection, geography: f.geo.geography, orderHistory: orders });
    await coupon({ code: "FIRST", firstOrderOnly: true });
    const c = (await coupon({ code: "LIMITED", totalLimit: 1 })).body.data;
    await f.mods.pricing.service.hold("u1".repeat(12), c.id, "g1".repeat(12), 500);
    const list = await mods.pricing.service.available("u2".repeat(12), { zoneId: ZONE1, subtotal: 25000 });
    expect(Object.fromEntries(list.map(x => [x.code, x.reason]))).toEqual({ FIRST: "first_order_only", LIMITED: "limit_reached" });
  });
});

describe("using a coupon on an order", () => {
  const pricing = () => f.mods.pricing.service;
  const U1 = "a1".repeat(12);
  const U2 = "a2".repeat(12);
  const g = (n: number) => String(n).padStart(24, "0");

  it("checks a code and works out the discount", async () => {
    await coupon({ code: "PCT10", type: "percent", value: 10, maxDiscount: 1500, minOrder: 0 });
    await coupon({ code: "FREEDEL", type: "free_delivery", value: 0, minOrder: 0 });
    const pct = await pricing().check(U1, " pct10 ", { zoneId: ZONE1, subtotal: 20000 });
    expect(pct).toMatchObject({ discount: 1500, freeDelivery: false, description: "10% off up to ₹15" });
    expect(await pricing().check(U1, "FREEDEL", { zoneId: ZONE1, subtotal: 20000 })).toMatchObject({ discount: 0, freeDelivery: true });
    await expect(pricing().check(U1, "NOPE", { zoneId: ZONE1, subtotal: 20000 })).rejects.toMatchObject({ code: "COUPON_INVALID", details: { reason: "not_applicable" } });
    await coupon({ code: "BIG", minOrder: 90000 });
    await expect(pricing().check(U1, "BIG", { zoneId: ZONE1, subtotal: 20000 })).rejects.toMatchObject({ code: "COUPON_INVALID", details: { reason: "min_order" } });
  });

  it("holds a use once per order, and gives it back", async () => {
    const c = (await coupon({ code: "ONCE", perUserLimit: 1, totalLimit: 10 })).body.data;
    expect(await pricing().hold(U1, c.id, g(1), 5000)).toBe(true);
    expect(await pricing().hold(U1, c.id, g(1), 5000)).toBe(false);
    expect((await col("coupons").findOne({ _id: c.id as never }))?.usedCount).toBe(1);
    await expect(pricing().hold(U1, c.id, g(2), 5000)).rejects.toMatchObject({ code: "COUPON_INVALID", details: { reason: "limit_reached" } });
    expect(await pricing().hold(U2, c.id, g(3), 5000)).toBe(true);
    expect(await pricing().release(g(1))).toBe(true);
    expect(await pricing().release(g(1))).toBe(false);
    expect((await col("coupons").findOne({ _id: c.id as never }))?.usedCount).toBe(1);
    expect(await pricing().hold(U1, c.id, g(4), 5000)).toBe(true);
  });

  it("never lets more orders use a coupon than its total limit, even all at once", async () => {
    const c = (await coupon({ code: "RACE", totalLimit: 2 })).body.data;
    const users = ["b1", "b2", "b3", "b4", "b5"].map(x => x.repeat(12));
    const results = await Promise.allSettled(users.map((u, i) => pricing().hold(u, c.id, g(10 + i), 100)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(3);
    expect((await col("coupons").findOne({ _id: c.id as never }))?.usedCount).toBe(2);
  });

  it("never lets one customer use a coupon more than their limit, even all at once", async () => {
    const c = (await coupon({ code: "MINE1", perUserLimit: 2 })).body.data;
    const results = await Promise.allSettled([1, 2, 3, 4].map(i => pricing().hold(U1, c.id, g(20 + i), 100)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect((await col("coupons").findOne({ _id: c.id as never }))?.usedCount).toBe(2);
  });

  it("lists who used it and the discount given", async () => {
    const c = (await coupon({ code: "USED" })).body.data;
    await pricing().hold(U1, c.id, g(30), 5000);
    await pricing().hold(U2, c.id, g(31), 2500);
    const res = await f.get(`/admin/coupons/${c.id}/usage`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([
      { userId: U2, customerName: null, orderGroupId: g(31), discountAmount: 2500, at: expect.stringMatching(/Z$/) },
      { userId: U1, customerName: null, orderGroupId: g(30), discountAmount: 5000, at: expect.stringMatching(/Z$/) },
    ]);
    expect(res.body.meta).toEqual({ nextCursor: null, totalDiscount: 7500 });
    expect((await f.get(`/admin/coupons/${c.id}/usage?limit=1`)).body.meta.nextCursor).toEqual(expect.any(String));
    expect((await f.get(`/admin/coupons/${"9".repeat(24)}/usage`)).status).toBe(404);
  });

  it("keeps working for an order already placed after the coupon is deactivated", async () => {
    const c = (await coupon({ code: "STOP" })).body.data;
    await pricing().hold(U1, c.id, g(40), 5000);
    await f.send("post", `/admin/coupons/${c.id}/deactivate`);
    await expect(pricing().check(U2, "STOP", { zoneId: ZONE1, subtotal: 30000 })).rejects.toMatchObject({ details: { reason: "not_applicable" } });
    expect(await pricing().release(g(40))).toBe(true);
  });
});

describe("home banners", () => {
  async function image() {
    const up = await f.send("post", "/media/upload-url", { kind: "banner", contentType: "image/jpeg", sizeBytes: 5000 }, asPrincipal("admin"));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    f.storage.upload(up.body.data.upload.fields.key);
    await f.send("post", "/media/complete", { mediaId: up.body.data.mediaId }, asPrincipal("admin"));
    return up.body.data.mediaId as string;
  }
  const banner = (body: Record<string, unknown>, who = admin) => f.send("post", "/admin/banners", { title: "Free delivery above ₹399", ...body }, who);

  it("creates a banner with its image, link and order, and lists it", async () => {
    const mediaId = await image();
    const res = await banner({ imageMediaId: mediaId, link: { type: "category", id: "c".repeat(24) }, sortOrder: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({ id: expect.any(String), title: "Free delivery above ₹399", imageMediaId: mediaId, link: { type: "category", id: "c".repeat(24) }, zoneId: null, sortOrder: 1, startsAt: null, endsAt: null, isActive: true });
    expect(await col("media_files").findOne({ _id: mediaId as never })).toMatchObject({ ownerType: "banner", ownerId: res.body.data.id });
    expect((await f.get("/admin/banners")).body.data).toEqual([res.body.data]);
  });

  it("checks the banner, its link, its zone and its image", async () => {
    expect((await banner({ title: "" })).status).toBe(400);
    expect((await banner({ link: { type: "url", url: "http://insecure.example" } })).status).toBe(400);
    expect((await banner({ link: { type: "category" } })).status).toBe(400);
    expect((await banner({ zoneId: "9".repeat(24) })).status).toBe(400);
    expect((await banner({ imageMediaId: "9".repeat(24) })).status).toBe(404);
    expect((await banner({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" })).status).toBe(400);
    expect((await banner({ link: { type: "url", url: "https://example.com/sale" } })).status).toBe(201);
    expect((await banner({}, viewer)).status).toBe(403);
    expect((await banner({}, {})).status).toBe(401);
    expect((await banner({ zoneId: ZONE1 }, scoped(W1))).status).toBe(403);
    expect((await banner({}, scoped(W1))).status).toBe(403);
  });

  it("replaces the image and removes the old one, and deleting the banner removes its image", async () => {
    const first = await image();
    const created = (await banner({ imageMediaId: first })).body.data;
    const second = await image();
    const edited = await f.send("put", `/admin/banners/${created.id}`, { imageMediaId: second, title: "New title" });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data).toMatchObject({ imageMediaId: second, title: "New title" });
    expect((await col("media_files").findOne({ _id: first as never }))?.status).toMatch(/deleting|deleted/);
    expect((await f.send("put", `/admin/banners/${created.id}`, {})).status).toBe(400);
    expect((await f.send("put", `/admin/banners/${"9".repeat(24)}`, { title: "x" })).status).toBe(404);
    expect((await f.send("delete", `/admin/banners/${created.id}`)).body).toEqual({ data: { ok: true } });
    expect((await col("media_files").findOne({ _id: second as never }))?.status).toMatch(/deleting|deleted/);
    expect((await f.get("/admin/banners")).body.data).toEqual([]);
    expect((await f.send("delete", `/admin/banners/${created.id}`)).status).toBe(404);
  });

  it("shows a zone only the banners that are on, for it, and in order", async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await banner({ title: "Second", sortOrder: 2 });
    await banner({ title: "First", sortOrder: 1, zoneId: ZONE1 });
    await banner({ title: "Other zone", zoneId: ZONE2 });
    await banner({ title: "Off", isActive: false });
    await banner({ title: "Future", startsAt: soon });
    await banner({ title: "Ended", endsAt: past });
    expect((await f.mods.pricing.bannerSource.forZone(ZONE1)).map(b => b.title)).toEqual(["First", "Second"]);
    expect((await f.mods.pricing.bannerSource.forZone(ZONE2)).map(b => b.title)).toEqual(["Other zone", "Second"]);
  });
});
