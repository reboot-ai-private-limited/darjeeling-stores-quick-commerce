import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import {
  createGeographyModule,
  type WarehouseDependencyPort,
} from "../../src/modules/geography/geography.public.js";
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
let zone1Id: string;
let wh1Id: string;

let dependencyCheckResult:
  | { safe: true; activeOrders: 0 }
  | { safe: false; reason: "dependency_check_unavailable" }
  | { safe: false; activeOrders: number } = {
  safe: false,
  reason: "dependency_check_unavailable",
};

const mockDependencyPort: WarehouseDependencyPort = {
  checkCanDisable: async () => dependencyCheckResult,
};

const adminHeaders = {
  "X-Test-Actor": "allManage",
  "X-CSRF-Token": "1",
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("warehouses_mutation_test")).asPromise();

  geoModule = createGeographyModule({
    connection: db,
    dependencyPort: mockDependencyPort,
    resolveActor: (req) => {
      const actorKey = req.get("X-Test-Actor");
      if (!actorKey) return null;
      if (actorKey === "allManage") return SYNTHETIC_ACTORS.warehouseManagerAll;
      if (actorKey === "opsManager") return SYNTHETIC_ACTORS.opsManager;
      if (actorKey === "scopedWh1Manage")
        return createSyntheticStaffActor(["warehouses:manage"], {
          all: false,
          warehouseIds: [wh1Id],
        });
      if (actorKey === "scopedOtherManage")
        return createSyntheticStaffActor(["warehouses:manage"], {
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

beforeEach(async () => {
  dependencyCheckResult = { safe: false, reason: "dependency_check_unavailable" };
  await db.collection("cities").deleteMany({});
  await db.collection("zones").deleteMany({});
  await db.collection("warehouses").deleteMany({});
  await db.collection("audit_log").deleteMany({});

  // Seed City 1
  const c1 = await geoModule.cityService.createCity(
    { name: "Darjeeling", state: "West Bengal" },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000001"
  );
  city1Id = c1.id;

  // Seed Zone 1
  const z1 = await geoModule.zoneService.createZone(
    {
      cityId: city1Id,
      name: "Chowrasta Zone",
      polygon: SYNTHETIC_POLYGONS.zoneA,
      isEnabled: true,
    },
    SYNTHETIC_ACTORS.zoneManager,
    "00000000-0000-4000-8000-000000000002"
  );
  zone1Id = z1.id;

  // Create an initial warehouse
  const wh = await request(app)
    .post("/api/v1/admin/warehouses")
    .set(adminHeaders)
    .send({
      zoneId: zone1Id,
      name: "Initial Store",
      code: "INIT-1",
      location: { lat: 27.041, lng: 88.2663 },
      address: "Mall Road, Darjeeling",
      priority: 1,
      packMinutes: 5,
      riderArrivalMinutes: 5,
      defaultTravelMinutes: 10,
      punchInRadiusMeters: 150,
    });
  wh1Id = wh.body.data.id;
});

describe("F03-09: Warehouse creation", () => {
  it("creates a warehouse with valid inputs and default values", async () => {
    const res = await request(app)
      .post("/api/v1/admin/warehouses")
      .set(adminHeaders)
      .send({
        zoneId: zone1Id,
        name: "Second Store",
        code: "sec-2",
        location: { lat: 27.042, lng: 88.267 },
        address: "Observatory Hill Road, Darjeeling",
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      zoneId: zone1Id,
      name: "Second Store",
      code: "SEC-2", // Normalized to uppercase
      location: { lat: 27.042, lng: 88.267 },
      address: "Observatory Hill Road, Darjeeling",
      isEnabled: true,
      priority: 1,
      packMinutes: 5,
      riderArrivalMinutes: 5,
      defaultTravelMinutes: 10,
      punchInRadiusMeters: 150,
      pause: null,
    });
    expect(res.body.data.id).toMatch(/^[a-fA-F0-9]{24}$/);

    // Audit write check
    const audit = await db.collection("audit_log").findOne({
      entityType: "warehouse",
      action: "warehouse.create",
      entityId: res.body.data.id,
    });
    expect(audit).not.toBeNull();
    expect(audit?.warehouseId).toBe(res.body.data.id);
    expect(audit?.warehouseChange?.before).toBeNull();
    expect(audit?.warehouseChange?.after).toMatchObject({
      id: res.body.data.id,
      code: "SEC-2",
    });
  });

  it("enforces authority: requires warehouses:manage with all: true scope", async () => {
    // 401 unauthenticated
    expect(
      (
        await request(app)
          .post("/api/v1/admin/warehouses")
          .send({
            zoneId: zone1Id,
            name: "W",
            code: "W-1",
            location: { lat: 27.04, lng: 88.26 },
            address: "Address",
          })
      ).status
    ).toBe(401);

    // 403 unauthorized staff (lacking warehouses:manage)
    expect(
      (
        await request(app)
          .post("/api/v1/admin/warehouses")
          .set("X-Test-Actor", "unauthorized")
          .send({
            zoneId: zone1Id,
            name: "W",
            code: "W-1",
            location: { lat: 27.04, lng: 88.26 },
            address: "Address",
          })
      ).status
    ).toBe(403);

    // 403 scoped staff (creation requires all scope)
    expect(
      (
        await request(app)
          .post("/api/v1/admin/warehouses")
          .set("X-Test-Actor", "scopedWh1Manage")
          .send({
            zoneId: zone1Id,
            name: "W",
            code: "W-1",
            location: { lat: 27.04, lng: 88.26 },
            address: "Address",
          })
      ).status
    ).toBe(403);
  });

  it("rejects unknown zoneId with 404 NOT_FOUND", async () => {
    const res = await request(app)
      .post("/api/v1/admin/warehouses")
      .set(adminHeaders)
      .send({
        zoneId: "672b123456789abcdef01999",
        name: "Unknown Zone Store",
        code: "UKN-1",
        location: { lat: 27.04, lng: 88.26 },
        address: "Test Address",
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects duplicate warehouse code with 409 CONFLICT", async () => {
    const dupRes = await request(app)
      .post("/api/v1/admin/warehouses")
      .set(adminHeaders)
      .send({
        zoneId: zone1Id,
        name: "Duplicate Store",
        code: "init-1", // case-insensitive duplicate
        location: { lat: 27.04, lng: 88.26 },
        address: "Another Address",
      });

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe("CONFLICT");
  });

  it("handles concurrent creation of duplicate codes with exactly one winner", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post("/api/v1/admin/warehouses")
          .set(adminHeaders)
          .send({
            zoneId: zone1Id,
            name: `Store ${i}`,
            code: "RACE-1",
            location: { lat: 27.04, lng: 88.26 },
            address: "Race Address",
          })
      )
    );

    const created = attempts.filter((r) => r.status === 201);
    const conflicts = attempts.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    expect(await db.collection("warehouses").countDocuments({ code: "RACE-1" })).toBe(1);
  });

  it("validates boundary inputs on creation", async () => {
    // Code with invalid chars
    expect(
      (
        await request(app)
          .post("/api/v1/admin/warehouses")
          .set(adminHeaders)
          .send({
            zoneId: zone1Id,
            name: "W",
            code: "INV@LID",
            location: { lat: 27.04, lng: 88.26 },
            address: "Valid Address",
          })
      ).status
    ).toBe(400);

    // Address too short (< 3 chars)
    expect(
      (
        await request(app)
          .post("/api/v1/admin/warehouses")
          .set(adminHeaders)
          .send({
            zoneId: zone1Id,
            name: "W",
            code: "VALID-1",
            location: { lat: 27.04, lng: 88.26 },
            address: "No",
          })
      ).status
    ).toBe(400);

    // Negative priority
    expect(
      (
        await request(app)
          .post("/api/v1/admin/warehouses")
          .set(adminHeaders)
          .send({
            zoneId: zone1Id,
            name: "W",
            code: "VALID-1",
            location: { lat: 27.04, lng: 88.26 },
            address: "Valid Address",
            priority: 0,
          })
      ).status
    ).toBe(400);
  });

  it("rolls back warehouse creation when audit write fails", async () => {
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
        .post("/api/v1/admin/warehouses")
        .set(adminHeaders)
        .send({
          zoneId: zone1Id,
          name: "Rollback Store",
          code: "ROLL-1",
          location: { lat: 27.04, lng: 88.26 },
          address: "Rollback Address",
        });

      expect(response.status).toBe(500);
      expect(await db.collection("warehouses").countDocuments({ code: "ROLL-1" })).toBe(0);
    } finally {
      await db.db!.command({ collMod: "audit_log", validator: {} });
    }
  });
});

describe("F03-10: Warehouse edits and guarded disable", () => {
  it("updates mutable fields and writes audit record", async () => {
    const res = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(adminHeaders)
      .send({
        name: "Renamed Store",
        address: "New Street Address, Darjeeling",
        priority: 3,
        packMinutes: 7,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: wh1Id,
      name: "Renamed Store",
      address: "New Street Address, Darjeeling",
      priority: 3,
      packMinutes: 7,
      code: "INIT-1", // immutable
    });

    // Check audit
    const audit = await db.collection("audit_log").findOne(
      {
        entityType: "warehouse",
        action: "warehouse.update",
        entityId: wh1Id,
      },
      { sort: { _id: -1 } }
    );
    expect(audit).not.toBeNull();
    expect(audit?.warehouseChange?.after).toMatchObject({
      id: wh1Id,
      name: "Renamed Store",
      priority: 3,
    });
  });

  it("rejects updating immutable fields (code, zoneId)", async () => {
    // Attempting to change code
    expect(
      (
        await request(app)
          .put(`/api/v1/admin/warehouses/${wh1Id}`)
          .set(adminHeaders)
          .send({ code: "NEW-CODE" })
      ).status
    ).toBe(400);

    // Attempting to change zoneId
    expect(
      (
        await request(app)
          .put(`/api/v1/admin/warehouses/${wh1Id}`)
          .set(adminHeaders)
          .send({ zoneId: "672b123456789abcdef01999" })
      ).status
    ).toBe(400);
  });

  it("allows scoped staff to update own warehouse but forbids foreign warehouse", async () => {
    // Scoped staff updates own warehouse (wh1Id) -> 200 OK
    const ownUpdate = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set({ "X-Test-Actor": "scopedWh1Manage", "X-CSRF-Token": "1" })
      .send({ name: "Manager Updated Store" });
    expect(ownUpdate.status).toBe(200);

    // Scoped staff updates foreign warehouse -> 403 FORBIDDEN
    const foreignUpdate = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set({ "X-Test-Actor": "scopedOtherManage", "X-CSRF-Token": "1" })
      .send({ name: "Unauthorized Update" });
    expect(foreignUpdate.status).toBe(403);
    expect(foreignUpdate.body.error.code).toBe("FORBIDDEN");
  });

  it("enforces ops_mode:manage for pause mutations on warehouse", async () => {
    // Updating pause without ops_mode:manage -> 403 FORBIDDEN
    const noOps = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(adminHeaders)
      .send({
        pause: {
          active: true,
          message: "Inventory count",
          until: "2026-11-10T14:00:00.000Z",
        },
      });
    expect(noOps.status).toBe(403);
    expect(noOps.body.error.code).toBe("FORBIDDEN");

    // Updating pause with opsManager -> 200 OK
    const opsHeaders = { "X-Test-Actor": "opsManager", "X-CSRF-Token": "1" };
    const withOps = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(opsHeaders)
      .send({
        pause: {
          active: true,
          message: "Inventory count",
          until: "2026-11-10T14:00:00.000Z",
        },
      });
    expect(withOps.status).toBe(200);
    expect(withOps.body.data.pause).toMatchObject({
      active: true,
      message: "Inventory count",
    });

    // Clear pause with null
    const clearPause = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(opsHeaders)
      .send({ pause: null });
    expect(clearPause.status).toBe(200);
    expect(clearPause.body.data.pause).toBeNull();
  });

  it("guarded disable: blocks when dependency check is unavailable", async () => {
    dependencyCheckResult = { safe: false, reason: "dependency_check_unavailable" };

    const disableRes = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(adminHeaders)
      .send({ isEnabled: false });

    expect(disableRes.status).toBe(409);
    expect(disableRes.body.error.code).toBe("CONFLICT");
    expect(disableRes.body.error.details).toEqual({
      reason: "dependency_check_unavailable",
    });

    // Ordinary update succeeds even when dependency check is unavailable
    const ordinaryRes = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(adminHeaders)
      .send({ name: "Allowed While Dependency Unavailable" });
    expect(ordinaryRes.status).toBe(200);
  });

  it("guarded disable: blocks when active orders exist", async () => {
    dependencyCheckResult = { safe: false, activeOrders: 3 };

    const disableRes = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(adminHeaders)
      .send({ isEnabled: false });

    expect(disableRes.status).toBe(409);
    expect(disableRes.body.error.code).toBe("CONFLICT");
    expect(disableRes.body.error.details).toEqual({ activeOrders: 3 });
  });

  it("guarded disable: succeeds when dependency check confirms safe", async () => {
    dependencyCheckResult = { safe: true, activeOrders: 0 };

    const disableRes = await request(app)
      .put(`/api/v1/admin/warehouses/${wh1Id}`)
      .set(adminHeaders)
      .send({ isEnabled: false });

    expect(disableRes.status).toBe(200);
    expect(disableRes.body.data.isEnabled).toBe(false);

    // Verify in DB
    const whInDb = await db
      .collection("warehouses")
      .findOne({ _id: new mongoose.Types.ObjectId(wh1Id) });
    expect(whInDb?.isEnabled).toBe(false);
  });

  it("rolls back warehouse update when audit write fails", async () => {
    dependencyCheckResult = { safe: true, activeOrders: 0 };

    await db.db!.command({
      collMod: "audit_log",
      validator: { required_audit_test_field: { $exists: true } },
      validationLevel: "strict",
    });

    try {
      const response = await request(app)
        .put(`/api/v1/admin/warehouses/${wh1Id}`)
        .set(adminHeaders)
        .send({ name: "Failed Rename Store" });

      expect(response.status).toBe(500);

      const whInDb = await db
        .collection("warehouses")
        .findOne({ _id: new mongoose.Types.ObjectId(wh1Id) });
      expect(whInDb?.name).not.toBe("Failed Rename Store");
    } finally {
      await db.db!.command({ collMod: "audit_log", validator: {} });
    }
  });
});
