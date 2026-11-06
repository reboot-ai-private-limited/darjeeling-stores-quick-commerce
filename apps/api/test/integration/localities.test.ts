import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
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
let zone1City1Id: string;
let zone2City2Id: string;

const adminHeaders = {
  "X-Test-Actor": "zoneManager",
  "X-CSRF-Token": "1",
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("localities_test")).asPromise();

  geoModule = createGeographyModule({
    connection: db,
    resolveActor: (req) => {
      const actorKey = req.get("X-Test-Actor");
      if (!actorKey) return null;
      if (actorKey === "zoneManager") return SYNTHETIC_ACTORS.zoneManager;
      if (actorKey === "superAdmin") return SYNTHETIC_ACTORS.superAdmin;
      if (actorKey === "scopedStaff")
        return createSyntheticStaffActor(["zones:manage"], {
          all: false,
          warehouseIds: ["672b123456789abcdef01401"],
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
  await db.collection("localities").deleteMany({});
  await db.collection("audit_log").deleteMany({});

  // Seed two cities
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

  // Seed two zones (one in each city)
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
      name: "Kalimpong Main Zone",
      polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000004"
  );
  zone1City1Id = z1.id;
  zone2City2Id = z2.id;
});

describe("F03-06: Locality administration and public picker", () => {
  it("public GET /localities requires cityId and filters active localities under active city with deterministic sorting", async () => {
    // 400 when cityId query param is missing or malformed
    expect((await request(app).get("/api/v1/localities")).status).toBe(400);
    expect(
      (await request(app).get("/api/v1/localities?cityId=not-a-hex-id")).status
    ).toBe(400);

    // 404 when city does not exist
    expect(
      (
        await request(app).get(
          "/api/v1/localities?cityId=672b123456789abcdef01999"
        )
      ).status
    ).toBe(404);

    // Create localities in City 1 with sortOrder
    const l1 = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Observatory Hill",
        location: { lat: 27.0435, lng: 88.2655 },
        sortOrder: 2,
      });

    const l2 = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Chowrasta",
        location: { lat: 27.0412, lng: 88.263 },
        zoneId: zone1City1Id,
        travelMinutes: 8,
        sortOrder: 1,
      });

    const l3 = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Birch Hill",
        location: { lat: 27.051, lng: 88.258 },
        sortOrder: 1,
      });

    const lInactive = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Old Closed Locality",
        location: { lat: 27.04, lng: 88.26 },
        sortOrder: 0,
      });

    // Mark lInactive as inactive
    await request(app)
      .put(`/api/v1/admin/localities/${lInactive.body.data.id}`)
      .set(adminHeaders)
      .send({ isActive: false });

    // Public request
    const pubRes = await request(app).get(
      `/api/v1/localities?cityId=${city1Id}`
    );
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.meta.count).toBe(3);

    // Deterministic sort: sortOrder ascending (1, 1, 2), then name ascending ("Birch Hill", "Chowrasta", "Observatory Hill")
    expect(pubRes.body.data.map((l: { name: string }) => l.name)).toEqual([
      "Birch Hill",
      "Chowrasta",
      "Observatory Hill",
    ]);

    expect(pubRes.body.data[1]).toMatchObject({
      id: l2.body.data.id,
      cityId: city1Id,
      name: "Chowrasta",
      location: { lat: 27.0412, lng: 88.263 },
      zoneId: zone1City1Id,
      travelMinutes: 8,
      sortOrder: 1,
      isActive: true,
    });

    // Inactive city returns 404
    await request(app)
      .put(`/api/v1/admin/cities/${city1Id}`)
      .set(adminHeaders)
      .send({ isActive: false });

    expect(
      (await request(app).get(`/api/v1/localities?cityId=${city1Id}`)).status
    ).toBe(404);
  });

  it("admin GET /admin/localities lists all localities and filters by cityId", async () => {
    await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Mall Road",
        location: { lat: 27.041, lng: 88.266 },
        sortOrder: 1,
      });

    const l2 = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city2Id,
        name: "Dambar Chowk",
        location: { lat: 27.065, lng: 88.471 },
        sortOrder: 1,
      });

    // Mark l2 inactive
    await request(app)
      .put(`/api/v1/admin/localities/${l2.body.data.id}`)
      .set(adminHeaders)
      .send({ isActive: false });

    // All localities
    const allRes = await request(app)
      .get("/api/v1/admin/localities")
      .set(adminHeaders);
    expect(allRes.status).toBe(200);
    expect(allRes.body.meta.count).toBe(2);

    // Filter by cityId
    const filteredRes = await request(app)
      .get(`/api/v1/admin/localities?cityId=${city2Id}`)
      .set(adminHeaders);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.meta.count).toBe(1);
    expect(filteredRes.body.data[0]).toMatchObject({
      name: "Dambar Chowk",
      isActive: false,
    });
  });

  it("POST /admin/localities creates a locality and writes audit event", async () => {
    const res = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Chowrasta",
        location: { lat: 27.0412, lng: 88.263 },
        zoneId: zone1City1Id,
        travelMinutes: 8,
        sortOrder: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      cityId: city1Id,
      name: "Chowrasta",
      location: { lat: 27.0412, lng: 88.263 },
      zoneId: zone1City1Id,
      travelMinutes: 8,
      sortOrder: 1,
      isActive: true,
    });
    expect(res.body.data.id).toMatch(/^[a-fA-F0-9]{24}$/);

    const audit = await db.collection("audit_log").findOne({
      entityType: "locality",
      action: "locality.create",
      entityId: res.body.data.id,
    });
    expect(audit).not.toBeNull();
    expect(audit?.localityChange?.before).toBeNull();
    expect(audit?.localityChange?.after).toMatchObject({
      id: res.body.data.id,
      name: "Chowrasta",
      zoneId: zone1City1Id,
      travelMinutes: 8,
    });
  });

  it("POST /admin/localities rejects missing references and cross-city zone mismatch", async () => {
    // Missing city
    const missingCity = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: "672b123456789abcdef01999",
        name: "Test",
        location: { lat: 27.04, lng: 88.26 },
      });
    expect(missingCity.status).toBe(404);

    // Missing zone
    const missingZone = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Test",
        location: { lat: 27.04, lng: 88.26 },
        zoneId: "672b123456789abcdef01999",
      });
    expect(missingZone.status).toBe(404);

    // Zone belongs to Kalimpong (city2), but locality is in Darjeeling (city1)
    const mismatch = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Cross City Locality",
        location: { lat: 27.04, lng: 88.26 },
        zoneId: zone2City2Id,
      });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("CONFLICT");
  });

  it("POST /admin/localities rejects duplicate name in same city but allows across cities", async () => {
    await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Market Square",
        location: { lat: 27.04, lng: 88.26 },
      });

    const dup = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "  Market Square  ",
        location: { lat: 27.045, lng: 88.265 },
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CONFLICT");

    // Same name in Kalimpong is allowed
    const diffCity = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city2Id,
        name: "Market Square",
        location: { lat: 27.065, lng: 88.471 },
      });
    expect(diffCity.status).toBe(201);
  });

  it("POST /admin/localities validates coordinates, travelMinutes, and sortOrder", async () => {
    // Latitude out of range
    expect(
      (
        await request(app)
          .post("/api/v1/admin/localities")
          .set(adminHeaders)
          .send({
            cityId: city1Id,
            name: "L",
            location: { lat: 95.0, lng: 88.26 },
          })
      ).status
    ).toBe(400);

    // Longitude out of range
    expect(
      (
        await request(app)
          .post("/api/v1/admin/localities")
          .set(adminHeaders)
          .send({
            cityId: city1Id,
            name: "L",
            location: { lat: 27.04, lng: 190.0 },
          })
      ).status
    ).toBe(400);

    // Negative travelMinutes
    expect(
      (
        await request(app)
          .post("/api/v1/admin/localities")
          .set(adminHeaders)
          .send({
            cityId: city1Id,
            name: "L",
            location: { lat: 27.04, lng: 88.26 },
            travelMinutes: -5,
          })
      ).status
    ).toBe(400);

    // Negative sortOrder
    expect(
      (
        await request(app)
          .post("/api/v1/admin/localities")
          .set(adminHeaders)
          .send({
            cityId: city1Id,
            name: "L",
            location: { lat: 27.04, lng: 88.26 },
            sortOrder: -1,
          })
      ).status
    ).toBe(400);
  });

  it("PUT /admin/localities/:id updates fields and supports clearing zoneId and travelMinutes", async () => {
    const created = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Original Locality",
        location: { lat: 27.04, lng: 88.26 },
        zoneId: zone1City1Id,
        travelMinutes: 10,
        sortOrder: 2,
      });
    const locId = created.body.data.id;

    // Update name, location, sortOrder, isActive
    const updated = await request(app)
      .put(`/api/v1/admin/localities/${locId}`)
      .set(adminHeaders)
      .send({
        name: "Renamed Locality",
        location: { lat: 27.045, lng: 88.265 },
        sortOrder: 5,
        isActive: false,
      });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id: locId,
      cityId: city1Id,
      name: "Renamed Locality",
      location: { lat: 27.045, lng: 88.265 },
      zoneId: zone1City1Id,
      travelMinutes: 10,
      sortOrder: 5,
      isActive: false,
    });

    // Clear zoneId and travelMinutes with explicit null
    const cleared = await request(app)
      .put(`/api/v1/admin/localities/${locId}`)
      .set(adminHeaders)
      .send({
        zoneId: null,
        travelMinutes: null,
      });

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.zoneId).toBeNull();
    expect(cleared.body.data.travelMinutes).toBeNull();

    // Verify audit log
    const audit = await db.collection("audit_log").findOne(
      {
        entityType: "locality",
        action: "locality.update",
        entityId: locId,
      },
      { sort: { _id: -1 } }
    );
    expect(audit).not.toBeNull();
    expect(audit?.localityChange?.after).toMatchObject({
      id: locId,
      zoneId: null,
      travelMinutes: null,
    });
  });

  it("PUT /admin/localities/:id preserves cross-city integrity when moving city", async () => {
    // Locality in City 1 with Zone 1 (belongs to City 1)
    const created = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Mobile Locality",
        location: { lat: 27.04, lng: 88.26 },
        zoneId: zone1City1Id,
      });
    const locId = created.body.data.id;

    // Attempt to move to City 2 while keeping Zone 1 (which belongs to City 1) -> 409 CONFLICT
    const invalidMove = await request(app)
      .put(`/api/v1/admin/localities/${locId}`)
      .set(adminHeaders)
      .send({ cityId: city2Id });

    expect(invalidMove.status).toBe(409);
    expect(invalidMove.body.error.code).toBe("CONFLICT");

    // Move to City 2 with Zone 2 (which belongs to City 2) -> 200 OK
    const validMove = await request(app)
      .put(`/api/v1/admin/localities/${locId}`)
      .set(adminHeaders)
      .send({
        cityId: city2Id,
        zoneId: zone2City2Id,
      });

    expect(validMove.status).toBe(200);
    expect(validMove.body.data.cityId).toBe(city2Id);
    expect(validMove.body.data.zoneId).toBe(zone2City2Id);
  });

  it("PUT /admin/localities/:id rejects duplicate name in target city", async () => {
    await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Target Name",
        location: { lat: 27.04, lng: 88.26 },
      });

    const l2 = await request(app)
      .post("/api/v1/admin/localities")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Source Name",
        location: { lat: 27.045, lng: 88.265 },
      });

    const res = await request(app)
      .put(`/api/v1/admin/localities/${l2.body.data.id}`)
      .set(adminHeaders)
      .send({ name: "Target Name" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("enforces staff authority and CSRF on locality routes", async () => {
    // 401 unauthenticated
    expect((await request(app).get("/api/v1/admin/localities")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/admin/localities")
          .send({ cityId: city1Id, name: "L", location: { lat: 27.04, lng: 88.26 } })
      ).status
    ).toBe(401);

    // 403 unauthorized
    expect(
      (
        await request(app)
          .get("/api/v1/admin/localities")
          .set("X-Test-Actor", "unauthorized")
      ).status
    ).toBe(403);

    // 403 scoped staff
    expect(
      (
        await request(app)
          .get("/api/v1/admin/localities")
          .set("X-Test-Actor", "scopedStaff")
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/v1/admin/localities")
          .set("X-Test-Actor", "scopedStaff")
          .send({ cityId: city1Id, name: "L", location: { lat: 27.04, lng: 88.26 } })
      ).status
    ).toBe(403);

    // CSRF check
    const noCsrf = await request(app)
      .post("/api/v1/admin/localities")
      .set({
        "X-Test-Actor": "zoneManager",
        Origin: "http://localhost:3000",
      })
      .send({ cityId: city1Id, name: "L", location: { lat: 27.04, lng: 88.26 } });
    expect(noCsrf.status).toBe(403);
  });

  it("rolls back locality creation when audit write fails", async () => {
    try {
      await db.createCollection("audit_log");
    } catch {}
    await db.db!.command({
      collMod: "audit_log",
      validator: { required_audit_test_field: { $exists: true } },
      validationLevel: "strict",
    });

    try {
      const response = await request(app)
        .post("/api/v1/admin/localities")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Rollback Locality",
          location: { lat: 27.04, lng: 88.26 },
        });

      expect(response.status).toBe(500);
      expect(
        await db.collection("localities").countDocuments({ name: "Rollback Locality" })
      ).toBe(0);
    } finally {
      await db.db!.command({ collMod: "audit_log", validator: {} });
    }
  });
});
