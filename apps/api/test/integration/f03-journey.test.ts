import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createGeographyModule } from "../../src/modules/geography/geography.public.js";
import {
  createSyntheticStaffActor,
  SYNTHETIC_ACTORS,
  SYNTHETIC_POINTS,
  SYNTHETIC_POLYGONS,
} from "./support/geography-fixture.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let geoModule: ReturnType<typeof createGeographyModule>;

let targetWarehouseId = "";

const adminHeaders = {
  "X-Test-Actor": "superAdmin",
  "X-CSRF-Token": "1",
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("f03_journey_test")).asPromise();

  geoModule = createGeographyModule({
    connection: db,
    resolveActor: (req) => {
      const actorKey = req.get("X-Test-Actor");
      if (!actorKey) return null;
      if (actorKey === "superAdmin") return SYNTHETIC_ACTORS.superAdmin;
      if (actorKey === "opsManager") return SYNTHETIC_ACTORS.opsManager;
      if (actorKey === "scopedStaff")
        return createSyntheticStaffActor(["warehouses:view", "warehouses:manage"], {
          all: false,
          warehouseIds: [targetWarehouseId],
        });
      if (actorKey === "foreignScopedStaff")
        return createSyntheticStaffActor(["warehouses:view", "warehouses:manage"], {
          all: false,
          warehouseIds: ["672b123456789abcdef01499"],
        });
      if (actorKey === "unauthorized") return SYNTHETIC_ACTORS.unauthorizedStaff;
      return null;
    },
    validateCsrf: (req) => req.get("X-CSRF-Token") === "1",
  });

  await geoModule.ensureIndexes();
  app = createApp({ additionalRoutes: geoModule.routes });
}, 120000);

afterAll(async () => {
  await db?.close();
  await mongo?.stop();
});

