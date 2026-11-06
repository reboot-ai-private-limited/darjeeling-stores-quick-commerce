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

const adminHeaders = {
  "X-Test-Actor": "zoneManager",
  "X-CSRF-Token": "1",
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("zones_test")).asPromise();

  geoModule = createGeographyModule({
    connection: db,
    resolveActor: (req) => {
      const actorKey = req.get("X-Test-Actor");
      if (!actorKey) return null;
      if (actorKey === "zoneManager") return SYNTHETIC_ACTORS.zoneManager;
      if (actorKey === "superAdmin") return SYNTHETIC_ACTORS.superAdmin;
      if (actorKey === "opsManager") return SYNTHETIC_ACTORS.opsManager;
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
  await db.collection("geography_versions").deleteMany({});
  await db.collection("audit_log").deleteMany({});

  // Seed two test cities
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
});

describe("F03-04: Zone create, list, and detail with serialized overlap check", () => {
  it("creates a zone with valid polygon and returns safe DTO with audit log", async () => {
    const res = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Mall Road & Chowrasta",
        polygon: SYNTHETIC_POLYGONS.zoneA,
        isEnabled: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      cityId: city1Id,
      name: "Mall Road & Chowrasta",
      isEnabled: true,
      pause: null,
    });
    expect(res.body.data.id).toMatch(/^[a-fA-F0-9]{24}$/);
    expect(res.body.data.polygon).toEqual(SYNTHETIC_POLYGONS.zoneA);

    // Verify audit log write
    const audit = await db.collection("audit_log").findOne({
      entityType: "zone",
      action: "zone.create",
      entityId: res.body.data.id,
    });
    expect(audit).not.toBeNull();
    expect(audit?.zoneChange?.before).toBeNull();
    expect(audit?.zoneChange?.after).toMatchObject({
      id: res.body.data.id,
      cityId: city1Id,
      name: "Mall Road & Chowrasta",
      isEnabled: true,
      pause: null,
    });
  });

  it("lists all zones and filters by cityId", async () => {
    const z1 = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Zone 1 Darjeeling",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      });

    const z2 = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city2Id,
        name: "Zone 2 Kalimpong",
        polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
      });

    // All zones
    const allRes = await request(app)
      .get("/api/v1/admin/zones")
      .set(adminHeaders);
    expect(allRes.status).toBe(200);
    expect(allRes.body.meta.count).toBe(2);

    // Filter by cityId
    const filteredRes = await request(app)
      .get(`/api/v1/admin/zones?cityId=${city1Id}`)
      .set(adminHeaders);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.meta.count).toBe(1);
    expect(filteredRes.body.data[0].id).toBe(z1.body.data.id);
  });

  it("gets zone detail by ID and returns 404 for missing or malformed ID", async () => {
    const created = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Detail Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      });

    const getRes = await request(app)
      .get(`/api/v1/admin/zones/${created.body.data.id}`)
      .set(adminHeaders);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(created.body.data.id);

    // Malformed ID
    expect(
      (await request(app).get("/api/v1/admin/zones/non-hex-id").set(adminHeaders)).status
    ).toBe(404);

    // Unknown ID
    expect(
      (await request(app).get("/api/v1/admin/zones/672b123456789abcdef01999").set(adminHeaders)).status
    ).toBe(404);
  });

  it("rejects duplicate zone name within the same city", async () => {
    await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Chowrasta",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      });

    const dupRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "  Chowrasta  ",
        polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
      });

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe("CONFLICT");
  });

  it("allows same zone name in a different city", async () => {
    const res1 = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Central",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city2Id,
        name: "Central",
        polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
      });
    expect(res2.status).toBe(201);
  });

  it("rejects invalid polygon geometries", async () => {
    // Unclosed
    const unclosedRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Invalid Zone",
        polygon: SYNTHETIC_POLYGONS.unclosed,
      });
    expect(unclosedRes.status).toBe(400);
    expect(unclosedRes.body.error.code).toBe("INVALID_POLYGON");

    // Self-intersecting
    const selfIntRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Self Int Zone",
        polygon: SYNTHETIC_POLYGONS.selfIntersecting,
      });
    expect(selfIntRes.status).toBe(400);
    expect(selfIntRes.body.error.code).toBe("INVALID_POLYGON");
  });

  it("rejects positive-area overlap with existing enabled zone in the same city", async () => {
    const original = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Original Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
        isEnabled: true,
      });
    expect(original.status).toBe(201);

    const overlapRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Overlapping Zone",
        polygon: SYNTHETIC_POLYGONS.overlappingA,
        isEnabled: true,
      });

    expect(overlapRes.status).toBe(409);
    expect(overlapRes.body.error.code).toBe("ZONE_OVERLAP");
    expect(overlapRes.body.error.details).toMatchObject({
      zoneId: original.body.data.id,
      name: "Original Zone",
    });
  });

  it("rejects positive-area overlap across different cities", async () => {
    const original = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Darjeeling Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
        isEnabled: true,
      });
    expect(original.status).toBe(201);

    // Cross-city overlap in Kalimpong
    const crossCityRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city2Id,
        name: "Kalimpong Zone Overlap",
        polygon: SYNTHETIC_POLYGONS.overlappingA,
        isEnabled: true,
      });

    expect(crossCityRes.status).toBe(409);
    expect(crossCityRes.body.error.code).toBe("ZONE_OVERLAP");
  });

  it("rejects containment and identical polygon duplicates", async () => {
    await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Outer Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      });

    // Contained
    const containedRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Contained Zone",
        polygon: SYNTHETIC_POLYGONS.containedInA,
      });
    expect(containedRes.status).toBe(409);
    expect(containedRes.body.error.code).toBe("ZONE_OVERLAP");

    // Identical
    const identicalRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Identical Zone",
        polygon: SYNTHETIC_POLYGONS.identicalToA,
      });
    expect(identicalRes.status).toBe(409);
    expect(identicalRes.body.error.code).toBe("ZONE_OVERLAP");
  });

  it("allows adjacent zones sharing an edge or vertex", async () => {
    const z1 = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Zone A",
        polygon: SYNTHETIC_POLYGONS.zoneA,
      });
    expect(z1.status).toBe(201);

    // Adjacent Zone B sharing edge lng=88.275
    const z2 = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Zone B Adjacent",
        polygon: SYNTHETIC_POLYGONS.zoneBAdjacent,
      });
    expect(z2.status).toBe(201);
  });

  it("allows overlapping zones if isEnabled is false (draft mode)", async () => {
    await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Active Zone",
        polygon: SYNTHETIC_POLYGONS.zoneA,
        isEnabled: true,
      });

    // Overlapping draft (isEnabled: false)
    const draftRes = await request(app)
      .post("/api/v1/admin/zones")
      .set(adminHeaders)
      .send({
        cityId: city1Id,
        name: "Draft Overlapping Zone",
        polygon: SYNTHETIC_POLYGONS.overlappingA,
        isEnabled: false,
      });

    expect(draftRes.status).toBe(201);
    expect(draftRes.body.data.isEnabled).toBe(false);
  });

  it("handles concurrent creation of overlapping zones with exactly one winner", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post("/api/v1/admin/zones")
          .set(adminHeaders)
          .send({
            cityId: city1Id,
            name: `Concurrent Zone ${i}`,
            polygon: SYNTHETIC_POLYGONS.zoneA,
            isEnabled: true,
          })
      )
    );

    const created = attempts.filter((r) => r.status === 201);
    const conflicts = attempts.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    expect(await db.collection("zones").countDocuments({ isEnabled: true })).toBe(1);
  });

  it("enforces staff authority and CSRF", async () => {
    // 401 unauthenticated
    expect((await request(app).get("/api/v1/admin/zones")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/admin/zones")
          .send({ cityId: city1Id, name: "Z", polygon: SYNTHETIC_POLYGONS.zoneA })
      ).status
    ).toBe(401);

    // 403 unauthorized
    expect(
      (
        await request(app)
          .get("/api/v1/admin/zones")
          .set("X-Test-Actor", "unauthorized")
      ).status
    ).toBe(403);

    // 403 scoped staff
    expect(
      (
        await request(app)
          .get("/api/v1/admin/zones")
          .set("X-Test-Actor", "scopedStaff")
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/v1/admin/zones")
          .set("X-Test-Actor", "scopedStaff")
          .send({ cityId: city1Id, name: "Z", polygon: SYNTHETIC_POLYGONS.zoneA })
      ).status
    ).toBe(403);

    // CSRF check
    const noCsrf = await request(app)
      .post("/api/v1/admin/zones")
      .set({
        "X-Test-Actor": "zoneManager",
        Origin: "http://localhost:3000",
      })
      .send({ cityId: city1Id, name: "Z", polygon: SYNTHETIC_POLYGONS.zoneA });
    expect(noCsrf.status).toBe(403);
  });

  it("rolls back zone creation when audit write fails", async () => {
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
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Rollback Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });

      expect(response.status).toBe(500);
      expect(
        await db.collection("zones").countDocuments({ name: "Rollback Zone" })
      ).toBe(0);
    } finally {
      await db.db!.command({ collMod: "audit_log", validator: {} });
    }
  });

  describe("F03-05: Zone edit, re-enable and pause", () => {
    it("updates zone name and polygon with audit record", async () => {
      const created = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Original Name",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });

      const zoneId = created.body.data.id;

      const updateRes = await request(app)
        .put(`/api/v1/admin/zones/${zoneId}`)
        .set(adminHeaders)
        .send({
          name: "Updated Name",
          polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data).toMatchObject({
        id: zoneId,
        cityId: city1Id,
        name: "Updated Name",
        polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
        isEnabled: true,
      });

      // Audit check
      const audit = await db.collection("audit_log").findOne({
        entityType: "zone",
        action: "zone.update",
        entityId: zoneId,
      });
      expect(audit).not.toBeNull();
      expect(audit?.zoneChange?.before).toMatchObject({
        id: zoneId,
        name: "Original Name",
      });
      expect(audit?.zoneChange?.after).toMatchObject({
        id: zoneId,
        name: "Updated Name",
      });
    });

    it("PUT /admin/zones/:id returns 404 for unknown or malformed ID", async () => {
      expect(
        (
          await request(app)
            .put("/api/v1/admin/zones/non-hex-id")
            .set(adminHeaders)
            .send({ name: "Any Name" })
        ).status
      ).toBe(404);

      expect(
        (
          await request(app)
            .put("/api/v1/admin/zones/672b123456789abcdef01999")
            .set(adminHeaders)
            .send({ name: "Any Name" })
        ).status
      ).toBe(404);
    });

    it("PUT /admin/zones/:id validates body boundaries and immutable fields", async () => {
      const created = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Boundary Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });
      const zoneId = created.body.data.id;

      // Empty body
      expect(
        (
          await request(app)
            .put(`/api/v1/admin/zones/${zoneId}`)
            .set(adminHeaders)
            .send({})
        ).status
      ).toBe(400);

      // Attempting to change immutable cityId is strictly rejected by schema
      expect(
        (
          await request(app)
            .put(`/api/v1/admin/zones/${zoneId}`)
            .set(adminHeaders)
            .send({ cityId: city2Id })
        ).status
      ).toBe(400);

      // Invalid polygon
      expect(
        (
          await request(app)
            .put(`/api/v1/admin/zones/${zoneId}`)
            .set(adminHeaders)
            .send({ polygon: SYNTHETIC_POLYGONS.unclosed })
        ).status
      ).toBe(400);
    });

    it("PUT /admin/zones/:id rejects renaming to duplicate name in the same city", async () => {
      await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Zone 1",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });

      const z2 = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Zone 2",
          polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
        });

      const renameRes = await request(app)
        .put(`/api/v1/admin/zones/${z2.body.data.id}`)
        .set(adminHeaders)
        .send({ name: "  Zone 1  " });

      expect(renameRes.status).toBe(409);
      expect(renameRes.body.error.code).toBe("CONFLICT");
    });

    it("PUT /admin/zones/:id rejects updating polygon to overlap an existing enabled zone", async () => {
      await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Occupied Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });

      const z2 = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Separate Zone",
          polygon: SYNTHETIC_POLYGONS.zoneCDisjoint,
        });

      // Update z2's polygon so it overlaps Occupied Zone (zoneA)
      const overlapUpdate = await request(app)
        .put(`/api/v1/admin/zones/${z2.body.data.id}`)
        .set(adminHeaders)
        .send({ polygon: SYNTHETIC_POLYGONS.overlappingA });

      expect(overlapUpdate.status).toBe(409);
      expect(overlapUpdate.body.error.code).toBe("ZONE_OVERLAP");
    });

    it("PUT /admin/zones/:id rejects re-enabling a disabled zone that overlaps an enabled zone", async () => {
      await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Live Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
          isEnabled: true,
        });

      // Create disabled zone with overlapping polygon
      const draft = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Draft Overlap",
          polygon: SYNTHETIC_POLYGONS.overlappingA,
          isEnabled: false,
        });
      expect(draft.status).toBe(201);

      // Re-enabling must fail
      const enableRes = await request(app)
        .put(`/api/v1/admin/zones/${draft.body.data.id}`)
        .set(adminHeaders)
        .send({ isEnabled: true });

      expect(enableRes.status).toBe(409);
      expect(enableRes.body.error.code).toBe("ZONE_OVERLAP");
    });

    it("handles concurrent re-enabling of two overlapping disabled zones with one winner", async () => {
      const d1 = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Draft 1",
          polygon: SYNTHETIC_POLYGONS.zoneA,
          isEnabled: false,
        });
      const d2 = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Draft 2",
          polygon: SYNTHETIC_POLYGONS.overlappingA,
          isEnabled: false,
        });

      const attempts = await Promise.all([
        request(app)
          .put(`/api/v1/admin/zones/${d1.body.data.id}`)
          .set(adminHeaders)
          .send({ isEnabled: true }),
        request(app)
          .put(`/api/v1/admin/zones/${d2.body.data.id}`)
          .set(adminHeaders)
          .send({ isEnabled: true }),
      ]);

      const success = attempts.filter((r) => r.status === 200);
      const conflict = attempts.filter((r) => r.status === 409);

      expect(success).toHaveLength(1);
      expect(conflict).toHaveLength(1);
    });

    it("enforces ops_mode:manage permission for pause mutations and supports clearing pause", async () => {
      const created = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Pause Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });
      const zoneId = created.body.data.id;

      // 403 when updating pause with zoneManager (lacks ops_mode:manage)
      const forbiddenPause = await request(app)
        .put(`/api/v1/admin/zones/${zoneId}`)
        .set({ "X-Test-Actor": "zoneManager", "X-CSRF-Token": "1" })
        .send({
          pause: {
            active: true,
            message: "Landslide on Hill Cart Road",
            until: "2026-11-10T14:00:00.000Z",
          },
        });
      expect(forbiddenPause.status).toBe(403);
      expect(forbiddenPause.body.error.code).toBe("FORBIDDEN");

      // 200 when updating pause with opsManager (has ops_mode:manage)
      const opsHeaders = { "X-Test-Actor": "opsManager", "X-CSRF-Token": "1" };
      const pauseSuccess = await request(app)
        .put(`/api/v1/admin/zones/${zoneId}`)
        .set(opsHeaders)
        .send({
          pause: {
            active: true,
            message: "Landslide on Hill Cart Road",
            until: "2026-11-10T14:00:00.000Z",
          },
        });

      expect(pauseSuccess.status).toBe(200);
      expect(pauseSuccess.body.data.pause).toMatchObject({
        active: true,
        message: "Landslide on Hill Cart Road",
        until: "2026-11-10T14:00:00.000Z",
      });

      // Clear pause with null
      const clearPause = await request(app)
        .put(`/api/v1/admin/zones/${zoneId}`)
        .set(opsHeaders)
        .send({ pause: null });

      expect(clearPause.status).toBe(200);
      expect(clearPause.body.data.pause).toBeNull();
    });

    it("evaluates expired pause as active: false at read time without a worker", async () => {
      const opsHeaders = { "X-Test-Actor": "opsManager", "X-CSRF-Token": "1" };
      const created = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Expired Pause Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });
      const zoneId = created.body.data.id;

      // Set pause with expiry in the past
      await request(app)
        .put(`/api/v1/admin/zones/${zoneId}`)
        .set(opsHeaders)
        .send({
          pause: {
            active: true,
            message: "Past event",
            until: "2020-01-01T00:00:00.000Z",
          },
        });

      // Detail read evaluates pause.active as false
      const detail = await request(app)
        .get(`/api/v1/admin/zones/${zoneId}`)
        .set(adminHeaders);

      expect(detail.status).toBe(200);
      expect(detail.body.data.pause).toMatchObject({
        active: false,
        message: "Past event",
        until: "2020-01-01T00:00:00.000Z",
      });

      // List read also evaluates pause.active as false
      const list = await request(app)
        .get("/api/v1/admin/zones")
        .set(adminHeaders);
      const item = list.body.data.find((z: { id: string }) => z.id === zoneId);
      expect(item.pause.active).toBe(false);
    });

    it("rolls back zone update when audit write fails", async () => {
      const created = await request(app)
        .post("/api/v1/admin/zones")
        .set(adminHeaders)
        .send({
          cityId: city1Id,
          name: "Rollback Update Zone",
          polygon: SYNTHETIC_POLYGONS.zoneA,
        });
      const zoneId = created.body.data.id;

      await db.db!.command({
        collMod: "audit_log",
        validator: { required_audit_test_field: { $exists: true } },
        validationLevel: "strict",
      });

      try {
        const updateRes = await request(app)
          .put(`/api/v1/admin/zones/${zoneId}`)
          .set(adminHeaders)
          .send({ name: "Failed Rename" });

        expect(updateRes.status).toBe(500);

        // Verification: name was not changed in DB
        const zoneInDb = await db
          .collection("zones")
          .findOne({ _id: new mongoose.Types.ObjectId(zoneId) });
        expect(zoneInDb?.name).toBe("Rollback Update Zone");
      } finally {
        await db.db!.command({ collMod: "audit_log", validator: {} });
      }
    });
  });
});
