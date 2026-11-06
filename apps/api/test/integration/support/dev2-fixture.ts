import request from "supertest";
import { expect } from "vitest";
import { createDev2Modules } from "../../../src/composition/dev2.js";
import type { StockEvent } from "../../../src/modules/offerings/offerings.public.js";
import type { Banner, StoreSettingsValue } from "../../../src/modules/discovery/discovery.public.js";
import { createFakeGeography, type FakeGeography } from "./fake-geography.js";
import { createFakeOrders, createFakeRiderIdentity, type FakeOrders, type FakeRiderIdentity } from "./fake-orders.js";
import { createFakeMessaging, type FakeMessaging } from "./fake-messaging.js";
import { createFakeStorage, type FakeStorage } from "./fake-storage.js";
import { actorFromHeader, api, customerFromHeader, principalFromHeader, riderFromHeader, startHarness, type Harness } from "./harness.js";

export const ZONE1 = "1".repeat(24);
export const ZONE2 = "2".repeat(24);
export const W1 = "a1".repeat(12);
export const W2 = "a2".repeat(12);
export const W3 = "a3".repeat(12);
const WAREHOUSES: Record<string, { id: string; zoneId: string; isEnabled: boolean }> = {
  [W1]: { id: W1, zoneId: ZONE1, isEnabled: true },
  [W2]: { id: W2, zoneId: ZONE1, isEnabled: true },
  [W3]: { id: W3, zoneId: ZONE2, isEnabled: true },
};

export const admin = { "X-Test-Actor": "admin" };
export const viewer = { "X-Test-Actor": "viewer" };
export const customer = (userId: string) => ({ "X-Test-Customer": userId });
export const CUSTOMER_A = "c1".repeat(12);
export const CUSTOMER_B = "c2".repeat(12);
export const CUSTOMER_C = "c3".repeat(12);
/** Logins for the media routes. Catalog routes use the `X-Test-Actor` header, so a test that needs both sends both. */
export const asPrincipal = (who: string) => ({ "X-Test-Principal": who });
export const scoped = (warehouseId: string) => ({ "X-Test-Actor": `scoped:${warehouseId}` });

export interface Fixture {
  h: Harness;
  mods: ReturnType<typeof createDev2Modules>;
  app: ReturnType<Harness["appWith"]>;
  events: StockEvent[];
  storage: FakeStorage;
  /** Fake push, WhatsApp, SMS and identity lookups. */
  msg: FakeMessaging;
  /** Fake zones, localities and warehouse hours. */
  geo: FakeGeography;
  /** Fake orders with the real status rules, and fake rider login accounts. */
  orders: FakeOrders;
  accounts: FakeRiderIdentity;
  /** Home banners and store settings the catalog shows; tests change them freely. */
  banners: Banner[];
  storeValue: StoreSettingsValue;
  /** Runs the job queue until nothing more is due. */
  runJobs(): Promise<number>;
  reset(): Promise<void>;
  get(path: string, who?: Record<string, string>): request.Test;
  send(method: "post" | "put" | "delete", path: string, body?: unknown, who?: Record<string, string>): request.Test;
  category(): Promise<string>;
  pooledProduct(name?: string, sku?: string): Promise<{ id: string; v250: string; v500: string }>;
  packagedProduct(name?: string, sku?: string): Promise<{ id: string; v1: string; v2: string }>;
  offer(warehouseId: string, productId: string, body: Record<string, unknown>, who?: Record<string, string>): Promise<{ id: string; rev: number; body: any }>;
  /** Pooled offering with the standard 250 g / 500 g prices. */
  pooledOffer(warehouseId: string, product: { id: string; v250: string; v500: string }, stockGrams: number, prices?: { v250?: number; v500?: number }): Promise<{ id: string; rev: number }>;
  packagedOffer(warehouseId: string, product: { id: string; v1: string; v2: string }, stock: [number, number]): Promise<{ id: string; rev: number }>;
}

