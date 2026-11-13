import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createDevOtpRoutes } from "../../src/modules/identity/dev-otp.public.js";
import { createIdentityStore } from "../../src/modules/identity/identity.public.js";
import { createConsumerRoutes } from "../../src/modules/identity/consumer.public.js";
import { createSessionRoutes } from "../../src/modules/identity/session.public.js";

let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("consumer_auth_test")).asPromise();
  app = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", "a".repeat(64)) });
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });
beforeEach(async () => { vi.spyOn(Date, "now").mockReturnValue(Date.now()); await db.collection("otp_limits").deleteMany({}); });
afterEach(() => vi.restoreAllMocks());
async function login(phone: string, kind = "customer") {
  expect((await request(app).post("/api/v1/auth/request-otp").send({ phone, app: kind })).status).toBe(200);
  return request(app).post("/api/v1/auth/verify-otp").set("X-Client", kind === "rider" ? "rider-app" : "customer-app").send({ phone, otp: "000000" });
}
describe("customer and rider F01 endpoints", () => {
  it("issues native credentials, normalizes the profile and accepts only own editable fields", async () => {
    const response = await login("9800000001");
    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.data.isNewUser).toBe(true);
    expect(response.headers["set-cookie"]).toBeUndefined();
    const auth = `Bearer ${response.body.data.accessToken}`;
    const profile = await request(app).put("/api/v1/me").set("Authorization", auth).send({ name: "Asha Rai", email: " ASHA@example.com " });
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ name: "Asha Rai", email: "asha@example.com", codAllowed: true, defaultAddressId: null });
    expect((await request(app).put("/api/v1/me").set("Authorization", auth).send({ roleId: new mongoose.Types.ObjectId().toHexString() })).status).toBe(400);
  });
  it("keeps rider login separate and refuses unknown riders", async () => {
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000002", app: "rider" })).status).toBe(403);
    const role = await db.collection("roles").findOne({ name: "rider" });
    await createIdentityStore(db).createUser({ kind: "rider", roleId: String(role!._id), phone: "+919800000002" });
    const response = await login("9800000002", "rider");
    expect(response.status).toBe(200);
    expect(response.body.data.user.kind).toBe("rider");
    // The same number can also be a customer: a separate customer account is made, and the rider account is untouched.
    const asCustomer = await login("9800000002", "customer");
    expect(asCustomer.status).toBe(200);
    expect(asCustomer.body.data.user.kind).toBe("customer");
    expect(asCustomer.body.data.isNewUser).toBe(true);
    expect(asCustomer.body.data.user.id).not.toBe(response.body.data.user.id);
    expect(await db.collection("users").countDocuments({ phone: "+919800000002" })).toBe(2);
    expect((await login("9800000002", "rider")).body.data.user.id).toBe(response.body.data.user.id);
  });
  it("consumes a login code exactly once under concurrency and stores no plaintext code", async () => {
    const phone = "9800000010";
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone })).status).toBe(200);
    const stored = await db.collection("otps").findOne({ phone: "+919800000010" });
    expect(stored?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toHaveProperty("otp"); expect(stored).not.toHaveProperty("code");
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).post("/api/v1/auth/verify-otp").set("X-Client", "customer-app").send({ phone, otp: "000000" })));
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status === 401)).toHaveLength(7);
    expect(await db.collection("users").countDocuments({ phone: "+919800000010" })).toBe(1);
    const user = await db.collection("users").findOne({ phone: "+919800000010" });
    expect(await db.collection("auth_sessions").countDocuments({ userId: user!._id })).toBe(1);
  });
  it("checks expiry without TTL cleanup and persists failed-attempt lockout across recreation", async () => {
    await request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000011" });
    await db.collection("otps").updateOne({ phone: "+919800000011" }, { $set: { expiresAt: new Date(0) } });
    const expired = await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9800000011", otp: "000000" });
    expect(expired.status).toBe(400); expect(expired.body.error.code).toBe("OTP_EXPIRED");
    await request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000012" });
    for (let i = 0; i < 5; i++) {
      const response = await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9800000012", otp: "111111" });
      expect(response.status).toBe(i < 4 ? 401 : 429);
      expect(response.body.error.details.attemptsLeft).toBe(4 - i);
    }
    const recreated = createApp({ additionalRoutes: await createDevOtpRoutes(db, "development", "a".repeat(64)) });
    expect((await request(recreated).post("/api/v1/auth/verify-otp").send({ phone: "9800000012", otp: "000000" })).body.error.code).toBe("OTP_LOCKED");
    expect((await request(recreated).post("/api/v1/auth/request-otp").send({ phone: "9800000012" })).body.error.code).toBe("OTP_LOCKED");
  });
  it("limits requests across phones per IP and hashes quota keys", async () => {
    for (let i = 0; i < 5; i++) expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: `980000002${i}` })).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000025" })).body.error.code).toBe("RATE_LIMITED");
    expect(await db.collection("otp_limits").findOne({ _id: /phone:/ })).toBeNull();
  });
  it("supports native refresh/logout and revokes every session on refresh replay", async () => {
    const first = (await login("9800000030")).body.data;
    const second = (await login("9800000030")).body.data;
    const refreshed = await request(app).post("/api/v1/auth/refresh").set("X-Client", "customer-app").send({ refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200); expect(refreshed.headers["set-cookie"]).toBeUndefined();
    expect(refreshed.body.data.refreshToken).not.toBe(first.refreshToken);
    expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${first.accessToken}`)).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken })).body.error.code).toBe("REFRESH_REUSED");
    for (const token of [refreshed.body.data.accessToken, second.accessToken]) expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    const third = (await login("9800000030")).body.data;
    expect(third.isNewUser).toBe(false);
    expect((await request(app).post("/api/v1/auth/logout").send({ refreshToken: third.refreshToken })).status).toBe(200);
    expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${third.accessToken}`)).status).toBe(401);
  });
  it("does not expose tokens to browser clients or let a native header bypass CSRF", async () => {
    const agent = request.agent(app);
    const headers = { Origin: "http://localhost:3000", "X-CSRF-Token": "1", "X-Client": "web" };
    expect((await agent.post("/api/v1/auth/request-otp").set(headers).send({ phone: "9800000031" })).status).toBe(200);
    const verified = await agent.post("/api/v1/auth/verify-otp").set({ Origin: headers.Origin, "X-CSRF-Token": "1" }).send({ phone: "9800000031", otp: "000000" });
    expect(verified.status).toBe(200); expect(verified.body.data).not.toHaveProperty("accessToken"); expect(verified.body.data).not.toHaveProperty("refreshToken");
    expect((await agent.get("/api/v1/me")).status).toBe(200);
    expect((await agent.put("/api/v1/me").set("X-Client", "customer-app").send({ name: "Forged" })).status).toBe(403);
    expect((await agent.post("/api/v1/auth/refresh").set({ ...headers, "X-Client": "customer-app" }).send({ refreshToken: "a".repeat(64) })).status).toBe(400);
    expect((await agent.post("/api/v1/auth/refresh").set(headers)).status).toBe(200);
  });
  it("binds phone-change codes to their purpose and user and ends other sessions", async () => {
    const first = (await login("9800000040")).body.data;
    const second = (await login("9800000040")).body.data;
    const auth = `Bearer ${first.accessToken}`;
    expect((await request(app).post("/api/v1/me/phone/request-otp").set("Authorization", auth).send({ phone: "9800000041" })).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/verify-otp").send({ phone: "9800000041", otp: "000000" })).status).toBe(401);
    const changed = await request(app).post("/api/v1/me/phone/verify").set("Authorization", auth).send({ phone: "9800000041", otp: "000000" });
    expect(changed.status).toBe(200); expect(changed.body.data.phone).toBe("+919800000041");
    expect((await request(app).get("/api/v1/me").set("Authorization", auth)).status).toBe(200);
    expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${second.accessToken}`)).status).toBe(401);
    expect((await request(app).post("/api/v1/me/phone/verify").set("Authorization", auth).send({ phone: "9800000041", otp: "000000" })).status).toBe(401);
  });
  it("permits only one simultaneous claimant of a new phone number", async () => {
    const accounts = await Promise.all([login("9800000042"), login("9800000043")]);
    for (const account of accounts) expect((await request(app).post("/api/v1/me/phone/request-otp").set("Authorization", `Bearer ${account.body.data.accessToken}`).send({ phone: "9800000044" })).status).toBe(200);
    const responses = await Promise.all(accounts.map(account => request(app).post("/api/v1/me/phone/verify").set("Authorization", `Bearer ${account.body.data.accessToken}`).send({ phone: "9800000044", otp: "000000" })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await db.collection("users").countDocuments({ phone: "+919800000044" })).toBe(1);
  });
  it("registers and removes only caller-owned devices and enforces app kind", async () => {
    const a = (await login("9800000050")).body.data, b = (await login("9800000051")).body.data;
    const body = { fcmToken: "fcm_test:123", app: "customer", platform: "android", appVersion: "1.4.2" };
    const call = (token: string) => request(app).post("/api/v1/devices").set("Authorization", `Bearer ${token}`);
    expect((await call(a.accessToken).send(body)).status).toBe(200);
    expect((await call(a.accessToken).send({ ...body, appVersion: "1.4.3" })).status).toBe(200);
    expect((await call(b.accessToken).send(body)).status).toBe(409);
    expect((await call(a.accessToken).send({ ...body, app: "rider" })).status).toBe(403);
    await request(app).delete(`/api/v1/devices/${body.fcmToken}`).set("Authorization", `Bearer ${b.accessToken}`);
    expect((await db.collection("device_tokens").findOne({ fcmToken: body.fcmToken }))?.userId.toString()).toBe(a.user.id);
    expect((await request(app).delete(`/api/v1/devices/${body.fcmToken}`).set("Authorization", `Bearer ${a.accessToken}`)).status).toBe(200);
    expect((await call(b.accessToken).send(body)).status).toBe(200);
  });
  it("records deletion, removes push tokens and revokes access, refresh and pending OTPs", async () => {
    const first = (await login("9800000060")).body.data, second = (await login("9800000060")).body.data;
    const auth = `Bearer ${first.accessToken}`;
    await request(app).post("/api/v1/devices").set("Authorization", auth).send({ fcmToken: "deletion-device", app: "customer", platform: "ios", appVersion: "1.0.0" });
    await request(app).post("/api/v1/me/phone/request-otp").set("Authorization", auth).send({ phone: "9800000061" });
    const deleted = await request(app).post("/api/v1/me/delete-request").set("Authorization", auth).send({ reason: "Moving away" });
    expect(deleted.status).toBe(200); expect(deleted.body.data.status).toBe("deletion_requested");
    const userId = new mongoose.Types.ObjectId(first.user.id);
    expect(await db.collection("device_tokens").countDocuments({ userId })).toBe(0);
    expect(await db.collection("otps").countDocuments({ userId })).toBe(0);
    expect((await db.collection("users").findOne({ _id: userId }))?.deletionRequest.reason).toBe("Moving away");
    for (const token of [first.accessToken, second.accessToken]) expect((await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: second.refreshToken })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000060" })).status).toBe(403);
  });
  it("keeps fixed OTP unavailable outside the explicit development guard", async () => {
    await expect(createConsumerRoutes(db, "a".repeat(64), { mode: "production", mockOTP: true })).rejects.toThrow("development");
    await expect(createConsumerRoutes(db.useDb("production"), "a".repeat(64), { mode: "development", mockOTP: true })).rejects.toThrow("_dev");
    const production = createApp({ additionalRoutes: await createConsumerRoutes(db, "a".repeat(64), { mode: "production", mockOTP: false }) });
    for (const path of ["request-otp", "verify-otp"]) expect((await request(production).post(`/api/v1/auth/${path}`).send({ phone: "9800000070", ...(path === "verify-otp" && { otp: "000000" }) })).status).toBe(503);
  });
  it("allows only one concurrent OTP request and keeps phone-change codes private to the requester", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000080" })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 429, 429, 429, 429]);
    await db.collection("otp_limits").deleteMany({});
    const a = (await login("9800000081")).body.data, b = (await login("9800000082")).body.data;
    await request(app).post("/api/v1/me/phone/request-otp").set("Authorization", `Bearer ${a.accessToken}`).send({ phone: "9800000083" });
    expect((await request(app).post("/api/v1/me/phone/verify").set("Authorization", `Bearer ${b.accessToken}`).send({ phone: "9800000083", otp: "000000" })).status).toBe(401);
    expect((await request(app).post("/api/v1/me/phone/verify").set("Authorization", `Bearer ${a.accessToken}`).send({ phone: "9800000083", otp: "000000" })).status).toBe(200);
  });
  it("supports an injected real transport with WhatsApp-to-SMS fallback without accepting the mock code", async () => {
    const sent: { code: string; channel: string }[] = [];
    const routes = await createConsumerRoutes(db, "a".repeat(64), { mode: "production", mockOTP: false, transport: { async send(input) { sent.push({ code: input.code, channel: input.channel }); if (input.channel === "whatsapp") throw new Error("Provider failure"); } } });
    const production = createApp({ additionalRoutes: [...routes, ...createSessionRoutes(db, "a".repeat(64), [], false)] });
    const mocked = (await login("9800000072")).body.data;
    expect((await request(production).get("/api/v1/me").set("Authorization", `Bearer ${mocked.accessToken}`)).status).toBe(401);
    expect((await request(production).post("/api/v1/auth/request-otp").send({ phone: "9800000072" })).status).toBe(403);
    const requested = await request(production).post("/api/v1/auth/request-otp").send({ phone: "9800000071" });
    expect(requested.status).toBe(200); expect(requested.body.data.channel).toBe("sms");
    expect(sent.map(item => item.channel)).toEqual(["whatsapp", "sms"]); expect(sent[1]!.code).not.toBe("000000");
    expect((await request(production).post("/api/v1/auth/verify-otp").send({ phone: "9800000071", otp: "000000" })).status).toBe(401);
    const verified = await request(production).post("/api/v1/auth/verify-otp").set("X-Client", "customer-app").send({ phone: "9800000071", otp: sent[1]!.code });
    expect(verified.status).toBe(200); expect(verified.body.data).not.toHaveProperty("mockOTP");
  });
});
