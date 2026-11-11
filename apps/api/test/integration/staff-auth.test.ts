import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createAdministrationRoutes } from "../../src/modules/identity/administration.public.js";
import { createStaffAuthRoutes, createStaffAuthService } from "../../src/modules/identity/staff-auth.public.js";
import { createSessionRoutes } from "../../src/modules/identity/session.public.js";

let replica: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
let auth: ReturnType<typeof createStaffAuthService>;
let owner: ReturnType<typeof request.agent>;
let roleId: string;
const key = "a".repeat(64);
const origin = "http://localhost:3000";
const headers = { Origin: origin, "X-CSRF-Token": "1", "X-Client": "admin" };
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(replica.getUri("staff_auth_test")).asPromise();
  const administration = await createAdministrationRoutes(db, key, [origin]);
  app = createApp({ additionalRoutes: [...administration, ...await createStaffAuthRoutes(db, key, [origin], false), ...createSessionRoutes(db, key, [origin], false)] });
  auth = createStaffAuthService(db, key); await auth.initialize();
  const results = await Promise.allSettled([auth.bootstrap({ email: "owner@example.com", name: "Owner", password: "Owner-Temporary-1!" }), auth.bootstrap({ email: "owner@example.com", name: "Owner", password: "Owner-Temporary-1!" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  roleId = String((await db.collection("roles").findOne({ name: "admin" }))!._id);
  owner = request.agent(app);
}, 120000);
beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  await db.collection("staff_login_limits").deleteMany({});
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db?.close(); await replica?.stop(); });
const post = (agent: ReturnType<typeof request.agent>, path: string, body = {}) => agent.post(`/api/v1${path}`).set(headers).send(body);
async function createStaff(email: string) {
  const result = await post(owner, "/admin/staff", { email, name: "Staff", password: "Temporary-Passw0rd!", roleId, scope: { all: true, warehouseIds: [] } });
  expect(result.status).toBe(201);
  return result.body.data.id as string;
}

describe("staff sign-in and the temporary-password change", () => {
  it("bootstraps one owner and withholds normal cookies until the temporary password is changed", async () => {
    const login = await post(owner, "/admin/auth/login", { email: "OWNER@example.com", password: "Owner-Temporary-1!" });
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({ nextAction: "change_password" });
    expect(login.body.data).not.toHaveProperty("accessToken");
    expect((await owner.get("/api/v1/admin/staff")).status).toBe(401);
    expect((await post(owner, "/admin/auth/change-password", { newPassword: "Owner-Temporary-1!" })).status).toBe(400);
    const changed = await post(owner, "/admin/auth/change-password", { newPassword: "Owner-Permanent-1!" });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user).toMatchObject({ kind: "staff", role: "super_admin" });
    expect(changed.body.data).not.toHaveProperty("accessToken");
    expect((await owner.get("/api/v1/admin/staff")).status).toBe(200);
    expect((await owner.get("/api/v1/admin/auth/status")).status).toBe(401);
    await expect(auth.bootstrap({ email: "another@example.com", name: "Other", password: "Other-Temporary-1!" })).rejects.toThrow("owner already exists");
  });
  it("signs the owner in with the password alone and rejects untrusted browser logins and wrong passwords", async () => {
    expect((await request(app).post("/api/v1/admin/auth/login").set("Origin", "https://evil.example").send({ email: "owner@example.com", password: "Owner-Permanent-1!" })).status).toBe(403);
    expect((await post(request.agent(app), "/admin/auth/login", { email: "owner@example.com", password: "wrong" })).body.error.code).toBe("INVALID_CREDENTIALS");
    const agent = request.agent(app);
    const login = await post(agent, "/admin/auth/login", { email: "owner@example.com", password: "Owner-Permanent-1!" });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe("super_admin");
    expect((await agent.get("/api/v1/admin/staff")).status).toBe(200);
  });
  it("changes a staff temporary password, restores sessions, then enforces an admin password reset", async () => {
    const id = await createStaff("staff@example.com");
    const agent = request.agent(app);
    expect((await post(agent, "/admin/auth/login", { email: "staff@example.com", password: "Temporary-Passw0rd!" })).body.data.nextAction).toBe("change_password");
    const changed = await post(agent, "/admin/auth/change-password", { newPassword: "Staff-Permanent-1!" });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.role).toBe("admin");
    expect((await agent.get("/api/v1/me")).body.data.email).toBe("staff@example.com");
    expect((await agent.get("/api/v1/me/access")).body.data.permissions).toContain("catalog:view");
    expect((await post(agent, "/auth/refresh")).status).toBe(200);
    expect((await post(owner, `/admin/staff/${id}/reset-password`, { newPassword: "Reset-Temporary-1!" })).status).toBe(200);
    expect((await agent.get("/api/v1/me")).status).toBe(401);
    expect((await post(agent, "/auth/refresh")).status).toBe(401);
    expect((await post(agent, "/admin/auth/login", { email: "staff@example.com", password: "Reset-Temporary-1!" })).body.data.nextAction).toBe("change_password");
    expect((await post(agent, "/admin/auth/change-password", { newPassword: "Staff-Permanent-2!" })).status).toBe(200);
    expect((await agent.get("/api/v1/me")).status).toBe(200);
    expect((await post(agent, "/auth/logout")).status).toBe(200);
    expect((await agent.get("/api/v1/me")).status).toBe(401);
  }, 15000);
  it("expires and cancels the temporary-password challenge", async () => {
    await createStaff("expiry@example.com");
    const agent = request.agent(app);
    await post(agent, "/admin/auth/login", { email: "expiry@example.com", password: "Temporary-Passw0rd!" });
    const user = await db.collection("users").findOne({ email: "expiry@example.com" });
    await db.collection("staff_auth_challenges").updateMany({ userId: user!._id }, { $set: { expiresAt: new Date(0) } });
    expect((await agent.get("/api/v1/admin/auth/status")).status).toBe(401);
    await post(agent, "/admin/auth/login", { email: "expiry@example.com", password: "Temporary-Passw0rd!" });
    expect((await post(agent, "/admin/auth/cancel")).status).toBe(200);
    expect((await agent.get("/api/v1/admin/auth/status")).status).toBe(401);
  });
  it("locks repeated bad account credentials durably without disclosing account existence", async () => {
    for (let i = 0; i < 5; i++) expect((await post(request.agent(app), "/admin/auth/login", { email: "missing@example.com", password: "wrong" })).body.error.code).toBe("INVALID_CREDENTIALS");
    const blocked = await post(request.agent(app), "/admin/auth/login", { email: "missing@example.com", password: "wrong" });
    expect(blocked.status).toBe(429); expect(blocked.body.error.code).toBe("ACCOUNT_LOCKED");
    expect(blocked.headers["retry-after"]).toBe("900");
    const persisted = await db.collection("staff_login_limits").findOne({ count: 5 });
    expect(persisted).not.toHaveProperty("email");
    await expect(createStaffAuthService(db, key).login({ email: "missing@example.com", password: "wrong" }, "::ffff:127.0.0.1")).rejects.toThrow("Too many failed");
  }, 15000);
  it("limits total login attempts per IP independently of the account", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await post(request.agent(app), "/admin/auth/login", { email: `ip-limit-${i}@example.com`, password: "wrong" })).status).toBe(401);
    }
    const response = await post(request.agent(app), "/admin/auth/login", { email: "owner@example.com", password: "Owner-Permanent-1!" });
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
  }, 30000);
});
