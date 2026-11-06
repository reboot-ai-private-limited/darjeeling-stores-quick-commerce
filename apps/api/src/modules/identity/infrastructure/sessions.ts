import { createHash, randomBytes } from "node:crypto";
import { Types, type ClientSession, type Connection } from "mongoose";
import { SignJWT, jwtVerify } from "jose";
import { durationSeconds, sessionSettings } from "../../../config/env.js";
import { nextStaffAction } from "../domain/staff-auth-policy.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const secret = () => randomBytes(32).toString("hex");
type Session = {
  _id: Types.ObjectId; userId: Types.ObjectId; accessHash: string; refreshHash: string;
  usedRefreshHashes: string[]; accessExpiresAt: Date; expiresAt: Date; revokedAt: Date | null;
};

export function createSessionStore(connection: Connection, jwtSecret: string, options: Partial<ReturnType<typeof sessionSettings.parse>> = {}) {
  const settings = sessionSettings.parse(options);
  const accessSeconds = durationSeconds(settings.ACCESS_TOKEN_TTL);
  const accessLifetime = accessSeconds * 1000;
  const refreshLifetime = durationSeconds(settings.REFRESH_TOKEN_TTL) * 1000;
  if (!/^[a-f0-9]{64}$/i.test(jwtSecret)) throw new Error("JWT_SECRET must be a random 32-byte hex key");
  const key = Buffer.from(jwtSecret, "hex");
  const issuer = settings.JWT_ISSUER;
  const audience = settings.JWT_AUDIENCE;
  const signAccess = (userId: Types.ObjectId) => new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" }).setIssuer(issuer).setAudience(audience)
    .setSubject(userId.toHexString()).setJti(secret()).setIssuedAt().setExpirationTime(`${accessSeconds}s`).sign(key);
  if (!connection.db) throw new Error("Session store requires a connected database");
  const sessions = connection.db.collection<Session>("auth_sessions");
  async function credentialsReady(userId: Types.ObjectId, session?: ClientSession) {
    const options = session ? { session } : {};
    const user = await connection.collection("users").findOne({ _id: userId }, options);
    if (!user || user.kind !== "staff" || user.devMockAccount) return true;
    if (user.status !== "active") return false;
    const role = await connection.collection("roles").findOne({ _id: user.roleId }, options);
    return !!role && !nextStaffAction({ ...user, kind: "staff" }, role.name);
  }
  return {
    async initialize() {
      await sessions.createIndex({ accessHash: 1 }, { unique: true });
      await sessions.createIndex({ refreshHash: 1 }, { unique: true });
      await sessions.createIndex({ usedRefreshHashes: 1 });
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await sessions.createIndex({ userId: 1, revokedAt: 1 });
    },
    async issue(userId: Types.ObjectId, session?: ClientSession) {
      const accessToken = await signAccess(userId);
      const refreshToken = secret();
      const expiresAt = new Date(Date.now() + refreshLifetime);
      await sessions.insertOne({ _id: new Types.ObjectId(), userId, accessHash: hash(accessToken), refreshHash: hash(refreshToken),
        usedRefreshHashes: [], accessExpiresAt: new Date(Date.now() + accessLifetime), expiresAt, revokedAt: null }, session ? { session } : {});
      return { accessToken, refreshToken, userId, accessTokenExpiresInSeconds: accessLifetime / 1000, refreshExpiresAt: expiresAt };
    },
    async authenticate(token: string, transaction?: ClientSession) {
      if (token.length > 2048) return null;
      let subject: string;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer, audience, typ: "at+jwt", requiredClaims: ["sub", "exp", "iat", "jti"] });
        if (!payload.sub || !/^[a-f0-9]{24}$/.test(payload.sub)) return null;
        subject = payload.sub;
      } catch { return null; }
      const filter = { userId: new Types.ObjectId(subject), accessHash: hash(token), revokedAt: null, accessExpiresAt: { $gt: new Date() }, expiresAt: { $gt: new Date() } };
      const session = transaction
        ? await sessions.findOneAndUpdate(filter, { $inc: { authorizationRevision: 1 } }, { session: transaction, returnDocument: "after" })
        : await sessions.findOne(filter);
      return session && await credentialsReady(session.userId, transaction) ? session.userId : null;
    },
    async rotate(token: string) {
      if (!/^[a-f0-9]{64}$/.test(token)) return { error: "UNAUTHORIZED" as const };
      const previousHash = hash(token);
      const candidate = await sessions.findOne({ refreshHash: previousHash });
      if (candidate && !await credentialsReady(candidate.userId)) {
        await sessions.updateOne({ _id: candidate._id }, { $set: { revokedAt: new Date() } });
        return { error: "UNAUTHORIZED" as const };
      }
      const accessToken = candidate ? await signAccess(candidate.userId) : "";
      const refreshToken = secret();
      // Bound replay history; after 500 rotations the family requires a fresh login.
      const session = candidate ? await sessions.findOneAndUpdate({ refreshHash: previousHash, revokedAt: null, expiresAt: { $gt: new Date() }, "usedRefreshHashes.499": { $exists: false } }, {
        $set: { accessHash: hash(accessToken), refreshHash: hash(refreshToken), accessExpiresAt: new Date(Date.now() + accessLifetime) },
        $push: { usedRefreshHashes: previousHash },
      }, { returnDocument: "after" }) : null;
      if (!session) {
        const replay = await sessions.findOneAndUpdate({ usedRefreshHashes: previousHash, revokedAt: null, expiresAt: { $gt: new Date() } }, { $set: { revokedAt: new Date() } });
        if (replay) return { error: "REFRESH_REUSED" as const };
        await sessions.updateOne({ refreshHash: previousHash }, { $set: { revokedAt: new Date() } });
        return { error: "UNAUTHORIZED" as const };
      }
      return { accessToken, refreshToken, userId: session.userId, accessTokenExpiresInSeconds: accessLifetime / 1000, refreshExpiresAt: session.expiresAt };
    },
    async revoke(accessToken = "", refreshToken = "") {
      const filters = [];
      if (accessToken) filters.push({ accessHash: hash(accessToken) });
      if (refreshToken) filters.push({ refreshHash: hash(refreshToken) }, { usedRefreshHashes: hash(refreshToken) });
      if (filters.length) await sessions.updateMany({ $or: filters }, { $set: { revokedAt: new Date() } });
    },
    async revokeUser(userId: Types.ObjectId, session: ClientSession) {
      await sessions.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session });
    },
  };
}
