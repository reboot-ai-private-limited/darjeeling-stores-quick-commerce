import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Types, type ClientSession, type Connection } from "mongoose";
import { createAccessStore } from "../../access/access.public.js";
import { createAuditWriter } from "../../audit/audit.public.js";
import { sessionSettings } from "../../../config/env.js";
import { nextStaffAction } from "../domain/staff-auth-policy.js";
import { StaffError } from "../domain/staff-policy.js";
import { createSecretCipher, hashPassword, newTotpSecret, totpStep, verifyPassword } from "./credentials.js";
import { createSessionStore } from "./sessions.js";

type User = { _id: Types.ObjectId; kind: string; email: string; name: string; roleId: Types.ObjectId; status: string;
  passwordHash?: string; credentialRevision?: number; mustChangePassword?: boolean; devMockAccount?: boolean;
  scope?: { all: boolean; warehouseIds: Types.ObjectId[] }; lastLoginAt?: Date;
  twoFactor?: { enabled: boolean; requiresEnrollment?: boolean; secretEncrypted?: string; lastUsedStep?: number } };
type Challenge = { _id: string; userId: Types.ObjectId; revision: number; expiresAt: Date; attempts: number; pendingSecretEncrypted?: string };
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const ttl = 600000;

export function createStaffAuthService(connection: Connection, jwtKey: string, encryptionKey: string, settings = sessionSettings.parse({})) {
  const users = connection.collection<User>("users");
  const challenges = connection.collection<Challenge>("staff_auth_challenges");
  const limits = connection.collection<{ _id: string; count: number; expiresAt: Date }>("staff_login_limits");
  const roles = createAccessStore(connection);
  const sessions = createSessionStore(connection, jwtKey, settings);
  const cipher = createSecretCipher(encryptionKey);
  const audit = createAuditWriter(connection);
  const dummyHash = hashPassword(randomBytes(32).toString("hex"));
  const limitKey = (kind: string, value: string) => createHmac("sha256", Buffer.from(jwtKey, "hex")).update(`${kind}:${Math.floor(Date.now() / 900000)}:${value}`).digest("hex");
  function failure(status: number, code: string, message: string): never { throw new StaffError(status, code, message); }
  async function transaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = await connection.startSession();
    try { return await session.withTransaction(() => work(session)); } finally { await session.endSession(); }
  }
  async function log(user: User, role: string, action: string, requestId: string, session: ClientSession) {
    await audit({ actorId: String(user._id), actorRole: role, action, entityType: "staff", entityId: String(user._id), requestId }, session);
  }
  async function complete(user: User, role: string, requestId: string, session: ClientSession) {
    const nextAction = nextStaffAction(user, role);
    if (nextAction) {
      const token = randomBytes(32).toString("hex");
      await challenges.deleteMany({ userId: user._id }, { session });
      await challenges.insertOne({ _id: digest(token), userId: user._id, revision: user.credentialRevision ?? 0, expiresAt: new Date(Date.now() + ttl), attempts: 0 }, { session });
      return { kind: "challenge" as const, token, nextAction };
    }
    await challenges.deleteMany({ userId: user._id }, { session });
    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }, { session });
    await log(user, role, "staff.login", requestId, session);
    return { kind: "session" as const, pair: await sessions.issue(user._id, session), user: await profile(user._id, session) };
  }
  async function profile(id: Types.ObjectId, session?: ClientSession) {
    const options = session ? { session } : {};
    const user = await users.findOne({ _id: id, kind: "staff", status: "active", devMockAccount: { $ne: true } }, options);
    if (!user) return null;
    const role = await connection.collection("roles").findOne({ _id: user.roleId }, options);
    if (!role || ["customer", "rider"].includes(role.name) || nextStaffAction(user, role.name)) return null;
    return { id: String(user._id), kind: "staff", name: user.name, email: user.email, phone: null, role: role.name, status: user.status,
      permissions: role.permissions as string[], scope: { all: user.scope?.all === true, warehouseIds: (user.scope?.warehouseIds ?? []).map(String) } };
  }
  return {
    profile,
    async cancel(token: string) { if (/^[a-f0-9]{64}$/.test(token)) await challenges.deleteOne({ _id: digest(token) }); },
    async initialize() {
      await challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await challenges.createIndex({ userId: 1 });
      await limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await sessions.initialize();
      await dummyHash;
    },
    async login(input: { email: string; password: string; totpCode?: string | undefined }, ip: string, requestId: string) {
      const expiresAt = new Date(Date.now() + 900000);
      const ipLimit = await limits.findOneAndUpdate({ _id: limitKey("ip", ip) }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, returnDocument: "after" });
      if (ipLimit && ipLimit.count > 30) failure(429, "RATE_LIMITED", "Too many sign-in attempts. Try again in 15 minutes.");
      const accountKey = limitKey("account", input.email);
      if ((await limits.findOne({ _id: accountKey }))?.count! >= 5) failure(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again in 15 minutes.");
      const candidate = await users.findOne({ email: input.email, kind: "staff", status: "active", devMockAccount: { $ne: true } });
      const verified = await verifyPassword(input.password, candidate?.passwordHash ?? await dummyHash);
      const bad = async () => {
        await limits.updateOne({ _id: accountKey }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true });
        failure(401, "INVALID_CREDENTIALS", "Email, password or code is incorrect");
      };
      if (!candidate || !verified) return bad();
      const result = await transaction(async session => {
        const user = await users.findOneAndUpdate({ _id: candidate._id, kind: "staff", status: "active", devMockAccount: { $ne: true }, passwordHash: candidate.passwordHash! }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
        if (!user) return null;
        const role = await roles.lockRole(user.roleId, session);
        if (!role || ["customer", "rider"].includes(role.name) || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) return null;
        if (user.twoFactor?.enabled) {
          if (!input.totpCode) failure(401, "TOTP_REQUIRED", "Enter your authenticator code");
          if (!user.twoFactor.secretEncrypted) return null;
          const step = totpStep(cipher.decrypt(user.twoFactor.secretEncrypted, String(user._id)), input.totpCode!, user.twoFactor.lastUsedStep);
          if (step === null) return null;
          await users.updateOne({ _id: user._id }, { $set: { "twoFactor.lastUsedStep": step } }, { session });
        }
        await limits.deleteOne({ _id: accountKey }, { session });
        return complete(user, role.name, requestId, session);
      });
      return result ?? bad();
    },
    async challenge(token: string, operation: "status" | "change-password" | "setup" | "enable", input: { newPassword?: string; code?: string }, requestId: string) {
      if (!/^[a-f0-9]{64}$/.test(token)) failure(401, "UNAUTHORIZED", "Sign in again");
      const result = await transaction(async session => {
        const challenge = await challenges.findOneAndUpdate({ _id: digest(token), expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } }, { $inc: { attempts: operation === "enable" ? 1 : 0 } }, { session, returnDocument: "after" });
        if (!challenge) failure(401, "UNAUTHORIZED", "Setup expired. Sign in again.");
        const user = await users.findOneAndUpdate({ _id: challenge.userId, kind: "staff", status: "active", devMockAccount: { $ne: true } }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
        if (!user || (user.credentialRevision ?? 0) !== challenge.revision) failure(401, "UNAUTHORIZED", "Sign in again");
        const role = await roles.lockRole(user.roleId, session);
        if (!role || ["customer", "rider"].includes(role.name)) failure(401, "UNAUTHORIZED", "Sign in again");
        const nextAction = nextStaffAction(user, role.name);
        if (operation === "status") return { kind: "status" as const, nextAction };
        if (operation === "change-password") {
          if (!user.mustChangePassword) failure(409, "CONFLICT", "No password change is pending");
          if (await verifyPassword(input.newPassword!, user.passwordHash ?? "")) failure(400, "VALIDATION_ERROR", "Choose a different password");
          const newHash = await hashPassword(input.newPassword!);
          user.passwordHash = newHash; user.mustChangePassword = false; user.credentialRevision = (user.credentialRevision ?? 0) + 1;
          await users.updateOne({ _id: user._id }, { $set: { passwordHash: newHash!, mustChangePassword: false, credentialRevision: user.credentialRevision, updatedAt: new Date() } }, { session });
          await sessions.revokeUser(user._id, session);
          await log(user, role.name, "staff.change_password", requestId, session);
          return complete(user, role.name, requestId, session);
        }
        if (nextAction === "change_password") failure(403, "FORBIDDEN", "Change your temporary password first");
        if (user.twoFactor?.enabled) failure(409, "CONFLICT", "Two-factor authentication is already enabled");
        if (operation === "setup") {
          const secret = challenge.pendingSecretEncrypted ? cipher.decrypt(challenge.pendingSecretEncrypted, String(user._id)) : newTotpSecret();
          await challenges.updateOne({ _id: challenge._id }, { $set: { pendingSecretEncrypted: cipher.encrypt(secret, String(user._id)) } }, { session });
          return { kind: "setup" as const, secret, otpauthUrl: `otpauth://totp/${encodeURIComponent(`DarjeelingStores:${user.email}`)}?secret=${secret}&issuer=DarjeelingStores&algorithm=SHA1&digits=6&period=30` };
        }
        if (!challenge.pendingSecretEncrypted) failure(409, "CONFLICT", "Start authenticator setup first");
        const secret = cipher.decrypt(challenge.pendingSecretEncrypted, String(user._id));
        const step = totpStep(secret, input.code!);
        if (step === null) return { kind: "invalid_code" as const };
        user.twoFactor = { enabled: true, requiresEnrollment: false, secretEncrypted: cipher.encrypt(secret, String(user._id)), lastUsedStep: step };
        await users.updateOne({ _id: user._id }, { $set: { twoFactor: user.twoFactor, updatedAt: new Date() } }, { session });
        await sessions.revokeUser(user._id, session);
        await log(user, role.name, "staff.enable_2fa", requestId, session);
        return complete(user, role.name, requestId, session);
      });
      if (result.kind === "invalid_code") failure(401, "INVALID_OTP", "Authenticator code is incorrect");
      return result;
    },
    async beginOptionalEnrollment(accessToken: string) {
      const id = await sessions.authenticate(accessToken);
      if (!id) failure(401, "UNAUTHORIZED", "Sign in again");
      return transaction(async session => {
        if (!await sessions.authenticate(accessToken, session)) failure(401, "UNAUTHORIZED", "Sign in again");
        const user = await users.findOneAndUpdate({ _id: id, kind: "staff", status: "active", devMockAccount: { $ne: true }, lastLoginAt: { $gt: new Date(Date.now() - ttl) } }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
        if (!user) failure(403, "FORBIDDEN", "Sign in again before changing authentication");
        if (user.twoFactor?.enabled) failure(409, "CONFLICT", "Two-factor authentication is already enabled");
        const token = randomBytes(32).toString("hex");
        await challenges.deleteMany({ userId: id }, { session });
        await challenges.insertOne({ _id: digest(token), userId: id, revision: user.credentialRevision ?? 0, expiresAt: new Date(Date.now() + ttl), attempts: 0 }, { session });
        return token;
      });
    },
    async bootstrap(input: { email: string; name: string; password: string }) {
      const passwordHash = await hashPassword(input.password);
      return transaction(async session => {
        const owner = await connection.collection("roles").findOneAndUpdate({ name: "super_admin", isSystem: true, permissions: ["*"] }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
        if (!owner) failure(409, "CONFLICT", "Initialize the protected owner role first");
        if (await users.findOne({ roleId: owner._id }, { session })) failure(409, "CONFLICT", "An owner already exists; bootstrap cannot replace it");
        await connection.collection<{ _id: string }>("identity_bootstrap").insertOne({ _id: "owner" }, { session });
        const user: User = { _id: new Types.ObjectId(), kind: "staff", email: input.email, name: input.name, passwordHash, roleId: owner._id,
          status: "active", scope: { all: true, warehouseIds: [] }, mustChangePassword: true, credentialRevision: 0, twoFactor: { enabled: false, requiresEnrollment: true } };
        await users.insertOne({ ...user, createdAt: new Date(), updatedAt: new Date() } as User, { session });
        await log(user, owner.name, "staff.bootstrap_owner", randomUUID(), session);
        return { id: String(user._id), email: user.email };
      });
    },
  };
}
