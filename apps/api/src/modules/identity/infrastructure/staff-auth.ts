import { createHash, createHmac, randomBytes } from "node:crypto";
import { Types, type ClientSession, type Connection } from "mongoose";
import { createAccessStore } from "../../access/access.public.js";
import { sessionSettings } from "../../../config/env.js";
import { nextStaffAction } from "../domain/staff-auth-policy.js";
import { StaffError } from "../domain/staff-policy.js";
import { hashPassword, verifyPassword } from "./credentials.js";
import { createSessionStore } from "./sessions.js";

type User = { _id: Types.ObjectId; kind: string; email: string; name: string; roleId: Types.ObjectId; status: string;
  passwordHash?: string; credentialRevision?: number; mustChangePassword?: boolean; devMockAccount?: boolean;
  scope?: { all: boolean; warehouseIds: Types.ObjectId[] }; lastLoginAt?: Date };
type Challenge = { _id: string; userId: Types.ObjectId; revision: number; expiresAt: Date };
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const ttl = 600000;

/** Staff sign-in with email and password. A temporary password must be changed before a session is issued. */
export function createStaffAuthService(connection: Connection, jwtKey: string, settings = sessionSettings.parse({})) {
  const users = connection.collection<User>("users");
  const challenges = connection.collection<Challenge>("staff_auth_challenges");
  const limits = connection.collection<{ _id: string; count: number; expiresAt: Date }>("staff_login_limits");
  const roles = createAccessStore(connection);
  const sessions = createSessionStore(connection, jwtKey, settings);
  const dummyHash = hashPassword(randomBytes(32).toString("hex"));
  const limitKey = (kind: string, value: string) => createHmac("sha256", Buffer.from(jwtKey, "hex")).update(`${kind}:${Math.floor(Date.now() / 900000)}:${value}`).digest("hex");
  function failure(status: number, code: string, message: string): never { throw new StaffError(status, code, message); }
  async function transaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = await connection.startSession();
    try { return await session.withTransaction(() => work(session)); } finally { await session.endSession(); }
  }
  async function complete(user: User, role: string, session: ClientSession) {
    const nextAction = nextStaffAction(user);
    if (nextAction) {
      const token = randomBytes(32).toString("hex");
      await challenges.deleteMany({ userId: user._id }, { session });
      await challenges.insertOne({ _id: digest(token), userId: user._id, revision: user.credentialRevision ?? 0, expiresAt: new Date(Date.now() + ttl) }, { session });
      return { kind: "challenge" as const, token, nextAction };
    }
    await challenges.deleteMany({ userId: user._id }, { session });
    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }, { session });
    return { kind: "session" as const, pair: await sessions.issue(user._id, session), user: await profile(user._id, session) };
  }
  async function profile(id: Types.ObjectId, session?: ClientSession) {
    const options = session ? { session } : {};
    const user = await users.findOne({ _id: id, kind: "staff", status: "active", devMockAccount: { $ne: true } }, options);
    if (!user) return null;
    const role = await connection.collection("roles").findOne({ _id: user.roleId }, options);
    if (!role || ["customer", "rider"].includes(role.name) || nextStaffAction(user)) return null;
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
    async login(input: { email: string; password: string }, ip: string) {
      const expiresAt = new Date(Date.now() + 900000);
      const ipLimit = await limits.findOneAndUpdate({ _id: limitKey("ip", ip) }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, returnDocument: "after" });
      if (ipLimit && ipLimit.count > 30) failure(429, "RATE_LIMITED", "Too many sign-in attempts. Try again in 15 minutes.");
      const accountKey = limitKey("account", input.email);
      if ((await limits.findOne({ _id: accountKey }))?.count! >= 5) failure(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again in 15 minutes.");
      const candidate = await users.findOne({ email: input.email, kind: "staff", status: "active", devMockAccount: { $ne: true } });
      const verified = await verifyPassword(input.password, candidate?.passwordHash ?? await dummyHash);
      const bad = async () => {
        await limits.updateOne({ _id: accountKey }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true });
        failure(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
      };
      if (!candidate || !verified) return bad();
      const result = await transaction(async session => {
        const user = await users.findOneAndUpdate({ _id: candidate._id, kind: "staff", status: "active", devMockAccount: { $ne: true }, passwordHash: candidate.passwordHash! }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
        if (!user) return null;
        const role = await roles.lockRole(user.roleId, session);
        if (!role || ["customer", "rider"].includes(role.name) || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) return null;
        await limits.deleteOne({ _id: accountKey }, { session });
        return complete(user, role.name, session);
      });
      return result ?? bad();
    },
    /** The temporary-password step: "status" says what is pending, "change-password" sets the new password and signs in. */
    async challenge(token: string, operation: "status" | "change-password", input: { newPassword?: string }) {
      if (!/^[a-f0-9]{64}$/.test(token)) failure(401, "UNAUTHORIZED", "Sign in again");
      return transaction(async session => {
        const challenge = await challenges.findOne({ _id: digest(token), expiresAt: { $gt: new Date() } }, { session });
        if (!challenge) failure(401, "UNAUTHORIZED", "Setup expired. Sign in again.");
        const user = await users.findOneAndUpdate({ _id: challenge.userId, kind: "staff", status: "active", devMockAccount: { $ne: true } }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
        if (!user || (user.credentialRevision ?? 0) !== challenge.revision) failure(401, "UNAUTHORIZED", "Sign in again");
        const role = await roles.lockRole(user.roleId, session);
        if (!role || ["customer", "rider"].includes(role.name)) failure(401, "UNAUTHORIZED", "Sign in again");
        if (operation === "status") return { kind: "status" as const, nextAction: nextStaffAction(user) };
        if (!user.mustChangePassword) failure(409, "CONFLICT", "No password change is pending");
        if (await verifyPassword(input.newPassword!, user.passwordHash ?? "")) failure(400, "VALIDATION_ERROR", "Choose a different password");
        const newHash = await hashPassword(input.newPassword!);
        user.passwordHash = newHash; user.mustChangePassword = false; user.credentialRevision = (user.credentialRevision ?? 0) + 1;
        await users.updateOne({ _id: user._id }, { $set: { passwordHash: newHash!, mustChangePassword: false, credentialRevision: user.credentialRevision, updatedAt: new Date() } }, { session });
        await sessions.revokeUser(user._id, session);
        return complete(user, role.name, session);
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
          status: "active", scope: { all: true, warehouseIds: [] }, mustChangePassword: true, credentialRevision: 0 };
        await users.insertOne({ ...user, createdAt: new Date(), updatedAt: new Date() } as User, { session });
        return { id: String(user._id), email: user.email };
      });
    },
  };
}
