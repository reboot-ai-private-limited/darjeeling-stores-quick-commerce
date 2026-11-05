import { createHash } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";
import { loadConfig } from "../../src/config/env.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
const origin = "http://localhost:3000";
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("cookie_auth_test")).asPromise();
  app = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", "a".repeat(64)) });
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });

async function login(target = app) {
  const agent = request.agent(target);
  await agent.post("/api/v1/auth/request-otp").send({ phone: "9000000001", app: "admin" });
  const response = await agent.post("/api/v1/auth/verify-otp").set("Origin", origin).set("X-CSRF-Token", "1").set("X-Client", "admin").send({ phone: "9000000001", otp: "000000" });
  expect(response.status).toBe(200);
  return { agent, response };
}
const cookies = (response: { headers: Record<string, unknown> }) => response.headers["set-cookie"] as string[];
const refresh = (values: string[]) => values.find(value => value.startsWith("ds_refresh="))!.split(";")[0]!;

describe("browser session cookies", () => {
  it("uses configured cookie flags and token lifetimes", async () => {
    const config = loadConfig({ MONGODB_URI: "mongodb://localhost/cookie_auth_test", NODE_ENV: "development", ACCESS_TOKEN_TTL: "1m", REFRESH_TOKEN_TTL: "1h", AUTH_COOKIE_SECURE: "true", AUTH_COOKIE_SAME_SITE: "lax" });
    const configuredApp = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", "a".repeat(64), [origin], config.AUTH_COOKIE_SECURE, config) });
    const { response } = await login(configuredApp);
    expect(response.body.data.accessTokenExpiresInSeconds).toBe(60);
    expect(cookies(response)[0]).toContain("Max-Age=60;");
    for (const cookie of cookies(response)) { expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("HttpOnly"); }
    const refreshMaxAge = Number(cookies(response)[1]!.match(/Max-Age=(\d+)/)![1]);
    expect(refreshMaxAge).toBeGreaterThanOrEqual(3590);
    expect(refreshMaxAge).toBeLessThanOrEqual(3600);
  });
  it("sets both HttpOnly Strict cookies without exposing tokens in browser JSON", async () => {
    const { agent, response } = await login();
    expect(cookies(response)).toHaveLength(2);
    for (const cookie of cookies(response)) { expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict"); }
    expect(cookies(response)[0]).toContain("Path=/api/v1;");
    expect(cookies(response)[1]).toContain("Path=/api/v1/auth;");
    expect(response.body.data).not.toHaveProperty("accessToken");
    expect(response.body.data).not.toHaveProperty("refreshToken");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await agent.get("/api/v1/me")).body.data.role).toBe("super_admin");
    expect((await agent.get("/api/v1/admin/permissions")).status).toBe(200);
  });
  it("rejects missing CSRF/untrusted origin without consuming refresh, then rotates and detects replay", async () => {
    const { agent, response } = await login();
    const oldRefresh = refresh(cookies(response));
    expect((await agent.post("/api/v1/auth/refresh").set("Origin", origin)).status).toBe(403);
    expect((await agent.post("/api/v1/auth/refresh").set("Origin", "https://evil.example").set("X-CSRF-Token", "1")).status).toBe(403);
    const rotated = await agent.post("/api/v1/auth/refresh").set("Origin", origin).set("X-CSRF-Token", "1");
    expect(rotated.status).toBe(200);
    expect(refresh(cookies(rotated))).not.toBe(oldRefresh);
    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", oldRefresh).set("Origin", origin).set("X-CSRF-Token", "1");
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("REFRESH_REUSED");
    expect((await agent.get("/api/v1/me")).status).toBe(401);
  });
  it("can refresh an expired access token but not a deactivated user", async () => {
    const { agent, response } = await login();
    const accessCookie = cookies(response)[0]!.split(";")[0]!.slice("ds_access=".length);
    await db.collection("auth_sessions").updateOne({ accessHash: createHash("sha256").update(accessCookie).digest("hex") }, { $set: { accessExpiresAt: new Date(0) } });
    expect((await agent.get("/api/v1/me")).status).toBe(401);
    expect((await agent.post("/api/v1/auth/refresh").set("Origin", origin).set("X-CSRF-Token", "1")).status).toBe(200);
    expect((await agent.get("/api/v1/me")).status).toBe(200);
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $set: { status: "deactivated" } });
    expect((await agent.post("/api/v1/auth/refresh").set("Origin", origin).set("X-CSRF-Token", "1")).status).toBe(401);
    await db.collection("users").updateOne({ phone: "+919000000001" }, { $set: { status: "active" } });
    expect((await agent.get("/api/v1/me")).status).toBe(401);
  });
  it("protects logout, clears cookies and revokes both tokens", async () => {
    const { agent, response } = await login();
    expect((await agent.post("/api/v1/auth/logout")).status).toBe(403);
    const loggedOut = await agent.post("/api/v1/auth/logout").set("Origin", origin).set("X-CSRF-Token", "1");
    expect(loggedOut.status).toBe(200);
    expect(cookies(loggedOut).every(value => value.includes("Expires=Thu, 01 Jan 1970"))).toBe(true);
    expect((await agent.get("/api/v1/me")).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", refresh(cookies(response))).set("Origin", origin).set("X-CSRF-Token", "1")).status).toBe(401);
  });
  it("sets Secure when configured and rejects cookie-login CSRF", async () => {
    const secureApp = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", "a".repeat(64), [origin], true) });
    await request(secureApp).post("/api/v1/auth/request-otp").send({ phone: "9000000001", app: "admin" });
    expect((await request(secureApp).post("/api/v1/auth/verify-otp").set("Origin", "https://evil.example").send({ phone: "9000000001", otp: "000000" })).status).toBe(403);
    const result = await request(secureApp).post("/api/v1/auth/verify-otp").set("Origin", origin).set("X-CSRF-Token", "1").set("X-Client", "admin").send({ phone: "9000000001", otp: "000000" });
    expect(result.status).toBe(200);
    expect(cookies(result).every(value => value.includes("Secure"))).toBe(true);
  });
});
