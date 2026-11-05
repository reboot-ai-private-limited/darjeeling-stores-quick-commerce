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
  app = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development") });
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });

describe("development mock OTP", () => {
  it("refuses nondevelopment mode and leaves mock routes absent by default", async () => {
    await expect(createDevOtpRoutes(db, "production")).rejects.toThrow("development");
    const unsafeDb = db.useDb("production");
    await expect(createDevOtpRoutes(unsafeDb, "development")).rejects.toThrow("_dev");
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
    await createDevOtpRoutes(db, "development");
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
  it("rejects wrong codes and exhausts the challenge after five attempts", async () => {
    await request(app).post("/api/v1/auth/request-otp").send({ phone: "9000000004" });
    for (let i = 0; i < 5; i++) expect((await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000004", otp: "123456" })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9000000004", otp: "000000" })).status).toBe(401);
  });
  it("never promotes an existing account into the development owner", async () => {
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $unset: { devMockAccount: "" } });
    await expect(createDevOtpRoutes(db, "development")).rejects.toThrow("Refusing to replace");
  });
});
