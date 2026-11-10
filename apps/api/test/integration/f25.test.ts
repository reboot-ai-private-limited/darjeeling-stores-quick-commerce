import type { Request } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuditAdminModule } from "../../src/modules/audit/audit-admin.public.js";
import type { Actor } from "../../src/modules/catalog/catalog.public.js";
import { createCustomersModule } from "../../src/modules/customers/customers.public.js";
import { createReportsModule } from "../../src/modules/reports/reports.public.js";
import { createSettingsModule } from "../../src/modules/settings/settings.public.js";
import { api, startHarness, type Harness } from "./support/harness.js";

const PERMS = ["settings:view", "settings:manage", "dashboard:view", "reports:view", "customers:view", "customers:manage", "audit:view"];
const W1 = "a1".repeat(12), W2 = "a2".repeat(12), ZONE = "1".repeat(24);
const STAFF_ID = "000000000000000000000009";
const actor = (req: Request): Actor | undefined => {
  const who = req.get("X-Test-Actor");
  if (who === "admin") return { userId: STAFF_ID, role: "super_admin", permissions: ["*"], scope: { all: true, warehouseIds: [] } };
  if (who === "w1") return { userId: STAFF_ID, role: "manager", permissions: PERMS, scope: { all: false, warehouseIds: [W1] } };
  if (who === "nobody") return { userId: STAFF_ID, role: "none", permissions: [], scope: { all: true, warehouseIds: [] } };
  return undefined;
};
const as = (who: string) => ({ "X-Test-Actor": who });

let h: Harness;
let app: ReturnType<Harness["appWith"]>;
const removedMedia: string[] = [];
beforeAll(async () => {
  h = await startHarness("f25_integration_test");
  const settings = createSettingsModule({ connection: h.connection, auth: actor });
  await settings.store.ensureIndexes();
  const reports = createReportsModule({ connection: h.connection, auth: actor });
  const customers = createCustomersModule({ connection: h.connection, auth: actor, media: { removeAddressMedia: async id => { removedMedia.push(id); return 1; } } });
  const audit = createAuditAdminModule({ connection: h.connection, auth: actor });
  app = h.appWith([...settings.routes, ...reports.routes, ...customers.routes, ...audit.routes]);
}, 180_000);
afterAll(async () => { await h?.stop(); }, 60_000);

const col = (name: string) => h.connection.collection(name);
const get = (url: string, who = "admin") => request(app).get(`${api}${url}`).set(as(who));
const send = (method: "put" | "post", url: string, body: unknown, who = "admin") => request(app)[method](`${api}${url}`).set(as(who)).send(body as object);

beforeEach(async () => {
  await h.reset();
  await col("zones").insertOne({ _id: new Types.ObjectId(ZONE), name: "Darjeeling" });
  await col("warehouses").insertMany([
    { _id: new Types.ObjectId(W1), zoneId: new Types.ObjectId(ZONE), name: "Chowrasta" }, { _id: new Types.ObjectId(W2), zoneId: new Types.ObjectId(ZONE), name: "Ghoom" },
  ]);
  removedMedia.length = 0;
});

