import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createAdminModules } from "../../src/composition/admin.js";
import { createProduction } from "../../src/composition/production.js";
import { loadConfig } from "../../src/config/env.js";
import { createAccessStore } from "../../src/modules/access/access.public.js";
import { createGeographyModule } from "../../src/modules/geography/geography.public.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";
import { createStaffActorResolver } from "../../src/modules/identity/session.public.js";
import { SYNTHETIC_POLYGONS } from "./support/geography-fixture.js";

/**
 * The real server's wiring, end to end: real zones and warehouses, the three kinds of sign-in, the owner's settings read on each request,
 * and the background jobs. Nothing here is a fake except the OTP (development mode accepts 000000) and the empty provider keys.
 */
const JWT = "a".repeat(64);
let replica: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let production: ReturnType<typeof createProduction>;
let background: { stop(): Promise<void> };
const API = "/api/v1";

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(replica.getUri("production_wiring_test")).asPromise();
  const config = loadConfig({ MONGODB_URI: "mongodb://localhost/x", NODE_ENV: "development", mockOTP: "true", JWT_SECRET: JWT, STAFF_TOTP_KEY: "b".repeat(64) } as NodeJS.ProcessEnv);
  await createAccessStore(db).initialize();
  const devRoutes = await createDevOtpRoutes(db, "development", JWT, [], false, config);
  const resolveStaff = createStaffActorResolver(db, JWT, config, true);
  const geography = createGeographyModule({ connection: db, resolveActor: resolveStaff, validateCsrf: () => true });
  await geography.ensureIndexes();
  const admin = createAdminModules({ connection: db, resolveStaff, trustedOrigins: [] });
  await admin.ensureIndexes();
  production = createProduction({ connection: db, config: { ...config, JWT_SECRET: JWT }, geography, admin });
  background = await production.start();
  app = createApp({ isReady: () => true, additionalRoutes: [...devRoutes, ...geography.routes, ...admin.routes], dev2Routes: production.routes });
}, 180_000);
afterAll(async () => { await background?.stop(); await db?.close(); await replica?.stop(); }, 60_000);

const col = (name: string) => db.collection(name);
async function login(phone: string, appName: "admin" | "customer" | "rider") {
  const sent = await request(app).post(`${API}/auth/request-otp`).send({ phone, app: appName });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const verified = await request(app).post(`${API}/auth/verify-otp`).send({ phone, otp: "000000" });
  expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  return { Authorization: `Bearer ${verified.body.data.accessToken}` };
}
const call = (method: "get" | "post" | "put" | "delete", path: string, who: Record<string, string>, body?: unknown) => {
  const r = request(app)[method](`${API}${path}`).set(who);
  return body === undefined ? r : r.send(body as object);
};

let owner: Record<string, string>, shopper: Record<string, string>, riderLogin: Record<string, string>;
let zoneId = "", warehouseId = "", localityId = "", productId = "", variantId = "", addressId = "", riderId = "", customerId = "";

