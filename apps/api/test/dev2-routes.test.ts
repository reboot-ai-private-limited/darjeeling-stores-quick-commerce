import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDev2Modules } from "../src/composition/dev2.js";
import { assertUniqueRoutes } from "../src/platform/routes.js";

const docsDir = path.resolve(import.meta.dirname, "../../../docs/api");
/** `GET /admin/x/:id` and `GET /admin/x/:other` are the same route. */
const normalise = (method: string, p: string) => `${method.toUpperCase()} ${p.replace(/:[A-Za-z]+/g, ":p")}`;

function documented(file: string): string[] {
  const text = fs.readFileSync(path.join(docsDir, file), "utf8").replace(/\r\n/g, "\n");
  const rows = [...text.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)` \|/gm)];
  return rows.map(([, method, route]) => normalise(method!, route!));
}

describe("Dev 2 routes (catalog, stock, import and Notify Me)", () => {
  const { routes } = createDev2Modules();
  const registered = routes.map(r => normalise(r.method, r.path));

  it("registers every endpoint documented for F04 master catalog", () => {
    const expected = documented("F04-master-catalog.md");
    expect(expected).toHaveLength(24);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F05 warehouse stock and pricing", () => {
    const expected = documented("F05-warehouse-stock-and-pricing.md");
    expect(expected).toHaveLength(10);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F06 product import and the admin tree", () => {
    const expected = documented("F06-product-import-and-admin-tree.md");
    expect(expected).toHaveLength(3);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F07 Notify Me", () => {
    const expected = documented("F07-notify-me.md");
    expect(expected).toHaveLength(4);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F24 media storage", () => {
    const expected = documented("F24-media-storage.md");
    expect(expected).toHaveLength(7);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F23 notifications", () => {
    const expected = documented("F23-notifications.md");
    expect(expected).toHaveLength(7);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F08 discovery, apart from location resolve which belongs to F03", () => {
    const expected = documented("F08-discovery-and-location.md");
    expect(expected).toHaveLength(10);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F09 addresses", () => {
    const expected = documented("F09-addresses.md");
    expect(expected).toHaveLength(6);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F18 dispatch and assignment", () => {
    const expected = documented("F18-dispatch-and-assignment.md");
    expect(expected).toHaveLength(15);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F19 the rider app", () => {
    const expected = documented("F19-rider-app.md");
    expect(expected).toHaveLength(28);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F20 ETA and live tracking", () => {
    const expected = documented("F20-eta-and-live-tracking.md");
    expect(expected).toHaveLength(4);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F21 offline and low network", () => {
    const expected = documented("F21-offline-and-low-network.md");
    expect(expected).toHaveLength(4);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F22 rider cash and settlement", () => {
    const expected = documented("F22-rider-cash-and-settlement.md");
    expect(expected).toHaveLength(13);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F11 delivery fees and surcharges", () => {
    const expected = documented("F11-delivery-fees-and-surcharges.md");
    expect(expected).toHaveLength(7);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F12 coupons and offers", () => {
    const expected = documented("F12-coupons-and-offers.md");
    expect(expected).toHaveLength(11);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F10 cart and quote", () => {
    const expected = documented("F10-cart-and-quote.md");
    expect(expected).toHaveLength(7);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F13 order placement", () => {
    const expected = documented("F13-order-placement-and-split-orders.md");
    expect(expected).toHaveLength(5);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F14 order lifecycle", () => {
    const expected = documented("F14-order-lifecycle-and-packing.md");
    expect(expected).toHaveLength(13);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F17 hours, pre-orders and ops mode", () => {
    const expected = documented("F17-hours-preorders-and-ops-mode.md");
    expect(expected).toHaveLength(8);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F16 cancellations and refunds", () => {
    const expected = documented("F16-cancellations-and-refunds.md");
    expect(expected).toHaveLength(11);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers every endpoint documented for F15 payments", () => {
    const expected = documented("F15-payments.md");
    expect(expected).toHaveLength(10);
    expect(expected.filter(e => !registered.includes(e))).toEqual([]);
  });

  it("registers nothing that the API docs do not describe", () => {
    const expected = new Set(
      ["F04-master-catalog.md", "F05-warehouse-stock-and-pricing.md", "F06-product-import-and-admin-tree.md", "F07-notify-me.md", "F08-discovery-and-location.md", "F09-addresses.md", "F10-cart-and-quote.md", "F11-delivery-fees-and-surcharges.md", "F12-coupons-and-offers.md", "F13-order-placement-and-split-orders.md", "F14-order-lifecycle-and-packing.md", "F15-payments.md", "F16-cancellations-and-refunds.md", "F17-hours-preorders-and-ops-mode.md", "F18-dispatch-and-assignment.md", "F19-rider-app.md", "F20-eta-and-live-tracking.md", "F21-offline-and-low-network.md", "F22-rider-cash-and-settlement.md", "F23-notifications.md", "F24-media-storage.md"].flatMap(documented),
    );
    expect(registered.filter(r => !expected.has(r))).toEqual([]);
    expect(registered).toHaveLength(206);
  });

  it("has no duplicate routes of its own and none that clash with the rest of the API", () => {
    expect(() => assertUniqueRoutes(routes)).not.toThrow();
    expect(() => createApp()).not.toThrow();
  });

  it("answers 401 with the documented error envelope for every route when nobody is logged in", async () => {
    const app = createApp();
    const open = ["/webhooks/", "/catalog/", "/store/", "/banners", "/waitlist", "/track/", "/tips/options"];
    for (const route of routes.filter(r => !open.some(prefix => r.path.startsWith(prefix)))) {
      const url = `/api/v1${route.path.replace(/:[A-Za-z]+/g, "a".repeat(24))}`;
      const res = await request(app)[route.method](url);
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
      expect(res.body.error).toMatchObject({ code: "UNAUTHORIZED", requestId: res.headers["x-request-id"] });
    }
  }, 30_000);

  it("lets guests browse the catalog: a call with no zone is a 400, never a 401", async () => {
    const app = createApp();
    for (const path of ["/catalog/home", "/catalog/categories", "/catalog/products", "/catalog/search?q=tomato", "/catalog/changes?since=0", "/store/status", "/banners", "/tips/options"]) {
      expect((await request(app).get(`/api/v1${path}`)).status, path).toBe(400);
    }
    expect((await request(app).post("/api/v1/waitlist").send({})).status).toBe(400);
  });

  it("leaves the provider's webhook calls open but refuses a set-up challenge or a signed call without the configured secrets", async () => {
    const app = createApp();
    expect((await request(app).get("/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1")).status).toBe(403);
    const post = await request(app).post("/api/v1/webhooks/whatsapp").send({ entry: [] });
    expect(post.status).toBe(200);
  });
});
