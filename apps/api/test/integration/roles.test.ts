import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";
import { createSessionStore } from "../../src/modules/identity/infrastructure/sessions.js";
import { createIdentityStore } from "../../src/modules/identity/identity.public.js";
let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let auth: string;
const key = "a".repeat(64);
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("roles_test")).asPromise();
  app = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", key) });
  await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000001", app: "admin" });
  const login = await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000001", otp: "000000" });
  auth = `Bearer ${login.body.data.accessToken}`;
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });
const create = (name: string, permissions = ["orders:view"]) => request(app).post("/api/v1/admin/roles").set("Authorization", auth).send({ name, permissions });
describe("role management", () => {
  it("validates fields, names and grants", async () => {
    for (const body of [{ name: "test", permissions: ["*"] }, { name: "test", permissions: ["bad:key"] }, { name: "admin", permissions: [] }, { name: "Bad Name", permissions: [] }, { name: "test", permissions: [], isSystem: true }, { name: "test", permissions: ["orders:view", "orders:view"] }]) {
      expect((await request(app).post("/api/v1/admin/roles").set("Authorization", auth).send(body)).status).toBe(400);
    }
  });
  it("creates, updates and deletes roles", async () => {
    const created = await create("packing");
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect((await create("packing")).status).toBe(409);
    const updated = await request(app).put(`/api/v1/admin/roles/${id}`).set("Authorization", auth).send({ permissions: ["stock:view"] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.permissions).toEqual(["stock:view"]);
    expect((await request(app).delete(`/api/v1/admin/roles/${id}`).set("Authorization", auth)).status).toBe(200);
  });
  it("protects system roles and assigned roles", async () => {
    const system = await db.collection("roles").findOne({ name: "super_admin" });
    expect((await request(app).put(`/api/v1/admin/roles/${system!._id}`).set("Authorization", auth).send({ permissions: [] })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/roles/${system!._id}`).set("Authorization", auth)).status).toBe(403);
    const created = await create("assigned");
    await createIdentityStore(db).createUser({ kind: "staff", roleId: created.body.data.id, email: "assigned@example.com" });
    expect((await request(app).delete(`/api/v1/admin/roles/${created.body.data.id}`).set("Authorization", auth)).status).toBe(409);
  });
  it("prevents escalation and immediately enforces permission removal", async () => {
    const created = await create("manager", ["roles:manage", "orders:view"]);
    const user = await createIdentityStore(db).createUser({ kind: "staff", roleId: created.body.data.id, email: "manager@example.com" });
    await db.collection("users").updateOne({ _id: new mongoose.Types.ObjectId(user.id) }, { $set: { scope: { all: true, warehouseIds: [] } } });
    const pair = await createSessionStore(db, key).issue(new mongoose.Types.ObjectId(user.id));
    const manager = `Bearer ${pair.accessToken}`;
    expect((await request(app).post("/api/v1/admin/roles").set("Authorization", manager).send({ name: "escalated", permissions: ["staff:manage"] })).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/roles").set("Authorization", manager)).status).toBe(200);
    await request(app).put(`/api/v1/admin/roles/${created.body.data.id}`).set("Authorization", auth).send({ permissions: ["orders:view"] });
    expect((await request(app).get("/api/v1/admin/roles").set("Authorization", manager)).status).toBe(403);
  });
  it("rejects cookie mutation without trusted origin/CSRF", async () => {
    expect((await request(app).post("/api/v1/admin/roles").set("Authorization", auth).set("Origin", "https://evil.example").send({ name: "csrf", permissions: [] })).status).toBe(403);
  });
  it("never leaves a user assigned to a concurrently deleted role", async () => {
    const created = await create("racing");
    const id = created.body.data.id;
    await Promise.allSettled([
      createIdentityStore(db).createUser({ kind: "staff", roleId: id, email: "race@example.com" }),
      request(app).delete(`/api/v1/admin/roles/${id}`).set("Authorization", auth).then(response => response.status),
    ]);
    const role = await db.collection("roles").findOne({ _id: new mongoose.Types.ObjectId(id) });
    const user = await db.collection("users").findOne({ email: "race@example.com" });
    expect(!user || !!role).toBe(true);
  });
});
