import { hashPassword } from "./credentials.js";
import { Types, type ClientSession, type Connection } from "mongoose";
import { createAccessStore, ADMIN_PERMISSIONS } from "../../access/access.public.js";
import { createAuditWriter } from "../../audit/audit.public.js";
import { sessionSettings } from "../../../config/env.js";
import { containsStaffScope, StaffError, type StaffScope, type StaffOperation, type createStaffInput, type updateStaffInput, type staffListInput } from "../domain/staff-policy.js";
import type { z } from "zod";
import { createIdentityStore } from "./users.js";
import { createSessionStore } from "./sessions.js";

type StaffDoc = {
  _id: Types.ObjectId; kind: string; name: string; email?: string; roleId: Types.ObjectId; status: string;
  scope?: { all: boolean; warehouseIds: Types.ObjectId[] }; lastLoginAt?: Date;
  twoFactor?: { enabled: boolean; requiresEnrollment?: boolean; secretEncrypted?: string; recoveryCodeHashes?: string[] };
  passwordHash?: string; mustChangePassword?: boolean; createdAt?: Date; updatedAt?: Date;
  devMockAccount?: boolean;
};
type Role = { _id: Types.ObjectId; name: string; permissions: string[]; isSystem: boolean };
type Actor = { id: Types.ObjectId; role: Role; scope: StaffScope };
const scopeOf = (user: StaffDoc): StaffScope => ({ all: user.scope?.all === true, warehouseIds: (user.scope?.warehouseIds ?? []).map(String) });
const snapshot = (user: StaffDoc) => ({ id: String(user._id), roleId: String(user.roleId), status: user.status, scope: scopeOf(user) });
const view = (user: StaffDoc, role: Role | null) => ({ id: String(user._id), name: user.name, email: user.email ?? null,
  role: role?.name ?? null, roleId: String(user.roleId), status: user.status, scope: scopeOf(user), lastLoginAt: user.lastLoginAt ?? null, twoFactorEnabled: user.twoFactor?.enabled === true });

