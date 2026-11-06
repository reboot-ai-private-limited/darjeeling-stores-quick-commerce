import request from "supertest";
import { expect } from "vitest";
import { createDev2Modules } from "../../../src/composition/dev2.js";
import type { StockEvent } from "../../../src/modules/offerings/offerings.public.js";
import { actorFromHeader, api, startHarness, type Harness } from "./harness.js";

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
export const scoped = (warehouseId: string) => ({ "X-Test-Actor": `scoped:${warehouseId}` });

export interface Fixture {
  h: Harness;
  mods: ReturnType<typeof createDev2Modules>;
  app: ReturnType<Harness["appWith"]>;
  events: StockEvent[];
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
  const mods = createDev2Modules({
    connection: h.connection, auth: actorFromHeader,
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
    h, mods, app, events, get, send,
    async reset() {
      await h.reset();
      await mods.catalog.store.ensureIndexes();
      await mods.offerings.store.ensureIndexes();
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
