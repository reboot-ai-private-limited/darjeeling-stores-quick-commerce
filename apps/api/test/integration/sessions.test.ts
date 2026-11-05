import { createHash } from "node:crypto";
import { SignJWT, decodeJwt } from "jose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionStore } from "../../src/modules/identity/infrastructure/sessions.js";

let replica: MongoMemoryReplSet;
let db: mongoose.Connection;
let store: ReturnType<typeof createSessionStore>;
const userId = new mongoose.Types.ObjectId();
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(replica.getUri("sessions_test")).asPromise();
  store = createSessionStore(db, "a".repeat(64));
  await store.initialize();
}, 120000);
afterAll(async () => { await db?.close(); await replica?.stop(); });

describe("dual token sessions", () => {
  it("uses configured lifetimes and JWT claims for issuance and refresh", async () => {
    const configured = createSessionStore(db, "a".repeat(64), { ACCESS_TOKEN_TTL: "1m", REFRESH_TOKEN_TTL: "1h", JWT_ISSUER: "configured-api", JWT_AUDIENCE: "configured-client" });
    const before = Date.now();
    const pair = await configured.issue(userId);
    const claims = decodeJwt(pair.accessToken);
    expect(claims).toMatchObject({ iss: "configured-api", aud: "configured-client" });
    expect(claims.exp! - claims.iat!).toBe(60);
    expect(pair.accessTokenExpiresInSeconds).toBe(60);
    expect(pair.refreshExpiresAt.getTime() - before).toBeGreaterThanOrEqual(3600000);
    expect(pair.refreshExpiresAt.getTime() - before).toBeLessThan(3602000);
    expect(await configured.authenticate(pair.accessToken)).not.toBeNull();
    expect(await store.authenticate(pair.accessToken)).toBeNull();
    const rotated = await configured.rotate(pair.refreshToken);
    if ("error" in rotated) throw new Error(rotated.error);
    expect(rotated.accessTokenExpiresInSeconds).toBe(60);
    expect(rotated.refreshExpiresAt).toEqual(pair.refreshExpiresAt);
  });
  it("issues JWT access tokens and rejects invalid signatures and claims even when their hash is stored", async () => {
    const pair = await store.issue(userId);
    expect(decodeJwt(pair.accessToken)).toMatchObject({ sub: userId.toHexString(), iss: "darjeeling-stores-api", aud: "darjeeling-stores-clients" });
    const variants = [
      { issuer: "wrong", audience: "darjeeling-stores-clients", algorithm: "HS256", expiry: "15m", type: "at+jwt", key: "a" },
      { issuer: "darjeeling-stores-api", audience: "wrong", algorithm: "HS256", expiry: "15m", type: "at+jwt", key: "a" },
      { issuer: "darjeeling-stores-api", audience: "darjeeling-stores-clients", algorithm: "HS384", expiry: "15m", type: "at+jwt", key: "a" },
      { issuer: "darjeeling-stores-api", audience: "darjeeling-stores-clients", algorithm: "HS256", expiry: "-1s", type: "at+jwt", key: "a" },
      { issuer: "darjeeling-stores-api", audience: "darjeeling-stores-clients", algorithm: "HS256", expiry: "15m", type: "refresh+jwt", key: "a" },
      { issuer: "darjeeling-stores-api", audience: "darjeeling-stores-clients", algorithm: "HS256", expiry: "15m", type: "at+jwt", key: "b" },
    ];
    const refreshHash = createHash("sha256").update(pair.refreshToken).digest("hex");
    for (const variant of variants) {
      const token = await new SignJWT({}).setProtectedHeader({ alg: variant.algorithm, typ: variant.type }).setSubject(userId.toHexString()).setJti("test").setIssuedAt().setExpirationTime(variant.expiry).setIssuer(variant.issuer).setAudience(variant.audience).sign(Buffer.from(variant.key.repeat(64), "hex"));
      await db.collection("auth_sessions").updateOne({ refreshHash }, { $set: { accessHash: createHash("sha256").update(token).digest("hex") } });
      expect(await store.authenticate(token)).toBeNull();
    }
    expect(() => createSessionStore(db, "short")).toThrow("JWT_SECRET");
  });
  it("stores hashes only, survives store recreation and revokes both credentials on logout", async () => {
    const pair = await store.issue(userId);
    expect((await createSessionStore(db, "a".repeat(64)).authenticate(pair.accessToken))?.toHexString()).toBe(userId.toHexString());
    const persisted = JSON.stringify(await db.collection("auth_sessions").findOne({ userId }));
    expect(persisted).not.toContain(pair.accessToken);
    expect(persisted).not.toContain(pair.refreshToken);
    await store.revoke(pair.accessToken, pair.refreshToken);
    expect(await store.authenticate(pair.accessToken)).toBeNull();
    expect(await store.rotate(pair.refreshToken)).toMatchObject({ error: "UNAUTHORIZED" });
  });
  it("rotates credentials and replay revokes the winning session family", async () => {
    const first = await store.issue(userId);
    const rotated = await store.rotate(first.refreshToken);
    if ("error" in rotated) throw new Error(rotated.error);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(await store.authenticate(first.accessToken)).toBeNull();
    expect(await store.authenticate(rotated.accessToken)).not.toBeNull();
    expect(await store.rotate(first.refreshToken)).toMatchObject({ error: "REFRESH_REUSED" });
    expect(await store.authenticate(rotated.accessToken)).toBeNull();
  });
  it("allows only one concurrent refresh winner and invalidates the family after replay", async () => {
    const pair = await store.issue(userId);
    const results = await Promise.all([store.rotate(pair.refreshToken), store.rotate(pair.refreshToken)]);
    expect(results.filter(result => !("error" in result))).toHaveLength(1);
    expect(results.filter(result => "error" in result && result.error === "REFRESH_REUSED")).toHaveLength(1);
    const winner = results.find(result => !("error" in result));
    if (!winner || "error" in winner) throw new Error("Missing winner");
    expect(await store.authenticate(winner.accessToken)).toBeNull();
  });
  it("checks expiry without TTL cleanup and preserves unrelated session families", async () => {
    const first = await store.issue(userId);
    const other = await store.issue(userId);
    await db.collection("auth_sessions").updateOne({ refreshHash: createHash("sha256").update(first.refreshToken).digest("hex") }, { $set: { accessExpiresAt: new Date(0) } });
    expect(await store.authenticate(first.accessToken)).toBeNull();
    const rotated = await store.rotate(first.refreshToken);
    if ("error" in rotated) throw new Error(rotated.error);
    expect(await store.authenticate(rotated.accessToken)).not.toBeNull();
    await db.collection("auth_sessions").updateOne({ refreshHash: createHash("sha256").update(rotated.refreshToken).digest("hex") }, { $set: { expiresAt: new Date(0) } });
    expect(await store.rotate(rotated.refreshToken)).toMatchObject({ error: "UNAUTHORIZED" });
    expect(await store.authenticate(other.accessToken)).not.toBeNull();
  });
});
