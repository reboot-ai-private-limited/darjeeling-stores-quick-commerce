import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createGeographyModule } from "../../src/modules/geography/geography.public.js";
import {
  createSyntheticStaffActor,
  SYNTHETIC_ACTORS,
  SYNTHETIC_IDS,
} from "./support/geography-fixture.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let geoModule: ReturnType<typeof createGeographyModule>;

const adminHeaders = {
  "X-Test-Actor": "zoneManager",
  "X-CSRF-Token": "1",
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("cities_test")).asPromise();

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
  await db.collection("audit_log").deleteMany({});
  await db.collection("users").deleteMany({});
  await db.collection("roles").deleteMany({});
});

describe("F03-02: City CRUD and public picker", () => {
  it("public GET /cities lists only active cities in alphabetical order", async () => {
    await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Kalimpong", state: "West Bengal" });
    const darj = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Darjeeling", state: "West Bengal" });
    const siliguri = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Siliguri", state: "West Bengal" });

    // Mark Siliguri inactive
    await request(app)
      .put(`/api/v1/admin/cities/${siliguri.body.data.id}`)
      .set(adminHeaders)
      .send({ isActive: false });

    const response = await request(app).get("/api/v1/cities");
    expect(response.status).toBe(200);
    expect(response.body.meta.count).toBe(2);
    expect(response.body.data.map((c: { name: string }) => c.name)).toEqual([
      "Darjeeling",
      "Kalimpong",
    ]);
    expect(response.body.data[0]).toMatchObject({
      id: darj.body.data.id,
      name: "Darjeeling",
      state: "West Bengal",
      isActive: true,
    });
  });

  it("admin GET /admin/cities lists all cities including inactive", async () => {
    await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Kurseong", state: "West Bengal" });
    const mirik = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Mirik", state: "West Bengal" });

    await request(app)
      .put(`/api/v1/admin/cities/${mirik.body.data.id}`)
      .set(adminHeaders)
      .send({ isActive: false });

    const response = await request(app)
      .get("/api/v1/admin/cities")
      .set(adminHeaders);

    expect(response.status).toBe(200);
    expect(response.body.meta.count).toBe(2);
    expect(response.body.data.map((c: { name: string; isActive: boolean }) => ({
      name: c.name,
      isActive: c.isActive,
    }))).toEqual([
      { name: "Kurseong", isActive: true },
      { name: "Mirik", isActive: false },
    ]);
  });

  it("enforces permission checks: requires zones:manage with all: true scope", async () => {
    // 401 unauthenticated
    expect((await request(app).get("/api/v1/admin/cities")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/admin/cities")
          .send({ name: "Test", state: "State" })
      ).status
    ).toBe(401);

    // 403 unauthorized permission
    expect(
      (
        await request(app)
          .get("/api/v1/admin/cities")
          .set("X-Test-Actor", "unauthorized")
      ).status
    ).toBe(403);

    // 403 scoped warehouse staff (zones:manage requires all scope)
    expect(
      (
        await request(app)
          .get("/api/v1/admin/cities")
          .set("X-Test-Actor", "scopedStaff")
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/v1/admin/cities")
          .set("X-Test-Actor", "scopedStaff")
          .send({ name: "Test", state: "State" })
      ).status
    ).toBe(403);
  });

  it("checks CSRF when cookies or origin are present", async () => {
    const resWithoutCsrf = await request(app)
      .post("/api/v1/admin/cities")
      .set({
        "X-Test-Actor": "zoneManager",
        Origin: "http://localhost:3000",
      })
      .send({ name: "Darjeeling", state: "West Bengal" });

    expect(resWithoutCsrf.status).toBe(403);
    expect(resWithoutCsrf.body.error.code).toBe("FORBIDDEN");

    const resWithCsrf = await request(app)
      .post("/api/v1/admin/cities")
      .set({
        "X-Test-Actor": "zoneManager",
        Origin: "http://localhost:3000",
        "X-CSRF-Token": "1",
      })
      .send({ name: "Darjeeling", state: "West Bengal" });

    expect(resWithCsrf.status).toBe(201);
  });

  it("rejects duplicate canonical name and state with 409 CONFLICT", async () => {
    const res1 = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Darjeeling", state: "West Bengal" });
    expect(res1.status).toBe(201);

    // Exact duplicate
    const res2 = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Darjeeling", state: "West Bengal" });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe("CONFLICT");

    // Case-insensitive & whitespace trimmed duplicate
    const res3 = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "  darjeeling  ", state: " west bengal " });
    expect(res3.status).toBe(409);
    expect(res3.body.error.code).toBe("CONFLICT");
  });

  it("handles concurrent creation of duplicate cities with exactly one winner", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/v1/admin/cities")
          .set(adminHeaders)
          .send({ name: "Gangtok", state: "Sikkim" })
      )
    );

    const created = attempts.filter((r) => r.status === 201);
    const conflicts = attempts.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(5);
    expect(
      await db.collection("cities").countDocuments({ canonicalName: "gangtok" })
    ).toBe(1);
  });

  it("validates input boundaries on POST and PUT", async () => {
    // Empty name
    expect(
      (
        await request(app)
          .post("/api/v1/admin/cities")
          .set(adminHeaders)
          .send({ name: "", state: "West Bengal" })
      ).status
    ).toBe(400);

    // Empty state
    expect(
      (
        await request(app)
          .post("/api/v1/admin/cities")
          .set(adminHeaders)
          .send({ name: "Darjeeling", state: "" })
      ).status
    ).toBe(400);

    // Name over 100 chars
    expect(
      (
        await request(app)
          .post("/api/v1/admin/cities")
          .set(adminHeaders)
          .send({ name: "A".repeat(101), state: "West Bengal" })
      ).status
    ).toBe(400);

    // Unknown field strictly rejected
    expect(
      (
        await request(app)
          .post("/api/v1/admin/cities")
          .set(adminHeaders)
          .send({ name: "Darjeeling", state: "West Bengal", unknown: "field" })
      ).status
    ).toBe(400);

    // Empty PUT body rejected
    const created = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Valid", state: "State" });

    expect(
      (
        await request(app)
          .put(`/api/v1/admin/cities/${created.body.data.id}`)
          .set(adminHeaders)
          .send({})
      ).status
    ).toBe(400);
  });

  it("updates city name, state, and status with transactional audit log", async () => {
    const createRes = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Darjeeling", state: "West Bengal" });

    const cityId = createRes.body.data.id;

    // Check create audit event
    const createAudit = await db.collection("audit_log").findOne({
      entityType: "city",
      action: "city.create",
      entityId: cityId,
    });
    expect(createAudit).not.toBeNull();
    expect(createAudit?.cityChange?.before).toBeNull();
    expect(createAudit?.cityChange?.after).toMatchObject({
      id: cityId,
      name: "Darjeeling",
      state: "West Bengal",
      isActive: true,
    });

    // PUT update
    const updateRes = await request(app)
      .put(`/api/v1/admin/cities/${cityId}`)
      .set(adminHeaders)
      .send({ name: "Darjeeling Town", isActive: false });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data).toMatchObject({
      id: cityId,
      name: "Darjeeling Town",
      state: "West Bengal",
      isActive: false,
    });

    // Check update audit event
    const updateAudit = await db.collection("audit_log").findOne({
      entityType: "city",
      action: "city.update",
      entityId: cityId,
    });
    expect(updateAudit).not.toBeNull();
    expect(updateAudit?.cityChange?.before).toMatchObject({
      id: cityId,
      name: "Darjeeling",
      isActive: true,
    });
    expect(updateAudit?.cityChange?.after).toMatchObject({
      id: cityId,
      name: "Darjeeling Town",
      isActive: false,
    });
  });

  it("PUT /admin/cities/:id returns 404 for unknown or non-hex ID", async () => {
    expect(
      (
        await request(app)
          .put("/api/v1/admin/cities/non-hex-id")
          .set(adminHeaders)
          .send({ name: "Updated" })
      ).status
    ).toBe(404);

    expect(
      (
        await request(app)
          .put("/api/v1/admin/cities/672b123456789abcdef01999")
          .set(adminHeaders)
          .send({ name: "Updated" })
      ).status
    ).toBe(404);
  });

  it("PUT /admin/cities/:id rejects renaming to existing canonical city", async () => {
    await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Darjeeling", state: "West Bengal" });
    const kalimpong = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Kalimpong", state: "West Bengal" });

    const renameRes = await request(app)
      .put(`/api/v1/admin/cities/${kalimpong.body.data.id}`)
      .set(adminHeaders)
      .send({ name: "darjeeling" });

    expect(renameRes.status).toBe(409);
    expect(renameRes.body.error.code).toBe("CONFLICT");
  });

  it("rolls back city create when audit write fails", async () => {
    try {
      await db.createCollection("audit_log");
    } catch {
      // already exists
    }
    await db.db!.command({
      collMod: "audit_log",
      validator: { required_audit_test_field: { $exists: true } },
      validationLevel: "strict",
    });

    try {
      const response = await request(app)
        .post("/api/v1/admin/cities")
        .set(adminHeaders)
        .send({ name: "Rollback City", state: "West Bengal" });

      expect(response.status).toBe(500);
      expect(
        await db.collection("cities").countDocuments({ canonicalName: "rollback city" })
      ).toBe(0);
    } finally {
      await db.db!.command({ collMod: "audit_log", validator: {} });
    }
  });

  it("re-checks and locks actor inside transaction, rejecting in-flight deactivated staff with 403", async () => {
    const staffId = new mongoose.Types.ObjectId(SYNTHETIC_IDS.userStaff);
    const roleId = new mongoose.Types.ObjectId();

    // Create active role in DB
    await db.collection("roles").insertOne({
      _id: roleId,
      name: "zone_manager",
      permissions: ["zones:manage"],
      isSystem: true,
    });

    // Seed staff user as deactivated
    await db.collection("users").insertOne({
      _id: staffId,
      kind: "staff",
      status: "deactivated",
      roleId,
      scope: { all: true, warehouseIds: [] },
      authorizationRevision: 1,
    });

    // Request with valid zoneManager token/actor gets rejected inside mutation transaction
    const res = await request(app)
      .post("/api/v1/admin/cities")
      .set(adminHeaders)
      .send({ name: "Deactivated Attempt City", state: "West Bengal" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(
      await db.collection("cities").countDocuments({ canonicalName: "deactivated attempt city" })
    ).toBe(0);
  });
});