export function createStaffService(connection: Connection, jwtSecret: string, settings = sessionSettings.parse({}), allowDevelopmentAccounts = false) {
  const users = connection.collection<StaffDoc>("users");
  const access = createAccessStore(connection);
  const identities = createIdentityStore(connection);
  const sessions = createSessionStore(connection, jwtSecret, settings);
  const audit = createAuditWriter(connection);
  const roleFor = async (id: Types.ObjectId, session?: ClientSession) => session ? access.lockRole(id, session) : access.getRole(String(id));
  async function actor(token: string, session?: ClientSession): Promise<Actor> {
    const id = await sessions.authenticate(token, session);
    const user = id ? session ? await identities.lockActiveStaff(id, session) : await users.findOne({ _id: id, kind: "staff", status: "active" }) : null;
    if (!user?.roleId || (user.devMockAccount && !allowDevelopmentAccounts)) throw new StaffError(401, "UNAUTHORIZED", "Staff session required");
    const role = await roleFor(user.roleId, session);
    if (!role || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) throw new StaffError(401, "UNAUTHORIZED", "Staff session required");
    if (!role.permissions.includes("*") && !role.permissions.includes("staff:manage")) throw new StaffError(403, "FORBIDDEN", "Permission denied");
    return { id: user._id, role, scope: scopeOf(user as StaffDoc) };
  }
  function scopeFilter(current: Actor) {
    return current.scope.all ? {} : { "scope.all": false, "scope.warehouseIds.0": { $exists: true },
      "scope.warehouseIds": { $not: { $elemMatch: { $nin: current.scope.warehouseIds.map(id => new Types.ObjectId(id)) } } } };
  }
  function canManageRole(current: Actor, role: Role) {
    return !["super_admin", "customer", "rider"].includes(role.name) && role.permissions.every(key =>
      (ADMIN_PERMISSIONS as readonly string[]).includes(key) && (current.role.permissions.includes("*") || current.role.permissions.includes(key)));
  }
  return {
    actor,
    async list(current: Actor, input: z.infer<typeof staffListInput>) {
      const filter = { kind: "staff", ...scopeFilter(current), ...(input.status && { status: input.status }),
        ...(input.roleId && { roleId: new Types.ObjectId(input.roleId) }), ...(input.cursor && { _id: { $gt: new Types.ObjectId(input.cursor) } }),
        ...(input.q && { $or: ["name", "email"].map(field => ({ [field]: { $regex: input.q!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })) }) };
      const rows = await users.find(filter, { projection: { name: 1, email: 1, roleId: 1, status: 1, scope: 1, lastLoginAt: 1, "twoFactor.enabled": 1 } }).sort({ _id: 1 }).limit(input.limit + 1).toArray();
      const more = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const roles = new Map((await access.getRoles(page.map(user => user.roleId))).map(role => [String(role._id), role]));
      const data = page.map(user => view(user, roles.get(String(user.roleId)) ?? null));
      return { data, meta: { count: data.length, nextCursor: more ? String(page.at(-1)!._id) : null } };
    },
    async detail(current: Actor, id: string) {
      const user = await users.findOne({ _id: new Types.ObjectId(id), kind: "staff", ...scopeFilter(current) },
        { projection: { name: 1, email: 1, roleId: 1, status: 1, scope: 1, lastLoginAt: 1, "twoFactor.enabled": 1 } });
      if (!user) throw new StaffError(404, "NOT_FOUND", "Staff account not found");
      return view(user, await roleFor(user.roleId));
    },
    async mutate(token: string, operation: StaffOperation, id: string | undefined, input: z.infer<typeof createStaffInput> | z.infer<typeof updateStaffInput> | { newPassword: string }, requestId: string) {
      const password = "password" in input ? input.password : "newPassword" in input ? input.newPassword : undefined;
      const passwordHash = password !== undefined ? await hashPassword(password) : undefined;
      const session = await connection.startSession();
      try {
        return await session.withTransaction(async () => {
          const current = await actor(token, session);
          const targetId = operation === "create" ? new Types.ObjectId() : new Types.ObjectId(id);
          const target = operation === "create" ? null : await users.findOneAndUpdate({ _id: targetId, kind: "staff", ...scopeFilter(current) }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
          if (operation !== "create" && !target) throw new StaffError(404, "NOT_FOUND", "Staff account not found");
          if (target && !["active", "deactivated"].includes(target.status)) throw new StaffError(409, "CONFLICT", "Staff account is not available for administration");
          const targetRole = target ? await roleFor(target.roleId, session) : null;
          if (target && (!targetRole || !canManageRole(current, targetRole))) throw new StaffError(403, "FORBIDDEN", "Target role exceeds your authority or is protected");
          if (target && String(current.id) === String(targetId) && (operation === "deactivate" || (operation === "update" && ("roleId" in input || "scope" in input)))) throw new StaffError(403, "FORBIDDEN", "Cannot deactivate yourself or change your own authority");
          const roleId = "roleId" in input && input.roleId ? new Types.ObjectId(input.roleId) : target?.roleId;
          const role = roleId ? await roleFor(roleId, session) : null;
          if (!role || ["super_admin", "customer", "rider"].includes(role.name)) throw new StaffError(400, "VALIDATION_ERROR", "Role must be an ordinary staff role");
          if (!canManageRole(current, role)) throw new StaffError(403, "FORBIDDEN", "Cannot assign a role exceeding your authority");
          const scope = "scope" in input && input.scope ? input.scope : target ? scopeOf(target) : { all: false, warehouseIds: [] };
          if (!containsStaffScope(current.scope, scope)) throw new StaffError(403, "FORBIDDEN", "Cannot grant scope exceeding your authority");
          if ("scope" in input && input.scope && scope.warehouseIds.length) {
            const count = await connection.collection("warehouses").countDocuments({ _id: { $in: scope.warehouseIds.map(value => new Types.ObjectId(value)) } }, { session });
            if (count !== scope.warehouseIds.length) throw new StaffError(400, "VALIDATION_ERROR", "Unknown warehouse");
          }
          const now = new Date();
          let after: StaffDoc;
          if (operation === "create" && "email" in input) {
            after = { _id: targetId, kind: "staff", name: input.name, email: input.email, roleId: role._id, status: "active",
              scope: { all: scope.all, warehouseIds: scope.warehouseIds.map(value => new Types.ObjectId(value)) }, passwordHash: passwordHash!, mustChangePassword: true,
              twoFactor: { enabled: false }, createdAt: now, updatedAt: now };
            await users.insertOne(after, { session });
          } else {
            if (!target) throw new StaffError(404, "NOT_FOUND", "Staff account not found");
            const changes: Partial<StaffDoc> = { updatedAt: now };
            if (operation === "update") {
              if ("name" in input && input.name !== undefined) changes.name = input.name;
              if ("roleId" in input && input.roleId) changes.roleId = role._id;
              if ("scope" in input && input.scope) changes.scope = { all: scope.all, warehouseIds: scope.warehouseIds.map(value => new Types.ObjectId(value)) };
            }
            if (operation === "deactivate" || operation === "reactivate") changes.status = operation === "deactivate" ? "deactivated" : "active";
            if (operation === "reset-password") { changes.passwordHash = passwordHash!; changes.mustChangePassword = true; }
            if (operation === "reset-2fa") changes.twoFactor = { enabled: false, requiresEnrollment: true };
            await users.updateOne({ _id: targetId }, { $set: changes }, { session });
            if (["deactivate", "reset-password", "reset-2fa", "force-logout"].includes(operation) || (operation === "update" && ("roleId" in input || "scope" in input))) {
              await users.updateOne({ _id: targetId }, { $inc: { credentialRevision: 1 } }, { session });
              await connection.collection("staff_auth_challenges").deleteMany({ userId: targetId }, { session });
            }
            after = { ...target, ...changes };
            if (["deactivate", "force-logout", "reset-password", "reset-2fa"].includes(operation)) await sessions.revokeUser(targetId, session);
          }
          await audit({ actorId: String(current.id), actorRole: current.role.name, action: `staff.${operation.replaceAll("-", "_")}`,
            entityType: "staff", entityId: String(targetId), requestId, staffChange: { before: target ? snapshot(target) : null, after: snapshot(after) } }, session);
          return operation === "create" || operation === "update" ? view(after, role) : { ok: true };
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new StaffError(409, "CONFLICT", "Email already exists");
        throw error;
      } finally { await session.endSession(); }
    },
  };
}
