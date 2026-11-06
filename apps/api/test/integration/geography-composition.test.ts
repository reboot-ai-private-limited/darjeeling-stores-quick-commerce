import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createContainer } from "../../src/container.js";
import { assertUniqueRoutes, type Route } from "../../src/platform/routes.js";
import {
  createGeographyModule,
  warehouseDirectoryFrom,
} from "../../src/modules/geography/geography.public.js";
import { createSessionStore } from "../../src/modules/identity/infrastructure/sessions.js";
import { createAccessStore } from "../../src/modules/access/access.public.js";
import { createAdministrationRoutes } from "../../src/modules/identity/administration.public.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";
import {
  createStaffActorResolver,
  trustedCookieMutation,
} from "../../src/modules/identity/session.public.js";
import {
  SYNTHETIC_ACTORS,
  SYNTHETIC_POLYGONS,
} from "./support/geography-fixture.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
const jwtSecret = "a".repeat(64);

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("geography_comp_test")).asPromise();
  await createAccessStore(db).initialize();
}, 120000);

afterAll(async () => {
  await db?.close();
  await mongo?.stop();
});

describe("F03-11: Authoritative geography interface and composition", () => {
  it("mounts all 18 F03 routes exactly once with zero route collisions", async () => {
    const geo = createGeographyModule({
      connection: db,
      resolveActor: createStaffActorResolver(db, jwtSecret, undefined, true),
      validateCsrf: (req) => trustedCookieMutation(req, ["http://localhost:3000"]),
    });
    await geo.ensureIndexes();

    expect(geo.routes).toHaveLength(18);

    const f03ExpectedRoutes = [
      { method: "get", path: "/cities" },
      { method: "get", path: "/localities" },
      { method: "get", path: "/admin/cities" },
      { method: "post", path: "/admin/cities" },
      { method: "put", path: "/admin/cities/:id" },
      { method: "get", path: "/admin/localities" },
      { method: "post", path: "/admin/localities" },
      { method: "put", path: "/admin/localities/:id" },
      { method: "get", path: "/admin/zones" },
      { method: "post", path: "/admin/zones" },
      { method: "get", path: "/admin/zones/:id" },
      { method: "put", path: "/admin/zones/:id" },
      { method: "get", path: "/admin/warehouses" },
      { method: "post", path: "/admin/warehouses" },
      { method: "get", path: "/admin/warehouses/:id" },
      { method: "put", path: "/admin/warehouses/:id" },
      { method: "post", path: "/location/resolve" },
      { method: "post", path: "/zones/check" },
    ];

    for (const expected of f03ExpectedRoutes) {
      const match = geo.routes.find(
        (r) => r.method === expected.method && r.path === expected.path
      );
      expect(match, `Route ${expected.method.toUpperCase()} ${expected.path} must exist`).toBeDefined();
    }

    // Pass all routes through assertUniqueRoutes to ensure zero collisions
    expect(() => assertUniqueRoutes(geo.routes)).not.toThrow();

    // Verify container integration
    const { router } = createContainer(() => true, geo.routes);
    expect(router).toBeDefined();
  });

  it("warehouseDirectoryFrom satisfies offerings' WarehouseDirectory interface structurally", async () => {
    const geo = createGeographyModule({ connection: db });
    await geo.ensureIndexes();

    const dir = warehouseDirectoryFrom(geo);
    expect(typeof dir.get).toBe("function");

    // Non-existent ID returns null
    const nonExistent = await dir.get("672b123456789abcdef01999");
    expect(nonExistent).toBeNull();

    // Malformed ID returns null
    const malformed = await dir.get("invalid-id");
    expect(malformed).toBeNull();

    // Seed city and zone
    const city = await geo.cityService.createCity(
      { name: "Dir City", state: "State" },
      SYNTHETIC_ACTORS.zoneManager,
      "00000000-0000-4000-8000-000000000001"
    );
    const zone = await geo.zoneService.createZone(
      {
        cityId: city.id,
        name: "Dir Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      },
      SYNTHETIC_ACTORS.zoneManager,
      "00000000-0000-4000-8000-000000000002"
    );

    // Create warehouse
    const wh = await geo.warehouseService.createWarehouse(
      {
        zoneId: zone.id,
        name: "Directory Store",
        code: "DIR-1",
        location: { lat: 27.041, lng: 88.266 },
        address: "Directory Street",
      },
      SYNTHETIC_ACTORS.warehouseManagerAll,
      "00000000-0000-4000-8000-000000000003"
    );

    // Existing warehouse resolves correctly
    const resolved = await dir.get(wh.id);
    expect(resolved).toEqual({
      id: wh.id,
      zoneId: zone.id,
      isEnabled: true,
    });
  });

  it("public routes answer without authentication while protected routes enforce staff authentication", async () => {
    const geo = createGeographyModule({
      connection: db,
      resolveActor: () => null, // No logged in user
    });
    const appInstance = createApp({ additionalRoutes: geo.routes });

    // Public routes return 200
    const citiesRes = await request(appInstance).get("/api/v1/cities");
    expect(citiesRes.status).toBe(200);

    const checkRes = await request(appInstance)
      .post("/api/v1/zones/check")
      .send({ lat: 27.04, lng: 88.26 });
    expect(checkRes.status).toBe(200);

    // Protected admin routes return 401
    expect((await request(appInstance).get("/api/v1/admin/cities")).status).toBe(401);
    expect((await request(appInstance).get("/api/v1/admin/zones")).status).toBe(401);
    expect((await request(appInstance).get("/api/v1/admin/localities")).status).toBe(401);
    expect((await request(appInstance).get("/api/v1/admin/warehouses")).status).toBe(401);
  });

  it("mounts cleanly in mock development mode alongside dev-otp routes", async () => {
    const devOtpRoutes = await createDevOtpRoutes(
      db,
      "development",
      jwtSecret,
      ["http://localhost:3000"],
      false
    );
    const geo = createGeographyModule({
      connection: db,
      resolveActor: createStaffActorResolver(db, jwtSecret, undefined, true),
      validateCsrf: (req) => trustedCookieMutation(req, ["http://localhost:3000"]),
    });

    const combinedRoutes: Route[] = [...devOtpRoutes, ...geo.routes];

    // Assert zero duplicate routes across identity and geography
    expect(() => assertUniqueRoutes(combinedRoutes)).not.toThrow();

    const devApp = createApp({ additionalRoutes: combinedRoutes });

    // Verify public city list works on devApp
    const res = await request(devApp).get("/api/v1/cities");
    expect(res.status).toBe(200);
  });

  it("mounts cleanly in nonmock mode alongside administration routes", async () => {
    const adminRoutes = await createAdministrationRoutes(
      db,
      jwtSecret,
      ["http://localhost:3000"]
    );
    const geo = createGeographyModule({
      connection: db,
      resolveActor: createStaffActorResolver(db, jwtSecret, undefined, false),
      validateCsrf: (req) => trustedCookieMutation(req, ["http://localhost:3000"]),
    });

    const combinedRoutes: Route[] = [...adminRoutes, ...geo.routes];
    expect(() => assertUniqueRoutes(combinedRoutes)).not.toThrow();

    const prodApp = createApp({ additionalRoutes: combinedRoutes });
    const res = await request(prodApp).get("/api/v1/cities");
    expect(res.status).toBe(200);
  });
  it.each(["logout", "refresh"])("rejects an in-flight geography write after %s revokes its access session", async (action) => {
    await createDevOtpRoutes(db, "development", jwtSecret);
    const owner = await db.collection("users").findOne({ phone: "+919000000001" });
    const sessions = createSessionStore(db, jwtSecret);
    const pair = await sessions.issue(owner!._id);
    const resolveActor = createStaffActorResolver(db, jwtSecret, undefined, true);
    let reached!: () => void, release!: () => void;
    const authenticated = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const geo = createGeographyModule({ connection: db, resolveActor: async req => {
      const actor = await resolveActor(req);
      reached();
      await gate;
      return actor;
    } });
    await geo.ensureIndexes();
    const pending = request(createApp({ additionalRoutes: geo.routes })).post("/api/v1/admin/cities")
      .set("Authorization", `Bearer ${pair.accessToken}`).send({ name: `Revoked ${action} city`, state: "Test" }).then(response => response);
    try {
      await authenticated;
      if (action === "logout") await sessions.revoke(pair.accessToken);
      else expect(await sessions.rotate(pair.refreshToken)).not.toHaveProperty("error");
    } finally { release(); }
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await db.collection("cities").countDocuments({ name: `Revoked ${action} city` })).toBe(0);
    expect(await db.collection("audit_log").countDocuments({ requestId: response.headers["x-request-id"] })).toBe(0);
  });

});