describe("settings", () => {
  it("lists the registry and resolves defaults", async () => {
    const registry = await get("/admin/settings/registry");
    expect(registry.status).toBe(200);
    expect(registry.body.data.find((d: { key: string }) => d.key === "packMinutes")).toMatchObject({ group: "eta", default: 5, type: "integer" });
    const eta = await get(`/admin/settings/eta?scopeType=warehouse&scopeId=${W1}`);
    expect(eta.body.data.values.find((v: { key: string }) => v.key === "packMinutes")).toEqual({ key: "packMinutes", value: 5, source: "default", version: 0 });
  });

  it("applies the most specific scope, records history and audit, and removes overrides with null", async () => {
    expect((await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 8 } })).status).toBe(200);
    expect((await send("put", "/admin/settings/eta", { scope: { type: "zone", id: ZONE }, values: { packMinutes: 7 } })).status).toBe(200);
    const w = await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W1 }, values: { packMinutes: 6 } });
    expect(w.body.data.values.find((v: { key: string }) => v.key === "packMinutes")).toEqual({ key: "packMinutes", value: 6, source: "warehouse", version: 1 });
    expect((await get(`/admin/settings/eta?scopeType=warehouse&scopeId=${W2}`)).body.data.values[0]).toMatchObject({ value: 7, source: "zone" });
    expect((await get("/admin/settings/eta")).body.data.values[0]).toMatchObject({ value: 8, source: "global" });

    const again = await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W1 }, values: { packMinutes: 9 } });
    expect(again.body.data.values[0]).toMatchObject({ value: 9, version: 2 });
    const removed = await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W1 }, values: { packMinutes: null } });
    expect(removed.body.data.values[0]).toMatchObject({ value: 7, source: "zone" });

    const history = await get("/admin/settings/history?group=eta&key=packMinutes");
    expect(history.body.data.map((r: { oldValue: unknown; newValue: unknown; scope: { type: string } }) => [r.scope.type, r.oldValue, r.newValue])).toEqual([
      ["warehouse", 9, null], ["warehouse", 6, 9], ["warehouse", null, 6], ["zone", null, 7], ["global", null, 8],
    ]);
    const audits = await get("/admin/audit?action=settings.update");
    expect(audits.body.data).toHaveLength(5);
    expect(audits.body.data[0]).toMatchObject({ entityType: "setting", entityId: "eta.packMinutes", actorId: STAFF_ID, before: { value: 9 }, after: null });
  });

  it("does nothing, and writes no history, when the value is unchanged", async () => {
    await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 8 } });
    await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 8 } });
    expect(await col("settings_history").countDocuments()).toBe(1);
  });

  it("rejects invalid input without saving anything", async () => {
    const bad = await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 5, extraMinutes: 500 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(bad.body.error.details).toEqual([{ key: "extraMinutes", message: "must be a whole number from 0 to 120" }]);
    expect((await send("put", "/admin/settings/stock", { scope: { type: "zone", id: ZONE }, values: { zonePriceConflictMode: "warn" } })).status).toBe(400);
    expect((await send("put", "/admin/settings/discounts", { scope: { type: "global" }, values: { rainSurchargeAmount: 9000 } })).status).toBe(400);
    expect((await send("put", "/admin/settings/orders", { scope: { type: "global" }, values: { slaConfirmMinutes: 20 } })).status).toBe(400);
    expect((await send("put", "/admin/settings/eta", { scope: { type: "zone", id: "b".repeat(24) }, values: { packMinutes: 5 } })).status).toBe(404);
    expect((await send("put", "/admin/settings/nope", { scope: { type: "global" }, values: { a: 1 } })).status).toBe(404);
    expect((await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: {} })).status).toBe(400);
    expect(await col("settings").countDocuments()).toBe(0);
  });

  it("keeps scoped staff to their own warehouse and to their own history", async () => {
    expect((await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W1 }, values: { packMinutes: 6 } }, "w1")).status).toBe(200);
    expect((await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W2 }, values: { packMinutes: 6 } }, "w1")).status).toBe(403);
    expect((await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 6 } }, "w1")).status).toBe(403);
    expect((await get("/admin/settings/eta", "w1")).status).toBe(403);
    expect((await get(`/admin/settings/eta?scopeType=warehouse&scopeId=${W2}`, "w1")).status).toBe(403);
    await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 9 } });
    await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W2 }, values: { packMinutes: 4 } });
    const mine = await get("/admin/settings/history", "w1");
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].scope).toEqual({ type: "warehouse", id: W1 });
  });

  it("needs the right permission and a session", async () => {
    expect((await get("/admin/settings/registry", "nobody")).status).toBe(403);
    expect((await request(app).get(`${api}/admin/settings/registry`)).status).toBe(401);
  });

  it("lets two simultaneous changes to one key finish with a single consistent version history", async () => {
    const calls = await Promise.all([1, 2, 3, 4].map(n => send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 10 + n } })));
    expect(calls.every(c => c.status === 200 || c.status === 409)).toBe(true);
    const stored = await col("settings").find({ key: "packMinutes" }).toArray();
    expect(stored).toHaveLength(1);
    expect(await col("settings_history").countDocuments({ key: "packMinutes" })).toBe(stored[0]!.version);
  });
});

