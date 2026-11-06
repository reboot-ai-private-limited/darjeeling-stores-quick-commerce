import { Types, type ClientSession, type Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import { ADMIN_PERMISSIONS, canGrantPermissions } from "../access.public.js";
import { createRoleInput, updateRoleInput, RoleError, type RoleAuthority } from "../domain/role-policy.js";

type Dependencies = {
  actor: (session: ClientSession) => Promise<RoleAuthority | null>;
  assigned: (roleId: Types.ObjectId, session: ClientSession) => Promise<boolean>;
};
const view = (role: { _id: Types.ObjectId; name: string; permissions: string[]; isSystem: boolean }) => ({ id: String(role._id), name: role.name, permissions: role.permissions, isSystem: role.isSystem });
type RoleDoc = { _id: Types.ObjectId; name: string; permissions: string[]; isSystem: boolean; revision?: number; createdAt: Date; updatedAt: Date };

export function createRoleMutations(connection: Connection) {
  const roles = connection.collection<RoleDoc>("roles");
  const audit = createAuditWriter(connection);
  return async (operation: "create" | "update" | "delete", id: string | undefined, input: unknown, requestId: string, deps: Dependencies) => {
    const parsed = operation === "create" ? createRoleInput.safeParse(input) : operation === "update" ? updateRoleInput.safeParse(input) : null;
    if (parsed && !parsed.success) throw new RoleError(400, "VALIDATION_ERROR", "Invalid role fields");
    if (operation !== "create" && (!id || !/^[a-fA-F0-9]{24}$/.test(id))) throw new RoleError(404, "NOT_FOUND", "Role not found");
    if (parsed?.success && parsed.data.permissions.some(key => !(ADMIN_PERMISSIONS as readonly string[]).includes(key))) throw new RoleError(400, "VALIDATION_ERROR", "Only registered permission keys are allowed");
    const session = await connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const actor = await deps.actor(session);
        const permissions = parsed?.success ? parsed.data.permissions : [];
        if (!actor || !canGrantPermissions(actor, permissions)) throw new RoleError(403, "FORBIDDEN", "You cannot grant these permissions");
        // Conflict with concurrent changes to the actor's role before using its authority.
        const actorRole = await roles.findOneAndUpdate({ name: actor.roleName }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
        if (!actorRole || !canGrantPermissions({ ...actor, permissions: actorRole.permissions }, permissions)) throw new RoleError(403, "FORBIDDEN", "Permission denied");
        const targetId = operation === "create" ? new Types.ObjectId() : new Types.ObjectId(id);
        let target: RoleDoc | null = null;
        if (operation !== "create") {
          target = await roles.findOneAndUpdate({ _id: targetId }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
          if (!target) throw new RoleError(404, "NOT_FOUND", "Role not found");
          if (target.isSystem || ["super_admin", "customer", "rider"].includes(target.name)) throw new RoleError(403, "FORBIDDEN", "System roles cannot be changed");
          if (!canGrantPermissions({ ...actor, permissions: actorRole.permissions }, target.permissions)) throw new RoleError(403, "FORBIDDEN", "Target role exceeds your authority");
        }
        let result: ReturnType<typeof view> | { ok: true };
        if (operation === "create" && parsed?.success && "name" in parsed.data) {
          const now = new Date();
          const role: RoleDoc = { _id: targetId, name: String(parsed.data.name), permissions: [...permissions], isSystem: false, revision: 0, createdAt: now, updatedAt: now };
          await roles.insertOne(role, { session });
          result = view(role);
        } else if (operation === "update" && target) {
          await roles.updateOne({ _id: targetId }, { $set: { permissions: [...permissions], updatedAt: new Date() } }, { session });
          result = view({ ...target, permissions: [...permissions] });
        } else {
          if (await deps.assigned(targetId, session)) throw new RoleError(409, "CONFLICT", "Role is assigned to users");
          await roles.deleteOne({ _id: targetId }, { session });
          result = { ok: true };
        }
        await audit({ actorId: actor.id, actorRole: actor.roleName, action: `role.${operation}`, entityType: "role", entityId: String(targetId), requestId, roleChange: { before: target ? view(target) : null, after: "id" in result ? result : null } }, session);
        return result;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new RoleError(409, "CONFLICT", "Role name already exists");
      throw error;
    } finally { await session.endSession(); }
  };
}
