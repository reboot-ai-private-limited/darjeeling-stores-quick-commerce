import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createGeographyModule } from "../../src/modules/geography/geography.public.js";
import {
  createSyntheticStaffActor,
  SYNTHETIC_ACTORS,
  SYNTHETIC_POLYGONS,
} from "./support/geography-fixture.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let geoModule: ReturnType<typeof createGeographyModule>;

let city1Id: string;
let city2Id: string;
let zone1Id: string;
let zone2Id: string;
let wh1Id: string;
let wh2Id: string;
let wh3Id: string;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("warehouses_read_test")).asPromise();

  geoModule = createGeographyModule({
    connection: db,
    resolveActor: (req) => {
      const actorKey = req.get("X-Test-Actor");
      if (!actorKey) return null;
      if (actorKey === "allScope") return SYNTHETIC_ACTORS.warehouseViewerAll;
      if (actorKey === "scopedWh1") return SYNTHETIC_ACTORS.warehouseViewerScoped(wh1Id);
      if (actorKey === "scopedWh2") return SYNTHETIC_ACTORS.warehouseViewerScoped(wh2Id);
      if (actorKey === "emptyScope")
        return createSyntheticStaffActor(["warehouses:view"], {
          all: false,
          warehouseIds: [],
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

beforeEach(async () => {
  await db.collection("cities").deleteMany({});
  await db.collection("zones").deleteMany({});
  await db.collection("warehouses").deleteMany({});
  await db.collection("audit_log").deleteMany({});

  // Seed City 1 and City 2
  const c1 = await geoModule.cityService.createCity(
    { name: "Darjeeling", state: "West Bengal" },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000001"
  );
  const c2 = await geoModule.cityService.createCity(
    { name: "Kalimpong", state: "West Bengal" },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000002"
  );
  city1Id = c1.id;
  city2Id = c2.id;

  // Seed Zone 1 in City 1 and Zone 2 in City 2
  const z1 = await geoModule.zoneService.createZone(
    {
      cityId: city1Id,
      name: "Chowrasta Zone",
      polygon: SYNTHETIC_POLYGONS.zoneA,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000003"
  );
  const z2 = await geoModule.zoneService.createZone(
    {
      cityId: city2Id,
      name: "Kalimpong Zone",
      polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000004"
  );
  zone1Id = z1.id;
  zone2Id = z2.id;

  // Seed 3 Warehouses directly in mongo store
  wh1Id = new Types.ObjectId().toHexString();
  wh2Id = new Types.ObjectId().toHexString();
  wh3Id = new Types.ObjectId().toHexString();

  const now = new Date();
  await db.collection("warehouses").insertMany([
    {
      _id: new Types.ObjectId(wh1Id),
      zoneId: new Types.ObjectId(zone1Id),
      name: "Chowrasta Store",
      code: "CHOW-1",
      location: { type: "Point", coordinates: [88.2663, 27.041] },
      address: "Mall Road, Darjeeling",
      isEnabled: true,
      priority: 1,
      packMinutes: 5,
      riderArrivalMinutes: 5,
      defaultTravelMinutes: 10,
      punchInRadiusMeters: 150,
      pause: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new Types.ObjectId(wh2Id),
      zoneId: new Types.ObjectId(zone1Id),
      name: "Ghoom Depot",
      code: "GHOOM-1",
      location: { type: "Point", coordinates: [88.257, 27.012] },
      address: "Hill Cart Road, Ghoom",
      isEnabled: true,
      priority: 2,
      packMinutes: 5,
      riderArrivalMinutes: 5,
      defaultTravelMinutes: 15,
      punchInRadiusMeters: 150,
      pause: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new Types.ObjectId(wh3Id),
      zoneId: new Types.ObjectId(zone2Id),
      name: "Kalimpong Hub",
      code: "KAL-1",
      location: { type: "Point", coordinates: [88.471, 27.065] },
      address: "Dambar Chowk, Kalimpong",
      isEnabled: false,
      priority: 1,
      packMinutes: 5,
      riderArrivalMinutes: 5,
      defaultTravelMinutes: 12,
      punchInRadiusMeters: 150,
      pause: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

describe("F03-08: Scoped warehouse reads (list and detail)", () => {
  describe("GET /admin/warehouses (Scoped Listing)", () => {
    it("all-scope actor sees all warehouses ordered by priority and name", async () => {
      const res = await request(app)
        .get("/api/v1/admin/warehouses")
        .set("X-Test-Actor", "allScope");

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.meta.count).toBe(3);
      expect(res.body.data.map((w: { id: string }) => w.id)).toEqual([wh1Id, wh3Id, wh2Id]);
      expect(res.body.data[0]).toMatchObject({
        id: wh1Id,
        zoneId: zone1Id,
        name: "Chowrasta Store",
        code: "CHOW-1",
        location: { lat: 27.041, lng: 88.2663 },
        address: "Mall Road, Darjeeling",
        isEnabled: true,
        priority: 1,
      });
    });

    it("scoped actor only sees assigned warehouse", async () => {
      const res1 = await request(app)
        .get("/api/v1/admin/warehouses")
        .set("X-Test-Actor", "scopedWh1");

      expect(res1.status).toBe(200);
      expect(res1.body.meta.count).toBe(1);
      expect(res1.body.data[0].id).toBe(wh1Id);

      const res2 = await request(app)
        .get("/api/v1/admin/warehouses")
        .set("X-Test-Actor", "scopedWh2");

      expect(res2.status).toBe(200);
      expect(res2.body.meta.count).toBe(1);
      expect(res2.body.data[0].id).toBe(wh2Id);
    });

    it("actor with empty warehouse scope sees zero warehouses", async () => {
      const res = await request(app)
        .get("/api/v1/admin/warehouses")
        .set("X-Test-Actor", "emptyScope");

      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it("intersects actor scope with requested query filters", async () => {
      // All-scope actor with zoneId filter
      const allZone1 = await request(app)
        .get(`/api/v1/admin/warehouses?zoneId=${zone1Id}`)
        .set("X-Test-Actor", "allScope");
      expect(allZone1.body.meta.count).toBe(2);

      // Scoped actor with matching zoneId filter
      const scopedMatch = await request(app)
        .get(`/api/v1/admin/warehouses?zoneId=${zone1Id}`)
        .set("X-Test-Actor", "scopedWh1");
      expect(scopedMatch.body.meta.count).toBe(1);
      expect(scopedMatch.body.data[0].id).toBe(wh1Id);

      // Scoped actor with non-matching zoneId filter
      const scopedMismatch = await request(app)
        .get(`/api/v1/admin/warehouses?zoneId=${zone2Id}`)
        .set("X-Test-Actor", "scopedWh1");
      expect(scopedMismatch.body.meta.count).toBe(0);

      // isEnabled filter
      const enabledRes = await request(app)
        .get("/api/v1/admin/warehouses?isEnabled=false")
        .set("X-Test-Actor", "allScope");
      expect(enabledRes.body.meta.count).toBe(1);
      expect(enabledRes.body.data[0].id).toBe(wh3Id);
    });

    it("invalid filter cannot broaden results", async () => {
      const res = await request(app)
        .get("/api/v1/admin/warehouses?zoneId=non-hex-id")
        .set("X-Test-Actor", "scopedWh1");

      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(0);
    });
  });

  describe("GET /admin/warehouses/:id (Scoped Detail)", () => {
    it("all-scope actor can view any warehouse", async () => {
      for (const id of [wh1Id, wh2Id, wh3Id]) {
        const res = await request(app)
          .get(`/api/v1/admin/warehouses/${id}`)
          .set("X-Test-Actor", "allScope");
        expect(res.status).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.data.id).toBe(id);
      }
    });

    it("scoped actor can view assigned warehouse", async () => {
      const res = await request(app)
        .get(`/api/v1/admin/warehouses/${wh1Id}`)
        .set("X-Test-Actor", "scopedWh1");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(wh1Id);
    });

    it("scoped actor viewing foreign warehouse returns 403 FORBIDDEN", async () => {
      const res1 = await request(app)
        .get(`/api/v1/admin/warehouses/${wh2Id}`)
        .set("X-Test-Actor", "scopedWh1");

      expect(res1.status).toBe(403);
      expect(res1.body.error.code).toBe("FORBIDDEN");

      const res2 = await request(app)
        .get(`/api/v1/admin/warehouses/${wh3Id}`)
        .set("X-Test-Actor", "scopedWh1");

      expect(res2.status).toBe(403);
      expect(res2.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 404 for unknown or malformed warehouse ID", async () => {
      expect(
        (
          await request(app)
            .get("/api/v1/admin/warehouses/non-hex-id")
            .set("X-Test-Actor", "allScope")
        ).status
      ).toBe(404);

      expect(
        (
          await request(app)
            .get("/api/v1/admin/warehouses/672b123456789abcdef01999")
            .set("X-Test-Actor", "allScope")
        ).status
      ).toBe(404);

      // Unknown ID returns 404 for scoped actor as well (not 403)
      expect(
        (
          await request(app)
            .get("/api/v1/admin/warehouses/672b123456789abcdef01999")
            .set("X-Test-Actor", "scopedWh1")
        ).status
      ).toBe(404);
    });

    it("enforces authentication and warehouses:view permission", async () => {
      // 401 unauthenticated
      expect((await request(app).get("/api/v1/admin/warehouses")).status).toBe(401);
      expect((await request(app).get(`/api/v1/admin/warehouses/${wh1Id}`)).status).toBe(401);

      // 403 unauthorized staff (without warehouses:view)
      expect(
        (await request(app).get("/api/v1/admin/warehouses").set("X-Test-Actor", "unauthorized")).status
      ).toBe(403);
      expect(
        (await request(app).get(`/api/v1/admin/warehouses/${wh1Id}`).set("X-Test-Actor", "unauthorized")).status
      ).toBe(403);
    });
  });
});