const now = new Date();
let seq = 0;
async function order(over: Record<string, unknown> = {}) {
  seq += 1;
  const doc = {
    _id: `ord_${seq}`, orderNo: `DS-${seq}`, groupId: `grp_${seq}`, userId: "c1".repeat(12), zoneId: ZONE, warehouseId: W1, status: "DELIVERED", paymentMethod: "cod", paymentStatus: "cod_collected",
    items: [{ productId: "p1", variantId: "v1", name: "Tomato", qty: 2, lineTotal: 20_000, status: "ok" }], itemsSubtotal: 20_000, allocatedDiscount: 2_000,
    allocatedCharges: [{ type: "delivery_fee", amount: 3_000 }, { type: "surcharge_rain", amount: 1_000 }], amountDue: 22_000, scheduledWindow: null,
    promisedAt: new Date(now.getTime() + 30 * 60_000), stamps: { deliveredAt: new Date(now.getTime() + 20 * 60_000) }, createdAt: now, ...over,
  };
  await col("orders").insertOne(doc);
  return doc;
}

describe("dashboard and reports", () => {
  beforeEach(async () => {
    seq = 0;
    await order();                                                                       // W1 delivered, total 22000
    await order({ status: "PACKING", stamps: {}, promisedAt: new Date(now.getTime() - 20 * 60_000) }); // W1 active and delayed, total 22000
    await order({ status: "CANCELLED", stamps: {} });                                    // W1 cancelled, not revenue
    await order({ status: "PENDING_PAYMENT", stamps: {} });                              // not counted at all
    await order({ warehouseId: W2, userId: "c2".repeat(12), allocatedDiscount: 0, allocatedCharges: [] }); // W2 delivered, total 20000
    await col("orders").insertOne({ _id: "old", warehouseId: W1, status: "DELIVERED", userId: "c1".repeat(12), itemsSubtotal: 99_999, allocatedDiscount: 0, allocatedCharges: [], createdAt: new Date(now.getTime() - 40 * 86_400_000), items: [], stamps: {} });
    await col("riders").insertMany([{ _id: "r1", isActive: true, status: "online", warehouseIds: [W1] }, { _id: "r2", isActive: true, status: "on_break", warehouseIds: [W2] }, { _id: "r3", isActive: true, status: "offline", warehouseIds: [W1] }, { _id: "r4", isActive: false, status: "online", warehouseIds: [W1] }]);
    await col("refunds").insertMany([{ _id: "f1", warehouseId: W1, status: "requested" }, { _id: "f2", warehouseId: W2, status: "approved" }, { _id: "f3", warehouseId: W1, status: "done" }]);
    await col("warehouse_products").insertMany([
      { _id: "o1", warehouseId: W1, status: "active", stockGrams: 100, variants: [] }, { _id: "o2", warehouseId: W1, status: "active", stockGrams: 50_000, variants: [{ isActive: true, stock: 2 }] },
      { _id: "o3", warehouseId: W2, status: "active", stockGrams: null, variants: [{ isActive: true, stock: 99 }] }, { _id: "o4", warehouseId: W1, status: "inactive", stockGrams: 1, variants: [] },
    ]);
    await col("offline_reviews").insertOne({ _id: "n1", warehouseId: W1, status: "open" });
    await col("cash_reconciliation").insertMany([{ _id: "k1", warehouseId: W1, status: "open" }, { _id: "k2", warehouseId: W1, status: "resolved" }]);
    await col("cash_balances").insertMany([{ _id: "b1", riderId: "r1", warehouseId: W1, amount: 5_000 }, { _id: "b2", riderId: "r2", warehouseId: W2, amount: 700 }]);
    await col("assignments").insertMany([{ _id: "a1", orderId: "ord_1", live: true, status: "assigned", ackAt: null }, { _id: "a2", orderId: "ord_5", live: true, status: "assigned", ackAt: null }, { _id: "a3", orderId: "ord_1", live: true, status: "acknowledged", ackAt: now }]);
  });

  it("shows today's numbers across all warehouses", async () => {
    const res = await get("/admin/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      orders: { today: 4, active: 1, delivered: 2, cancelled: 1 }, revenue: { today: 22_000 + 22_000 + 20_000 },
      riders: { online: 1, onBreak: 1, offline: 1 }, pendingRefunds: 2, lowStock: 2, offlineDeliveryReviews: 1, reconciliationOpen: 1, riderCashOutstanding: 5_700,
      unacknowledgedAssignments: 2, delayedOrders: 1,
    });
    expect(res.body.data.byWarehouse).toEqual([{ warehouseId: W1, orders: 3, revenue: 44_000 }, { warehouseId: W2, orders: 1, revenue: 20_000 }]);
  });

  it("limits a scoped manager to their warehouse and refuses another one", async () => {
    const res = await get("/admin/dashboard", "w1");
    expect(res.body.data).toMatchObject({ orders: { today: 3, delivered: 1, cancelled: 1, active: 1 }, revenue: { today: 44_000 }, riders: { online: 1, onBreak: 0, offline: 1 }, pendingRefunds: 1, riderCashOutstanding: 5_000, unacknowledgedAssignments: 1 });
    expect(res.body.data.byWarehouse).toHaveLength(1);
    expect((await get(`/admin/dashboard?warehouseId=${W2}`, "w1")).status).toBe(403);
    expect((await get(`/admin/dashboard?warehouseId=${W2}`)).body.data.orders.today).toBe(1);
  });

  it("leaves a rider tip out of revenue, because it belongs to the rider", async () => {
    const before = (await get("/admin/dashboard")).body.data.revenue.today as number;
    await order({ warehouseId: W2, userId: "c2".repeat(12), itemsSubtotal: 10_000, allocatedDiscount: 0, allocatedCharges: [{ type: "delivery_fee", amount: 1_000 }, { type: "tip", amount: 3_000 }] });
    expect((await get("/admin/dashboard")).body.data.revenue.today).toBe(before + 11_000);
    const sales = (await get("/admin/reports/sales")).body.data.rows.reduce((sum: number, r: (string | number)[]) => sum + (r[2] as number), 0);
    expect(sales).toBe(64_000 + 11_000);
    expect((await get("/admin/customers?q=98")).status).toBe(200);
  });

  it("uses a changed delayed-order setting on the next request", async () => {
    const strict = createReportsModule({ connection: h.connection, auth: actor, settings: async () => ({ delayedAfterMinutes: 60, lowStockGrams: 5000, lowStockUnits: 5 }) });
    const app2 = h.appWith(strict.routes);
    expect((await request(app2).get(`${api}/admin/dashboard`).set(as("admin"))).body.data.delayedOrders).toBe(0);
  });

  it("lists the nine reports", async () => {
    const res = await get("/admin/reports");
    expect(res.body.data.map((r: { name: string }) => r.name)).toEqual(["sales", "order-funnel", "cod-cash", "rider-deliveries", "delivery-time", "stock-wastage", "surcharge-income", "notify-demand", "coupon-usage"]);
  });

  it("totals sales to the paise, matching the orders", async () => {
    const res = await get("/admin/reports/sales");
    expect(res.status).toBe(200);
    const total = res.body.data.rows.reduce((s: number, r: (string | number)[]) => s + (r[2] as number), 0);
    expect(total).toBe(64_000);
    expect(res.body.data.columns).toEqual(["date", "orders", "revenue", "avgOrderValue"]);
    expect(res.body.data.rows.at(-1)).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 3, 64_000, 21_333]);
    const byWarehouse = await get("/admin/reports/sales?groupBy=warehouse");
    expect(byWarehouse.body.data.rows).toEqual([["Chowrasta", 2, 44_000, 22_000], ["Ghoom", 1, 20_000, 20_000]]);
    expect((await get("/admin/reports/sales?groupBy=warehouse", "w1")).body.data.rows).toEqual([["Chowrasta", 2, 44_000, 22_000]]);
    const byProduct = await get("/admin/reports/sales?groupBy=product");
    expect(byProduct.body.data.rows).toEqual([["p1", 3, 6, 60_000]]);
  });

  it("includes older days only when asked for them", async () => {
    const wide = await get("/admin/reports/sales?from=2000-01-01&to=2100-01-01");
    expect(wide.status).toBe(400);
    const start = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const long = await get(`/admin/reports/sales?from=${start}`);
    expect(long.body.data.rows.reduce((s: number, r: (string | number)[]) => s + (r[2] as number), 0)).toBe(64_000 + 99_999);
  });

  it("returns CSV for a report and for customers", async () => {
    const res = await get("/admin/reports/sales?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.split("\r\n")[0]).toBe("date,orders,revenue,avgOrderValue");
  });

  it("answers every report, with the documented columns and no error", async () => {
    await col("stock_movements").insertOne({ _id: "m1", warehouseId: W1, productId: "p1", mode: "grams", delta: -250, reason: "wastage", createdAt: now });
    await col("stock_subscriptions").insertOne({ _id: "s1", zoneId: ZONE, productId: "p1", userId: "c1".repeat(12), status: "waiting", createdAt: now });
    await col("order_groups").insertOne({ _id: "grp_1", couponCode: "WELCOME" });
    await col("cash_ledger").insertMany([{ _id: "l1", riderId: "r1", warehouseId: W1, type: "collected", amount: 22_000, at: now }, { _id: "l2", riderId: "r1", warehouseId: W1, type: "deposit", amount: -10_000, at: now }]);
    await col("assignments").insertOne({ _id: "a9", orderId: "ord_1", riderId: "r1", outcome: "delivered", assignedAt: new Date(now.getTime() - 30 * 60_000), completedAt: now });
    await col("riders").updateOne({ _id: "r1" as never }, { $set: { name: "Pema" } });
    const expectRows = async (url: string) => { const r = await get(url); expect(r.status, url).toBe(200); return r.body.data; };
    expect((await expectRows("/admin/reports/order-funnel")).rows).toContainEqual(["DELIVERED", 2]);
    expect((await expectRows("/admin/reports/cod-cash")).rows).toEqual([["Pema", 22_000, 10_000, 0, 12_000]]);
    expect((await expectRows("/admin/reports/rider-deliveries")).rows).toEqual([["Pema", 1, 0, 30]]);
    const timing = await expectRows("/admin/reports/delivery-time");
    expect(timing.rows[0].slice(2, 4)).toEqual([1, 1]);
    expect((await expectRows("/admin/reports/stock-wastage?groupBy=warehouse")).rows).toEqual([["Chowrasta", 1, 250, 0]]);
    expect((await expectRows("/admin/reports/surcharge-income")).rows.at(-1).slice(1)).toEqual([2_000, 0, 0, 2_000]);
    expect((await expectRows("/admin/reports/notify-demand")).rows).toEqual([["p1", 1, 1]]);
    expect((await expectRows("/admin/reports/coupon-usage")).rows).toEqual([["WELCOME", 1, 1, 2_000]]);
    expect((await get("/admin/reports/notify-demand", "w1")).body.data.rows).toHaveLength(1);
  });

  it("rejects unknown reports and unsupported groupings", async () => {
    expect((await get("/admin/reports/nope")).status).toBe(404);
    expect((await get("/admin/reports/cod-cash?groupBy=product")).status).toBe(400);
    expect((await get("/admin/reports/sales?format=xml")).status).toBe(400);
    expect((await get("/admin/reports/sales?from=yesterday")).status).toBe(400);
    expect((await get("/admin/reports", "nobody")).status).toBe(403);
  });
});

