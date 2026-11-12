import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";
import { createSessionStore } from "../../src/modules/identity/infrastructure/sessions.js";
import { createAdministrationRoutes } from "../../src/modules/identity/administration.public.js";
import { scrypt } from "node:crypto";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let auth: string;
let roleId: string;
const key = "a".repeat(64);
const scope = { all: true, warehouseIds: [] };
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("staff_test")).asPromise();
  app = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", key) });
  await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000001", app: "admin" });
  const login = await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000001", otp: "000000" });
  auth = `Bearer ${login.body.data.accessToken}`;
  roleId = String((await db.collection("roles").findOne({ name: "admin" }))!._id);
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });
const create = (email: string, overrides = {}) => request(app).post("/api/v1/admin/staff").set("Authorization", auth)
  .send({ email, name: "Dorjee Lama", password: "Temp-Passw0rd!", roleId, scope, ...overrides });

// These tests manufacture fully authenticated sessions; temporary-password flows are tested in staff-auth.test.ts.
async function issueReady(sessions: ReturnType<typeof createSessionStore>, id: mongoose.Types.ObjectId) {
  await db.collection("users").updateOne({ _id: id }, { $set: { mustChangePassword: false } });
  return sessions.issue(id);
}

describe("staff management", () => {
  it("creates, reads and updates staff with safe projections and canonical email", async () => {
    const created = await create(" Staff@Example.com ");
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ email: "staff@example.com", role: "admin", status: "active", scope });
    expect(created.headers["cache-control"]).toBe("no-store");
    const stored = await db.collection("users").findOne({ email: "staff@example.com" });
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(stored)).not.toContain("Temp-Passw0rd!");
    expect((await create("STAFF@example.com")).status).toBe(409);
    const detail = await request(app).get(`/api/v1/admin/staff/${id}`).set("Authorization", auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ lastLoginAt: null });
    expect(detail.body.data).not.toHaveProperty("passwordHash");
    const updated = await request(app).put(`/api/v1/admin/staff/${id}`).set("Authorization", auth).send({ name: "New Name" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("New Name");
  });
  it("validates bodies, role type and IDs", async () => {
    const customer = await db.collection("roles").findOne({ name: "customer" });
    for (const overrides of [{ password: "short" }, { password: "a".repeat(1025) }, { roleId: String(customer!._id) }, { roleId: "bad" }, { scope: { all: true, warehouseIds: [new mongoose.Types.ObjectId().toHexString()] } }, { status: "active" }]) {
      expect((await create("invalid@example.com", overrides)).status).toBe(400);
    }
    expect((await request(app).get("/api/v1/admin/staff/bad").set("Authorization", auth)).status).toBe(404);
    expect((await request(app).put("/api/v1/admin/staff/000000000000000000000000").set("Authorization", auth).send({ name: "Nobody" })).status).toBe(404);
  });
  it("requires current staff:manage and enforces CSRF", async () => {
    expect((await request(app).get("/api/v1/admin/staff")).status).toBe(401);
    const created = await create("no-grant@example.com");
    const pair = await issueReady(createSessionStore(db, key), new mongoose.Types.ObjectId(created.body.data.id));
    expect((await request(app).get("/api/v1/admin/staff").set("Authorization", `Bearer ${pair.accessToken}`)).status).toBe(403);
    expect((await request(app).post("/api/v1/admin/staff").set("Authorization", auth).set("Origin", "https://evil.example").send({})).status).toBe(403);
  });
  it("deactivates, reactivates and revokes every session without affecting other users", async () => {
    const created = await create("lifecycle@example.com");
    const id = created.body.data.id;
    const sessions = createSessionStore(db, key);
    const first = await issueReady(sessions, new mongoose.Types.ObjectId(id));
    const second = await issueReady(sessions, new mongoose.Types.ObjectId(id));
    expect((await request(app).post(`/api/v1/admin/staff/${id}/deactivate`).set("Authorization", auth)).status).toBe(200);
    for (const pair of [first, second]) {
      expect(await sessions.authenticate(pair.accessToken)).toBeNull();
      expect(await sessions.rotate(pair.refreshToken)).toMatchObject({ error: "UNAUTHORIZED" });
    }
    expect((await request(app).get("/api/v1/admin/staff").set("Authorization", auth).query({ status: "deactivated", roleId })).body.data).toEqual([expect.objectContaining({ id })]);
    expect((await request(app).post(`/api/v1/admin/staff/${id}/reactivate`).set("Authorization", auth)).status).toBe(200);
    expect(await sessions.authenticate(first.accessToken)).toBeNull();
    const renewed = await issueReady(sessions, new mongoose.Types.ObjectId(id));
    expect((await request(app).post(`/api/v1/admin/staff/${id}/force-logout`).set("Authorization", auth)).status).toBe(200);
    expect(await sessions.authenticate(renewed.accessToken)).toBeNull();
    expect((await request(app).get("/api/v1/admin/roles").set("Authorization", auth)).status).toBe(200);
  });
  it("replaces salted password hashes and revokes sessions", async () => {
    const created = await create("credentials@example.com");
    const id = created.body.data.id;
    const userId = new mongoose.Types.ObjectId(id);
    const before = await db.collection("users").findOne({ _id: userId });
    const sessions = createSessionStore(db, key);
    const pair = await issueReady(sessions, userId);
    expect((await request(app).post(`/api/v1/admin/staff/${id}/reset-password`).set("Authorization", auth).send({ newPassword: "New-Temp-Passw0rd!" })).status).toBe(200);
    const after = await db.collection("users").findOne({ _id: userId });
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    const [, version, n, r, p, salt, hash] = after!.passwordHash.split("$");
    expect(version).toBe("v1");
    const derived = await new Promise<Buffer>((resolve, reject) => scrypt("New-Temp-Passw0rd!", salt, 64,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
    expect(derived.toString("hex")).toBe(hash);
    expect(after?.mustChangePassword).toBe(true);
    expect(await sessions.authenticate(pair.accessToken)).toBeNull();
    expect(await sessions.rotate(pair.refreshToken)).toMatchObject({ error: "UNAUTHORIZED" });
  });
  it("validates and paginates literal search without leaking credential fields", async () => {
    await create("literal+search@example.com", { name: "Search [literal]" });
    await create("literal+second@example.com", { name: "Search [literal]" });
    const first = await request(app).get("/api/v1/admin/staff").set("Authorization", auth).query({ q: "[literal]", limit: "1" });
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.nextCursor).toMatch(/^[a-f0-9]{24}$/);
    const next = await request(app).get("/api/v1/admin/staff").set("Authorization", auth).query({ q: "[literal]", limit: "1", cursor: first.body.meta.nextCursor });
    expect(next.body.data).toHaveLength(1);
    expect(next.body.data[0].id).not.toBe(first.body.data[0].id);
    expect(next.body.meta.nextCursor).toBeNull();
    for (const query of [{ limit: "101" }, { limit: "0" }, { cursor: "bad" }, { status: "deleted" }, { roleId: "bad" }, { unexpected: "x" }]) {
      expect((await request(app).get("/api/v1/admin/staff").set("Authorization", auth).query(query)).status).toBe(400);
    }
    expect(JSON.stringify(first.body)).not.toMatch(/passwordHash|recoveryCodeHashes|secretEncrypted/);
  });
  it("limits warehouse managers to whole accounts within their scope and existing warehouses", async () => {
    const wh1 = new mongoose.Types.ObjectId();
    const wh2 = new mongoose.Types.ObjectId();
    await db.collection("warehouses").insertMany([{ _id: wh1 }, { _id: wh2 }]);
    const role = await request(app).post("/api/v1/admin/roles").set("Authorization", auth).send({ name: "staff_manager", permissions: ["staff:manage", "orders:view"] });
    const workerRole = await request(app).post("/api/v1/admin/roles").set("Authorization", auth).send({ name: "staff_worker", permissions: ["orders:view"] });
    const whScope = { all: false, warehouseIds: [String(wh1)] };
    const manager = await create("scoped-manager@example.com", { roleId: role.body.data.id, scope: whScope });
    const sessions = createSessionStore(db, key);
    const pair = await issueReady(sessions, new mongoose.Types.ObjectId(manager.body.data.id));
    const managerAuth = `Bearer ${pair.accessToken}`;
    const worker = await create("scoped-worker@example.com", { roleId: workerRole.body.data.id, scope: whScope });
    const outside = await create("outside-worker@example.com", { roleId: workerRole.body.data.id, scope: { all: false, warehouseIds: [String(wh1), String(wh2)] } });
    const list = await request(app).get("/api/v1/admin/staff").set("Authorization", managerAuth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((user: { id: string }) => user.id).sort()).toEqual([manager.body.data.id, worker.body.data.id].sort());
    expect((await request(app).get(`/api/v1/admin/staff/${outside.body.data.id}`).set("Authorization", managerAuth)).status).toBe(404);
    expect((await request(app).post(`/api/v1/admin/staff/${outside.body.data.id}/force-logout`).set("Authorization", managerAuth)).status).toBe(404);
    expect((await request(app).put(`/api/v1/admin/staff/${worker.body.data.id}`).set("Authorization", managerAuth).send({ scope })).status).toBe(403);
    expect((await request(app).put(`/api/v1/admin/staff/${worker.body.data.id}`).set("Authorization", managerAuth).send({ roleId })).status).toBe(403);
    expect((await request(app).put(`/api/v1/admin/staff/${worker.body.data.id}`).set("Authorization", managerAuth).send({ name: "Allowed" })).status).toBe(200);
    expect((await create("unknown-wh@example.com", { scope: { all: false, warehouseIds: [String(new mongoose.Types.ObjectId())] } })).status).toBe(400);
    expect((await request(app).put(`/api/v1/admin/staff/${manager.body.data.id}`).set("Authorization", auth).send({ roleId: workerRole.body.data.id })).status).toBe(200);
    expect((await request(app).get("/api/v1/admin/staff").set("Authorization", managerAuth)).status).toBe(403);
  });
  it("protects owners, stronger targets, self authority and account kinds", async () => {
    const owner = await db.collection("users").findOne({ phone: "+919000000001" });
    for (const action of ["deactivate", "reactivate", "reset-password", "force-logout"]) {
      expect((await request(app).post(`/api/v1/admin/staff/${owner!._id}/${action}`).set("Authorization", auth).send(action === "reset-password" ? { newPassword: "Other-Passw0rd!" } : {})).status).toBe(403);
    }
    expect((await create("new-owner@example.com", { roleId: String(owner!.roleId) })).status).toBe(400);
    const managerRole = await request(app).post("/api/v1/admin/roles").set("Authorization", auth).send({ name: "self_manager", permissions: ["staff:manage", "orders:view"] });
    const manager = await create("self-manager@example.com", { roleId: managerRole.body.data.id });
    const pair = await issueReady(createSessionStore(db, key), new mongoose.Types.ObjectId(manager.body.data.id));
    const selfAuth = `Bearer ${pair.accessToken}`;
    expect((await request(app).post(`/api/v1/admin/staff/${manager.body.data.id}/deactivate`).set("Authorization", selfAuth)).status).toBe(403);
    expect((await request(app).put(`/api/v1/admin/staff/${manager.body.data.id}`).set("Authorization", selfAuth).send({ scope })).status).toBe(403);
    const stronger = await db.collection("users").findOne({ email: "staff@example.com" });
    expect((await request(app).post(`/api/v1/admin/staff/${stronger!._id}/reset-password`).set("Authorization", selfAuth).send({ newPassword: "Other-Passw0rd!" })).status).toBe(403);
    const customer = await db.collection("users").insertOne({ kind: "customer", roleId: owner!.roleId, name: "Customer", status: "active", scope });
    expect((await request(app).get(`/api/v1/admin/staff/${customer.insertedId}`).set("Authorization", auth)).status).toBe(404);
    await db.collection("users").updateOne({ _id: new mongoose.Types.ObjectId(manager.body.data.id) }, { $set: { status: "deleted" } });
    expect((await request(app).post(`/api/v1/admin/staff/${manager.body.data.id}/reactivate`).set("Authorization", auth)).status).toBe(409);
  });
  it("revokes a refresh that races with force logout", async () => {
    const created = await create("refresh-race@example.com");
    const id = created.body.data.id;
    const sessions = createSessionStore(db, key);
    const pair = await issueReady(sessions, new mongoose.Types.ObjectId(id));
    const [refresh, logout] = await Promise.all([
      sessions.rotate(pair.refreshToken),
      request(app).post(`/api/v1/admin/staff/${id}/force-logout`).set("Authorization", auth),
    ]);
    expect(logout.status).toBe(200);
    if (!("error" in refresh)) {
      expect(await sessions.authenticate(refresh.accessToken)).toBeNull();
      expect(await sessions.rotate(refresh.refreshToken)).toMatchObject({ error: "UNAUTHORIZED" });
    }
    expect(await sessions.authenticate(pair.accessToken)).toBeNull();
  });
  it("keeps staff role assignment consistent with concurrent deletion", async () => {
    for (const operation of ["create", "update"]) {
      const role = await request(app).post("/api/v1/admin/roles").set("Authorization", auth).send({ name: `staff_assignment_${operation}`, permissions: ["orders:view"] });
      const id = role.body.data.id;
      const existing = operation === "update" ? await create("assignment-update@example.com") : null;
      const assign = operation === "create" ? create("assignment-create@example.com", { roleId: id })
        : request(app).put(`/api/v1/admin/staff/${existing!.body.data.id}`).set("Authorization", auth).send({ roleId: id });
      const [assignment, deletion] = await Promise.all([
        assign,
        request(app).delete(`/api/v1/admin/roles/${id}`).set("Authorization", auth),
      ]);
      expect([200, 201, 400]).toContain(assignment.status);
      expect([200, 409]).toContain(deletion.status);
      const assigned = await db.collection("users").findOne({ roleId: new mongoose.Types.ObjectId(id) });
      const remainingRole = await db.collection("roles").findOne({ _id: new mongoose.Types.ObjectId(id) });
      expect(!assigned || !!remainingRole).toBe(true);
    }
  });
  it("registers all F02 routes without mock OTP and returns grouped permissions", async () => {
    const routes = await createAdministrationRoutes(db, key);
    const standalone = createApp({ additionalRoutes: routes });
    expect(routes).toHaveLength(14);
    expect((await request(standalone).post("/api/v1/auth/request-otp").send({ phone: "9000000001" })).status).toBe(404);
    expect((await request(standalone).get("/api/v1/admin/staff")).status).toBe(401);
    expect((await request(standalone).get("/api/v1/admin/staff").set("Authorization", auth)).status).toBe(401);
    expect((await request(standalone).get("/api/v1/admin/roles").set("Authorization", auth)).status).toBe(401);
    const managerRole = await request(app).post("/api/v1/admin/roles").set("Authorization", auth).send({ name: "standalone_manager", permissions: ["staff:manage", "roles:manage"] });
    const manager = await create("standalone-manager@example.com", { roleId: managerRole.body.data.id });
    const pair = await issueReady(createSessionStore(db, key), new mongoose.Types.ObjectId(manager.body.data.id));
    const staffAuth = `Bearer ${pair.accessToken}`;
    expect((await request(standalone).get("/api/v1/admin/staff").set("Authorization", staffAuth)).status).toBe(200);
    const permissions = await request(standalone).get("/api/v1/admin/permissions").set("Authorization", staffAuth);
    expect(permissions.body.data).toMatchObject({ admin: expect.arrayContaining(["staff:manage"]), customer: expect.arrayContaining(["address:create"]), rider: expect.arrayContaining(["rider_order:deliver"]) });
    expect(permissions.body.meta.count).toBe(Object.values(permissions.body.data).reduce((total: number, keys) => total + (keys as string[]).length, 0));
  });
});
