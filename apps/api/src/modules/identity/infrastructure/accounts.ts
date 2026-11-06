import { Types, type ClientSession, type Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import { sessionSettings } from "../../../config/env.js";
import { IdentityError } from "../domain/consumer-policy.js";
import { createSessionStore } from "./sessions.js";
import { readProfile, type IdentityUser } from "./profile.js";

type Device = { _id: Types.ObjectId; userId: Types.ObjectId; fcmToken: string; platform: "android" | "ios"; app: "customer" | "rider"; appVersion: string; lastSeenAt: Date };
export function createAccountService(connection: Connection, jwtSecret: string, allowDevelopmentAccounts: boolean, settings = sessionSettings.parse({})) {
  const users = connection.collection<IdentityUser>("users");
  const devices = connection.collection<Device>("device_tokens");
  const sessions = createSessionStore(connection, jwtSecret, settings);
  const audit = createAuditWriter(connection);
  async function change<T>(token: string, action: string, requestId: string, work: (user: IdentityUser, session: ClientSession) => Promise<T>) {
    const transaction = await connection.startSession();
    try {
      return await transaction.withTransaction(async () => {
        const id = await sessions.authenticate(token, transaction);
        const user = id ? await users.findOneAndUpdate({ _id: id, status: "active" }, { $inc: { authorizationRevision: 1 } }, { session: transaction, returnDocument: "after" }) : null;
        if (!user || (user.devMockAccount && !allowDevelopmentAccounts)) throw new IdentityError(401, "UNAUTHORIZED", "Sign in again");
        const role = await connection.collection("roles").findOne({ _id: user.roleId }, { session: transaction });
        if (!role) throw new IdentityError(401, "UNAUTHORIZED", "Account unavailable");
        const result = await work(user, transaction);
        await audit({ actorId: String(id), actorRole: String(role.name), action, entityType: "user", entityId: String(id), requestId }, transaction);
        return result;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new IdentityError(409, "CONFLICT", "The email or device token is already in use");
      throw error;
    } finally { await transaction.endSession(); }
  }
  return {
    async initialize() { await devices.createIndex({ fcmToken: 1 }, { unique: true }); await devices.createIndex({ userId: 1 }); },
    update: (token: string, input: { name?: string | undefined; email?: string | undefined }, requestId: string) => change(token, "identity.profile_update", requestId, async (user, session) => {
      await users.updateOne({ _id: user._id }, { $set: { ...(input.name !== undefined && { name: input.name }), ...(input.email !== undefined && { email: input.email }), updatedAt: new Date() } }, { session });
      if (input.email !== undefined && input.email !== user.email) {
        await users.updateOne({ _id: user._id }, { $inc: { credentialRevision: 1 } }, { session });
        await connection.collection("staff_auth_challenges").deleteMany({ userId: user._id }, { session });
        await sessions.revokeOtherSessions(user._id, token, session);
      }
      return readProfile(connection, user._id, allowDevelopmentAccounts, session);
    }),
    deleteRequest: (token: string, reason: string | undefined, requestId: string) => change(token, "identity.delete_request", requestId, async (user, session) => {
      if (user.kind !== "customer") throw new IdentityError(403, "FORBIDDEN", "Only customers can request account deletion");
      await users.updateOne({ _id: user._id }, { $set: { status: "deletion_requested", deletionRequest: { reason: reason ?? null, requestedAt: new Date() }, updatedAt: new Date() }, $inc: { credentialRevision: 1 } }, { session });
      await sessions.revokeUser(user._id, session);
      await devices.deleteMany({ userId: user._id }, { session });
      await connection.collection("otps").deleteMany({ $or: [{ userId: user._id }, ...(user.phone ? [{ phone: user.phone }] : [])] }, { session });
      return { status: "deletion_requested" as const };
    }),
    registerDevice: (token: string, input: Omit<Device, "_id" | "userId" | "lastSeenAt">, requestId: string) => change(token, "identity.device_register", requestId, async (user, session) => {
      if (user.kind !== input.app) throw new IdentityError(403, "FORBIDDEN", "Device app does not match this account");
      const existing = await devices.findOne({ fcmToken: input.fcmToken }, { session });
      if (existing && String(existing.userId) !== String(user._id)) throw new IdentityError(409, "CONFLICT", "Device token is already registered");
      await devices.updateOne({ fcmToken: input.fcmToken }, { $set: { ...input, userId: user._id, lastSeenAt: new Date() } }, { upsert: true, session });
      return { ok: true };
    }),
    removeDevice: (token: string, fcmToken: string, requestId: string) => change(token, "identity.device_remove", requestId, async (user, session) => {
      await devices.deleteOne({ fcmToken, userId: user._id }, { session });
      return { ok: true };
    }),
  };
}