const CUSTOMER = new Types.ObjectId("c1".repeat(12));
const OTHER = new Types.ObjectId("c2".repeat(12));
async function customers() {
  await col("users").insertMany([
    { _id: CUSTOMER, kind: "customer", name: "Asha Rai", phone: "+919876543210", status: "active", codAllowed: true, createdAt: new Date("2026-10-01") },
    { _id: OTHER, kind: "customer", name: "Dorjee Lama", phone: "+919800000001", status: "active", codAllowed: true, createdAt: new Date("2026-10-02") },
    { _id: new Types.ObjectId(STAFF_ID), kind: "staff", name: "Pema Sherpa", email: "pema@example.com", status: "active" },
  ]);
}

describe("customers", () => {
  beforeEach(async () => { seq = 0; await customers(); await order(); await order({ warehouseId: W2, userId: "c2".repeat(12) }); await order({ status: "CANCELLED", stamps: {} }); });
  const id = CUSTOMER.toHexString();

  it("searches by name, phone and flags, with order figures", async () => {
    const all = await get("/admin/customers");
    expect(all.body.data.map((c: { name: string }) => c.name)).toEqual(["Dorjee Lama", "Asha Rai"]);
    expect(all.body.data[1]).toMatchObject({ id, phone: "+919876543210", status: "active", codAllowed: true, orderCount: 1, lifetimeValue: 22_000, blockedReason: null, internalNotes: [] });
    expect((await get("/admin/customers?q=asha")).body.data).toHaveLength(1);
    expect((await get("/admin/customers?q=98765%2043210")).body.data[0].name).toBe("Asha Rai");
    expect((await get("/admin/customers?q=.*")).body.data).toHaveLength(0);
    expect((await get("/admin/customers?status=blocked")).body.data).toHaveLength(0);
    expect((await get("/admin/customers?codAllowed=false")).body.data).toHaveLength(0);
    const page = await get("/admin/customers?limit=1");
    expect(page.body.data).toHaveLength(1);
    expect((await get(`/admin/customers?limit=1&cursor=${page.body.meta.nextCursor}`)).body.data[0].name).toBe("Asha Rai");
    expect((await get("/admin/customers", "nobody")).status).toBe(403);
  });

  it("shows a profile with addresses and recent orders, limited to a scoped manager's warehouses", async () => {
    await col("addresses").insertOne({ _id: "ad1", userId: id, label: "Home", line1: "Cedar Villa", landmark: "Gate", localityName: "Chowrasta", pincode: "734101", contactName: "Asha", contactPhone: "+919876543210", isDefault: true, isDeliverable: true });
    const res = await get(`/admin/customers/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.addresses).toEqual([{ id: "ad1", label: "Home", line1: "Cedar Villa", landmark: "Gate", locality: "Chowrasta", pincode: "734101", contactName: "Asha", contactPhone: "+919876543210", isDefault: true, isDeliverable: true }]);
    expect(res.body.data.recentOrders.map((o: { status: string }) => o.status).sort()).toEqual(["CANCELLED", "DELIVERED"]);
    expect((await get(`/admin/customers/${OTHER.toHexString()}`, "w1")).body.data.orderCount).toBe(0);
    expect((await get("/admin/customers", "w1")).body.data.map((c: { name: string }) => c.name)).toEqual(["Asha Rai"]);
    expect((await get("/admin/customers/" + "f".repeat(24))).status).toBe(404);
    expect((await get(`/admin/customers/${new Types.ObjectId(STAFF_ID).toHexString()}`)).status).toBe(404);
    expect((await get("/admin/customers/not-an-id")).status).toBe(404);
  });

  it("edits the COD flag and adds a note under the staff member's name, with an audit record", async () => {
    const res = await send("put", `/admin/customers/${id}`, { codAllowed: false, note: "Refused 3 deliveries" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ codAllowed: false, internalNotes: [{ text: "Refused 3 deliveries", by: "Pema Sherpa" }] });
    const audit = (await get("/admin/audit?entityType=customer")).body.data;
    expect(audit[0]).toMatchObject({ action: "customers.update", entityId: id, before: { status: "active", codAllowed: true }, after: { codAllowed: false, noteAdded: true }, reason: "note added" });
    expect((await send("put", `/admin/customers/${id}`, {})).status).toBe(400);
    expect((await send("put", `/admin/customers/${id}`, { codAllowed: false, role: "admin" })).status).toBe(400);
    expect((await send("put", `/admin/customers/${id}`, { codAllowed: true }, "w1")).status).toBe(403);
  });

  it("blocks and unblocks, refusing a repeat", async () => {
    expect((await send("post", `/admin/customers/${id}/block`, {})).status).toBe(400);
    const blocked = await send("post", `/admin/customers/${id}/block`, { reason: "Fraud" });
    expect(blocked.body.data).toMatchObject({ status: "blocked", blockedReason: "Fraud" });
    expect((await col("users").findOne({ _id: CUSTOMER }))!.credentialRevision).toBe(1);
    expect((await send("post", `/admin/customers/${id}/block`, { reason: "Again" })).status).toBe(409);
    expect((await get("/admin/customers?status=blocked")).body.data).toHaveLength(1);
    const open = await send("post", `/admin/customers/${id}/unblock`, {});
    expect(open.body.data).toMatchObject({ status: "active", blockedReason: null });
    expect((await send("post", `/admin/customers/${id}/unblock`, {})).status).toBe(409);
    const audit = (await get("/admin/audit?entityId=" + id)).body.data.map((a: { action: string }) => a.action);
    expect(audit).toEqual(["customers.unblock", "customers.block"]);
    expect((await send("post", `/admin/customers/${id}/block`, { reason: "x" }, "w1")).status).toBe(403);
  });

  it("finalises a deletion request: anonymises, keeps orders and frees the phone number", async () => {
    expect((await send("post", `/admin/customers/${id}/finalise-deletion`, {})).status).toBe(409);
    await col("users").updateOne({ _id: CUSTOMER }, { $set: { status: "deletion_requested", deletionRequest: { reason: "bye", requestedAt: new Date() }, email: "asha@example.com" } });
    await col("addresses").insertMany([{ _id: "ad1", userId: id }, { _id: "ad2", userId: id }]);
    await col("carts").insertOne({ _id: "cart1", userId: id });
    await col("device_tokens").insertOne({ _id: "d1", userId: CUSTOMER });
    await col("otps").insertOne({ _id: "otp1", phone: "+919876543210" });
    await col("stock_subscriptions").insertOne({ _id: "sub1", userId: id, status: "waiting" });
    // an order in progress holds it back
    await order({ status: "PACKING", stamps: {} });
    expect((await send("post", `/admin/customers/${id}/finalise-deletion`, {})).status).toBe(409);
    expect((await col("users").findOne({ _id: CUSTOMER }))!.status).toBe("deletion_requested");
    await col("orders").updateOne({ status: "PACKING" }, { $set: { status: "DELIVERED" } });

    const res = await send("post", `/admin/customers/${id}/finalise-deletion`, {});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id, status: "deleted", addressesRemoved: 2, mediaRemoved: 2, mediaFailed: 0 });
    expect(removedMedia.sort()).toEqual(["ad1", "ad2"]);
    const user = (await col("users").findOne({ _id: CUSTOMER }))!;
    expect(user).toMatchObject({ name: "Deleted customer", status: "deleted", codAllowed: false });
    expect(user.phone).toBeUndefined();
    expect(user.email).toBeUndefined();
    for (const name of ["addresses", "carts", "device_tokens", "otps"]) expect(await col(name).countDocuments(), name).toBe(0);
    expect((await col("stock_subscriptions").findOne({ _id: "sub1" as never }))!.status).toBe("cancelled");
    expect(await col("orders").countDocuments({ userId: id })).toBe(3);
    await col("users").insertOne({ _id: new Types.ObjectId(), kind: "customer", name: "New", phone: "+919876543210", status: "active" });
    expect((await send("post", `/admin/customers/${id}/finalise-deletion`, {})).status).toBe(409);
    expect((await get("/admin/audit?action=customers.finalise_deletion")).body.data).toHaveLength(1);
  });

  it("exports CSV (all-warehouse access only), neutralising formulas, and audits it", async () => {
    await col("users").updateOne({ _id: OTHER }, { $set: { name: "=cmd|' /C calc'!A0" } });
    const res = await get("/admin/customers/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe("id,name,phone,status,codAllowed,orderCount,lifetimeValue,lastOrderAt");
    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).toContain("'=cmd");
    expect((await get("/admin/customers/export", "w1")).status).toBe(403);
    expect((await get("/admin/audit?action=customers.export")).body.data).toHaveLength(1);
  });
});

describe("audit search", () => {
  it("is read-only, filtered, paged, and limited to a scoped manager's warehouses", async () => {
    await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W1 }, values: { packMinutes: 6 } });
    await send("put", "/admin/settings/eta", { scope: { type: "warehouse", id: W2 }, values: { packMinutes: 7 } });
    await send("put", "/admin/settings/eta", { scope: { type: "global" }, values: { packMinutes: 8 } });
    expect((await get("/admin/audit")).body.data).toHaveLength(3);
    const mine = await get("/admin/audit", "w1");
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].after.scope).toEqual({ type: "warehouse", id: W1 });
    const page = await get("/admin/audit?limit=2");
    expect(page.body.data).toHaveLength(2);
    expect((await get(`/admin/audit?limit=2&cursor=${page.body.meta.nextCursor}`)).body.data).toHaveLength(1);
    expect((await get("/admin/audit?actorId=nobody")).body.data).toHaveLength(0);
    expect((await get("/admin/audit?from=2100-01-01")).body.data).toHaveLength(0);
    expect((await get("/admin/audit?entityType=Bad%20Type")).status).toBe(400);
    expect((await request(app).delete(`${api}/admin/audit`).set(as("admin"))).status).toBe(404);
    expect((await get("/admin/audit", "nobody")).status).toBe(403);
  });
});

describe("audit log indexes", () => {
  it("are created so the audit search does not scan the whole log", async () => {
    const audit = createAuditAdminModule({ connection: h.connection, auth: actor });
    await audit.ensureIndexes();
    await audit.ensureIndexes();
    const keys = (await col("audit_log").indexes()).map(i => Object.keys(i.key).join(","));
    expect(keys).toEqual(expect.arrayContaining(["entityType,entityId,_id", "actorId,_id", "action,_id", "warehouseId,_id", "at"]));
  });
});
