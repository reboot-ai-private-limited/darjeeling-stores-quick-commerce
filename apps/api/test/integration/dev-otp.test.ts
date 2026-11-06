import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("mock_otp_test")).asPromise();
  app = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", "a".repeat(64)) });
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });

describe("development mock OTP", () => {
  it("refuses nondevelopment mode and leaves mock routes absent by default", async () => {
    await expect(createDevOtpRoutes(db, "production", "a".repeat(64))).rejects.toThrow("development");
    const unsafeDb = db.useDb("production");
    await expect(createDevOtpRoutes(unsafeDb, "development", "a".repeat(64))).rejects.toThrow("_dev");
    expect((await request(createApp()).post("/api/v1/auth/request-otp").send({ phone: "9000000001" })).status).toBe(404);
  });
  it("logs the seeded super admin in, consumes the challenge and logs out", async () => {
    const body = { phone: "9000000001", otp: "000000" };
    expect((await request(app).post("/api/v1/auth/verify-otp").send(body)).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000001", app: "admin" })).status).toBe(200);
    const verified = await request(app).post("/api/v1/auth/verify-otp").send(body);
    expect(verified.status).toBe(200);
    expect(verified.body.data.user).toMatchObject({ phone: "+919000000001", role: "super_admin", scope: { all: true } });
    expect((await request(app).post("/api/v1/auth/verify-otp").send(body)).status).toBe(401);
    const token = verified.body.data.accessToken;
    expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${token}`);
    expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    await createDevOtpRoutes(db, "development", "a".repeat(64));
    expect(await db.collection("users").countDocuments({ phone: "+919000000001" })).toBe(1);
  });
  it("uses the same mock code for customers without granting admin access", async () => {
    await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000002" });
    const verified = await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000002", otp: "000000" });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user).toMatchObject({ role: "customer", scope: { all: false, warehouseIds: [] } });
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000003", app: "admin" })).status).toBe(403);
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000003", app: "rider" })).status).toBe(403);
  });
  it("enforces current permissions and scope on the server", async () => {
    expect((await request(app).get("/api/v1/admin/permissions")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/roles")).status).toBe(401);
    await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000001", app: "admin" });
    const login = await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000001", otp: "000000" });
    const auth = `Bearer ${login.body.data.accessToken}`;
    expect((await request(app).get("/api/v1/admin/permissions").set("Authorization", auth)).status).toBe(200);
    const roleList = await request(app).get("/api/v1/admin/roles").set("Authorization", auth);
    expect(roleList.status).toBe(200);
    expect(roleList.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ name: "super_admin", permissions: ["*"], isSystem: true })]));
    expect(Object.keys(roleList.body.data[0]).sort()).toEqual(["id", "isSystem", "name", "permissions"]);
    const id = roleList.body.data.find((role: { name: string }) => role.name === "super_admin").id;
    const detail = await request(app).get(`/api/v1/admin/roles/${id}`).set("Authorization", auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id, name: "super_admin", isSystem: true });
    expect(Object.keys(detail.body.data).sort()).toEqual(["id", "isSystem", "name", "permissions"]);
    expect(detail.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/api/v1/admin/roles/invalid").set("Authorization", auth)).status).toBe(404);
    expect((await request(app).get("/api/v1/admin/roles/000000000000000000000000").set("Authorization", auth)).status).toBe(404);
    expect((await request(app).get(`/api/v1/admin/roles/${id}`)).status).toBe(401);
    await db.collection("roles").updateOne({ name: "super_admin" }, { $set: { permissions: [] } });
    expect((await request(app).get("/api/v1/admin/permissions").set("Authorization", auth)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/roles").set("Authorization", auth)).status).toBe(403);
    await db.collection("roles").updateOne({ name: "super_admin" }, { $set: { permissions: ["*"] } });
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $set: { scope: { all: false, warehouseIds: [] } } });
    expect((await request(app).get("/api/v1/admin/permissions").set("Authorization", auth)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/roles").set("Authorization", auth)).status).toBe(403);
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $set: { scope: { all: true, warehouseIds: [] } } });
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $set: { status: "deactivated" } });
    expect((await request(app).get("/api/v1/admin/permissions").set("Authorization", auth)).status).toBe(401);
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $set: { status: "active" } });
  });
  it("rejects wrong codes and exhausts the challenge after five attempts", async () => {
    await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000004" });
    for (let i = 0; i < 4; i++) expect((await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000004", otp: "123456" })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000004", otp: "123456" })).status).toBe(429);
    expect((await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000004", otp: "000000" })).status).toBe(429);
  });
  it("never promotes an existing account into the development owner", async () => {
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $unset: { devMockAccount: "" } });
    await expect(createDevOtpRoutes(db, "development", "a".repeat(64))).rejects.toThrow("Refusing to replace");
  });
});