export async function startFixture(databaseName: string): Promise<Fixture> {
  const h = await startHarness(databaseName);
  const events: StockEvent[] = [];
  const storage = createFakeStorage();
  const msg = createFakeMessaging();
  const geo = createFakeGeography({ ZONE1, ZONE2, W1, W2, W3 });
  const orders = createFakeOrders();
  const accounts = createFakeRiderIdentity();
  const banners: Banner[] = [];
  const defaultStore = (): StoreSettingsValue => ({
    etaMinMinutes: 15, etaMaxMinutes: 20, minOrder: 10000, freeDeliveryAbove: 60000, smallOrderFee: 0, afterHoursMode: "pre_order", preOrderAvailable: true,
    opensAt: null, closesAt: new Date("2026-11-05T14:30:00Z"), pauseMessage: "Back at 9 AM", notices: [{ type: "rain", label: "Rain mode: +₹15 delivery fee, +10 min", amount: 1500, extraMinutes: 10 }],
  });
  const storeValue = defaultStore();
  const mods = createDev2Modules({
    storage: storage.provider, principal: principalFromHeader, mediaSettings: { maxPendingPerUser: 3 },
    push: msg.push, whatsapp: msg.whatsapp, sms: msg.sms, contacts: msg.contacts, devices: msg.devices, audience: msg.audience,
    webhook: { verifyToken: "verify-me", appSecret: "app-secret" },
    geography: geo.geography, banners: { forZone: async () => banners }, storeSettings: { forZone: async () => storeValue },
    discoverySettings: { maxChanges: 6 },
    orders: orders.port, riderIdentity: accounts.identity, rider: riderFromHeader,
    connection: h.connection, auth: actorFromHeader, customer: customerFromHeader,
    warehouses: { get: async id => WAREHOUSES[id] ?? null },
    events: { publish: event => { events.push(event); } },
  });
  const app = h.appWith(mods.routes);
  let counter = 0;
  const get = (path: string, who: Record<string, string> = admin) => request(app).get(api + path).set(who);
  const send: Fixture["send"] = (method, path, body, who = admin) => {
    const r = request(app)[method](api + path).set(who);
    return body === undefined ? r : r.send(body as object);
  };
  const fixture: Fixture = {
    h, mods, app, events, storage, msg, geo, orders, accounts, banners, storeValue, get, send,
    async runJobs() {
      let total = 0;
      for (let pass = 0; pass < 20; pass++) { const ran = await mods.jobs.service.runOnce(); total += ran; if (ran === 0) break; }
      return total;
    },
    async reset() {
      await h.reset();
      await mods.catalog.store.ensureIndexes();
      await mods.offerings.store.ensureIndexes();
      await mods.availability.store.ensureIndexes();
      await mods.media.store.ensureIndexes();
      await mods.jobs.store.ensureIndexes();
      await mods.notifications.ready();
      await mods.discovery.store.ensureIndexes();
      await mods.addresses.store.ensureIndexes();
      await mods.riders.store.ensureIndexes();
      await mods.dispatch.store.ensureIndexes();
      orders.reset();
      accounts.reset();
      storage.reset();
      msg.reset();
      geo.reset();
      banners.length = 0;
      Object.assign(storeValue, defaultStore());
      events.length = 0;
    },
    async category() {
      const res = await send("post", "/admin/categories", { name: `Category ${++counter}` });
      expect(res.status).toBe(201);
      return res.body.data.id;
    },
    async pooledProduct(name = `Tomato ${++counter}`, sku = `TOM${counter}`) {
      const res = await send("post", "/admin/products", {
        name, categoryId: await fixture.category(), type: "loose", stockMode: "pooled_weight", status: "active",
        variants: [{ label: "250 g", weightGrams: 250, sku: `${sku}-250` }, { label: "500 g", weightGrams: 500, sku: `${sku}-500` }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [a, b] = res.body.data.variants;
      return { id: res.body.data.id, v250: a.id, v500: b.id };
    },
    async packagedProduct(name = `Salt ${++counter}`, sku = `SALT${counter}`) {
      const res = await send("post", "/admin/products", {
        name, categoryId: await fixture.category(), type: "packaged", stockMode: "per_variant", status: "active",
        variants: [{ label: "500 g", weightGrams: 500, sku: `${sku}-500` }, { label: "1 kg", weightGrams: 1000, sku: `${sku}-1000` }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [a, b] = res.body.data.variants;
      return { id: res.body.data.id, v1: a.id, v2: b.id };
    },
    async offer(warehouseId, productId, body, who = admin) {
      const res = await send("post", "/admin/warehouse-products", { warehouseId, productId, ...body }, who);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return { id: res.body.data.id, rev: res.body.data.rev, body: res.body.data };
    },
    async pooledOffer(warehouseId, product, stockGrams, prices = {}) {
      const { id, rev } = await fixture.offer(warehouseId, product.id, {
        stockGrams,
        variants: [{ variantId: product.v250, price: prices.v250 ?? 1800, mrp: 2000 }, { variantId: product.v500, price: prices.v500 ?? 3200, mrp: 4000 }],
      });
      return { id, rev };
    },
    async packagedOffer(warehouseId, product, stock) {
      const { id, rev } = await fixture.offer(warehouseId, product.id, {
        variants: [{ variantId: product.v1, price: 5000, mrp: 6000, stock: stock[0] }, { variantId: product.v2, price: 9000, mrp: 10000, stock: stock[1] }],
      });
      return { id, rev };
    },
  };
  return fixture;
}