describe("the real server wiring", () => {
  it("starts the background jobs", async () => {
    const names = (await col("job_schedules").find().toArray()).map(j => String(j._id ?? j.name ?? j.kind));
    expect(names.join(" ")).toMatch(/payments\.expire_overdue/);
    expect(names.join(" ")).toMatch(/dispatch\.ack_sweep/);
    expect(names.join(" ")).toMatch(/media\.sweep/);
  });

  it("answers from the real zones, warehouses and localities the owner creates", async () => {
    owner = await login("9000000001", "admin");
    const city = await call("post", "/admin/cities", owner, { name: "Darjeeling", state: "West Bengal" });
    expect(city.status, JSON.stringify(city.body)).toBe(201);
    const zone = await call("post", "/admin/zones", owner, { cityId: city.body.data.id, name: "Chowrasta", polygon: SYNTHETIC_POLYGONS.zoneA, isEnabled: true });
    expect(zone.status, JSON.stringify(zone.body)).toBe(201);
    zoneId = zone.body.data.id;
    const locality = await call("post", "/admin/localities", owner, { cityId: city.body.data.id, name: "Chowrasta Mall", location: { lat: 27.0412, lng: 88.263 }, zoneId, travelMinutes: 8, sortOrder: 1 });
    localityId = locality.body.data.id;
    const warehouse = await call("post", "/admin/warehouses", owner, {
      zoneId, name: "Chowrasta store", code: "CHOW-1", location: { lat: 27.041, lng: 88.2663 }, address: "Clock Tower, Mall Road, Darjeeling",
      priority: 1, packMinutes: 5, riderArrivalMinutes: 5, defaultTravelMinutes: 10, punchInRadiusMeters: 150,
    });
    expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(201);
    warehouseId = warehouse.body.data.id;
    const home = await request(app).get(`${API}/catalog/home?zoneId=${zoneId}`);
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    expect(home.body.data.zone).toMatchObject({ id: zoneId, name: "Chowrasta" });
    expect((await request(app).get(`${API}/catalog/home?zoneId=${"e".repeat(24)}`)).status).toBe(404);
  });

  it("lets a customer sign in and order from what the owner stocked, with a tip", async () => {
    const category = (await call("post", "/admin/categories", owner, { name: "Dairy" })).body.data.id;
    const product = await call("post", "/admin/products", owner, {
      name: "Fresh Milk", categoryId: category, type: "packaged", stockMode: "per_variant", status: "active", foodType: "veg",
      variants: [{ label: "1 L", weightGrams: 1000, sku: "MILK-1L" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    productId = product.body.data.id; variantId = product.body.data.variants[0].id;
    const offer = await call("post", "/admin/warehouse-products", owner, { warehouseId, productId, variants: [{ variantId, price: 6000, mrp: 6500, stock: 30 }] });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);

    shopper = await login("9000000002", "customer");
    expect((await request(app).get(`${API}/cart`)).status).toBe(401);
    const address = await call("post", "/addresses", shopper, {
      label: "Home", line1: "Cedar Villa", localityId, pincode: "734101", landmark: "Opposite the gate", contactName: "Asha Rai", contactPhone: "98765 43210",
      location: { lat: 27.041, lng: 88.2663 }, locationAccuracyM: 18,
    });
    expect(address.status, JSON.stringify(address.body)).toBe(201);
    addressId = address.body.data.id;
    expect((await call("put", "/cart", shopper, { clientRev: 1, addressId, items: [{ productId, variantId, qty: 2 }] })).status).toBe(200);
    const quote = await call("post", "/quotes", shopper, { paymentMethod: "cod", tipAmount: 2000 });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.data.pricing.charges.at(-1)).toEqual({ type: "tip", label: "Rider tip", amount: 2000 });
    const placed = await call("post", "/orders", { ...shopper, "Idempotency-Key": randomUUID() }, { quoteId: quote.body.data.id, paymentMethod: "cod" });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.data.group.children[0].status).toBe("CONFIRMED");
    const group = await call("get", `/order-groups/${placed.body.data.group.id}`, shopper);
    expect(group.body.data.deliveryOtp).toMatch(/^\d{4}$/);
    // The delivery code is stored locked with a key made for it, not a built-in one.
    expect((await col("order_groups").findOne({}))!.deliveryOtpEnc).toMatch(/^v1\./);
    customerId = String((await col("users").findOne({ phone: "+919000000002" }))!._id);
  });

  it("applies an owner's settings change to the very next order, with no restart", async () => {
    const order = async () => {
      await call("put", "/cart", shopper, { clientRev: Date.now() % 1_000_000_000, addressId, items: [{ productId, variantId, qty: 1 }] });
      const q = await call("post", "/quotes", shopper, { paymentMethod: "cod" });
      const res = await call("post", "/orders", { ...shopper, "Idempotency-Key": randomUUID() }, { quoteId: q.body.data.id, paymentMethod: "cod" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.group.children[0].status as string;
    };
    expect((await call("put", "/admin/settings/orders", owner, { scope: { type: "global" }, values: { confirmMode: "manual" } })).status).toBe(200);
    expect(await order()).toBe("PLACED");
    expect((await call("put", "/admin/settings/orders", owner, { scope: { type: "global" }, values: { confirmMode: null } })).status).toBe(200);
    expect(await order()).toBe("CONFIRMED");
    // Limits the cart applies are live too.
    expect((await call("put", "/admin/settings/orders", owner, { scope: { type: "global" }, values: { maxQtyPerItem: 1 } })).status).toBe(200);
    const capped = await call("put", "/cart", shopper, { clientRev: 999_999_999, addressId, items: [{ productId, variantId, qty: 5 }] });
    expect(capped.body.data.cart.items[0].qty).toBe(1);
    expect(production.live.discovery.maxQtyPerItem).toBe(1);
    await call("put", "/admin/settings/orders", owner, { scope: { type: "global" }, values: { maxQtyPerItem: null } });
  });

  it("registers a rider's login, lets them sign in as a rider only, and ends their session when switched off", async () => {
    const created = await call("post", "/admin/riders", owner, { name: "Pema Sherpa", phone: "+919000000077", zoneId, warehouseIds: [warehouseId], vehicle: "Scooter" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    riderId = created.body.data.id;
    expect((await call("post", "/admin/riders", owner, { name: "Again", phone: "+919000000077", zoneId, warehouseIds: [warehouseId] })).status).toBe(409);
    riderLogin = await login("9000000077", "rider");
    expect((await call("get", "/rider/me", riderLogin)).status).toBe(200);
    const tips = await call("get", "/rider/tips", riderLogin);
    expect(tips.status, JSON.stringify(tips.body)).toBe(200);
    expect(tips.body.data.totals).toEqual({ count: 0, total: 0, owed: 0, paid: 0 });
    expect((await call("get", "/rider/me", shopper)).status).toBe(401);
    expect((await call("get", "/cart", riderLogin)).status).toBe(401);
    expect((await call("post", `/admin/riders/${riderId}/deactivate`, owner)).status).toBe(200);
    expect((await call("get", "/rider/me", riderLogin)).status).toBe(401);
    expect((await call("post", `/admin/riders/${riderId}/reactivate`, owner)).status).toBe(200);
  });

  it("stops a blocked customer at once and lets them back when unblocked", async () => {
    expect((await call("get", "/cart", shopper)).status).toBe(200);
    expect((await call("post", `/admin/customers/${customerId}/block`, owner, { reason: "Fraud" })).status).toBe(200);
    expect((await call("get", "/cart", shopper)).status).toBe(401);
    expect((await call("post", `/admin/customers/${customerId}/unblock`, owner)).status).toBe(200);
    // Their old session is cut by the block, so they sign in again.
    shopper = await login("9000000002", "customer");
    expect((await call("get", "/cart", shopper)).status).toBe(200);
  });

  it("recognises who is signed in for uploads, and refuses a stranger", async () => {
    const asCustomer = await call("post", "/media/upload-url", shopper, { kind: "address_photo", contentType: "image/jpeg", sizeBytes: 5000 });
    expect([201, 503]).toContain(asCustomer.status);
    expect((await request(app).post(`${API}/media/upload-url`).send({ kind: "address_photo", contentType: "image/jpeg", sizeBytes: 5000 })).status).toBe(401);
    expect((await call("post", "/media/upload-url", shopper, { kind: "product_image", contentType: "image/jpeg", sizeBytes: 5000 })).status).toBe(403);
  });

  it("shows the order in the owner's dashboard and rider tips report, using the same data", async () => {
    const dashboard = await call("get", "/admin/dashboard", owner);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.orders.today).toBeGreaterThanOrEqual(3);
    expect((await call("get", "/admin/rider-tips", owner)).status).toBe(200);
    expect((await call("get", "/admin/audit?action=settings.update", owner)).body.data.length).toBeGreaterThanOrEqual(3);
  });
});