describe("F03-15: Complete End-to-End Geography & Warehouse Lifecycle Journey", () => {
  let cityId: string;
  let zoneId: string;
  let localityId: string;
  let warehouseId: string;

  it("Step 1: Admin creates city, zone, locality, and warehouse", async () => {
    // 1. Create City
    const cityRes = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Darjeeling", state: "West Bengal" });
    expect(cityRes.status).toBe(201);
    cityId = cityRes.body.data.id;
    expect(cityRes.body.data).toMatchObject({
      name: "Darjeeling",
      state: "West Bengal",
      isActive: true,
    });

    // 2. Create Zone with valid polygon
    const zoneRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId,
        name: "Chowrasta Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
        isEnabled: true,
      });
    expect(zoneRes.status).toBe(201);
    zoneId = zoneRes.body.data.id;
    expect(zoneRes.body.data).toMatchObject({
      cityId,
      name: "Chowrasta Zone",
      isEnabled: true,
    });

    // 3. Create Locality linked to Zone
    const locRes = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId,
        name: "Chowrasta Mall",
        location: { lat: 27.0412, lng: 88.263 },
        zoneId,
        travelMinutes: 8,
        sortOrder: 1,
      });
    expect(locRes.status).toBe(201);
    localityId = locRes.body.data.id;
    expect(locRes.body.data).toMatchObject({
      cityId,
      name: "Chowrasta Mall",
      zoneId,
      travelMinutes: 8,
    });

    // 4. Create Warehouse inside Zone
    const whRes = await request(app)
      .post("/api/v1/admin/warehouses")
      .set(adminHeaders)
      .send({
        zoneId,
        name: "Chowrasta Fulfillment Store",
        code: "CHOW-1",
        location: { lat: 27.041, lng: 88.2663 },
        address: "Clock Tower, Mall Road, Darjeeling",
        priority: 1,
        packMinutes: 5,
        riderArrivalMinutes: 5,
        defaultTravelMinutes: 10,
        punchInRadiusMeters: 150,
      });
    expect(whRes.status).toBe(201);
    warehouseId = whRes.body.data.id;
    targetWarehouseId = warehouseId;
    expect(whRes.body.data).toMatchObject({
      zoneId,
      name: "Chowrasta Fulfillment Store",
      code: "CHOW-1",
      isEnabled: true,
    });
  });

  it("Step 2: Customer resolves location by point coordinates and by localityId", async () => {
    // Resolve by coordinates inside Zone A
    const pointRes = await request(app)
      .post("/api/v1/location/resolve")
      .send({
        lat: SYNTHETIC_POINTS.insideZoneA.lat,
        lng: SYNTHETIC_POINTS.insideZoneA.lng,
      });
    expect(pointRes.status).toBe(200);
    expect(pointRes.body.data).toEqual({
      deliverable: true,
      zone: {
        id: zoneId,
        name: "Chowrasta Zone",
        cityId,
      },
    });

    // Resolve by localityId
    const locResolveRes = await request(app)
      .post("/api/v1/zones/check") // Using alias endpoint
      .send({ localityId });
    expect(locResolveRes.status).toBe(200);
    expect(locResolveRes.body.data).toEqual({
      deliverable: true,
      zone: {
        id: zoneId,
        name: "Chowrasta Zone",
        cityId,
      },
    });

    // Point outside service area
    const outsideRes = await request(app)
      .post("/api/v1/location/resolve")
      .send({
        lat: SYNTHETIC_POINTS.outsideAll.lat,
        lng: SYNTHETIC_POINTS.outsideAll.lng,
      });
    expect(outsideRes.status).toBe(200);
    expect(outsideRes.body.data).toEqual({
      deliverable: false,
    });
  });

  it("Step 3: Scoped staff access enforcement", async () => {
    // Foreign scoped staff attempts to access warehouse -> 403 FORBIDDEN
    const foreignRes = await request(app)
      .get(`/api/v1/admin/warehouses/${warehouseId}`)
      .set("X-Test-Actor", "foreignScopedStaff");
    expect(foreignRes.status).toBe(403);
    expect(foreignRes.body.error.code).toBe("FORBIDDEN");

    // Foreign scoped staff listing warehouses -> sees 0 warehouses
    const foreignListRes = await request(app)
      .get("/api/v1/admin/warehouses")
      .set("X-Test-Actor", "foreignScopedStaff");
    expect(foreignListRes.status).toBe(200);
    expect(foreignListRes.body.meta.count).toBe(0);

    // Permitted scoped staff accesses warehouse -> 200 OK
    const scopedRes = await request(app)
      .get(`/api/v1/admin/warehouses/${warehouseId}`)
      .set("X-Test-Actor", "scopedStaff");
    expect(scopedRes.status).toBe(200);
    expect(scopedRes.body.data.id).toBe(warehouseId);
  });

  it("Step 4: Zone pause immediately updates customer resolution", async () => {
    // Ops manager pauses Chowrasta Zone
    const pauseRes = await request(app)
      .put(`/api/v1/admin/zones/${zoneId}`)
      .set({ "X-Test-Actor": "opsManager", "X-CSRF-Token": "1" })
      .send({
        pause: {
          active: true,
          message: "Landslide on Hill Cart Road",
          until: "2099-01-01T00:00:00.000Z",
        },
      });
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.data.pause.active).toBe(true);

    // Customer resolution now reflects paused: true, deliverable: false
    const resolveRes = await request(app)
      .post("/api/v1/location/resolve")
      .send({
        lat: SYNTHETIC_POINTS.insideZoneA.lat,
        lng: SYNTHETIC_POINTS.insideZoneA.lng,
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.data).toEqual({
      deliverable: false,
      paused: true,
      zone: {
        id: zoneId,
        name: "Chowrasta Zone",
        cityId,
      },
    });

    // Resume zone
    await request(app)
      .put(`/api/v1/admin/zones/${zoneId}`)
      .set({ "X-Test-Actor": "opsManager", "X-CSRF-Token": "1" })
      .send({ pause: null });
  });

  it("Step 5: Enforces overlap and guarded disable invariants", async () => {
    // Overlapping zone creation rejected
    const overlapRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId,
        name: "Conflicting Zone",
        polygon: SYNTHETIC_POLYGONS.overlappingA,
        isEnabled: true,
      });
    expect(overlapRes.status).toBe(409);
    expect(overlapRes.body.error.code).toBe("ZONE_OVERLAP");

    // Disabling warehouse fails safely when order dependencies are unavailable
    const disableRes = await request(app)
      .put(`/api/v1/admin/warehouses/${warehouseId}`)
      .set(adminHeaders)
      .send({ isEnabled: false });
    expect(disableRes.status).toBe(409);
    expect(disableRes.body.error.code).toBe("CONFLICT");
    expect(disableRes.body.error.details).toEqual({
      reason: "dependency_check_unavailable",
    });

    // Warehouse remains enabled
    const whCheck = await request(app)
      .get(`/api/v1/admin/warehouses/${warehouseId}`)
      .set(adminHeaders);
    expect(whCheck.body.data.isEnabled).toBe(true);
  });
});
