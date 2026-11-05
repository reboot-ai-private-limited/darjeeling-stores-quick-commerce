import { Schema, type Connection } from "mongoose";
import type { Request, RequestHandler } from "express";

export const ADMIN_PERMISSIONS = ["dashboard:view", "reports:view", "orders:view", "orders:manage", "dispatch:manage", "catalog:view", "catalog:manage", "warehouse_catalog:view", "warehouse_catalog:manage", "catalog:import", "stock:view", "stock:manage", "notify_demand:view", "pricing:manage", "customers:view", "customers:manage", "riders:view", "riders:manage", "cash:manage", "payments:view", "payments:manage", "refunds:manage", "warehouses:view", "warehouses:manage", "zones:manage", "delivery_rules:manage", "ops_mode:manage", "notifications:manage", "settings:view", "settings:manage", "staff:manage", "roles:manage", "audit:view"] as const;
export type Permission = typeof ADMIN_PERMISSIONS[number];
const knownPermissions = new Set<string>(ADMIN_PERMISSIONS);
const roleSchema = new Schema({
  name: { type: String, required: true, match: /^[a-z][a-z0-9_]*$/, maxlength: 64 },
  permissions: { type: [String], required: true, validate: (values: string[]) => values.every(value => value === "*" || knownPermissions.has(value)) },
  isSystem: { type: Boolean, required: true, default: false },
}, { timestamps: true, strict: "throw", collection: "roles" });
roleSchema.index({ name: 1 }, { unique: true });

export function createAccessStore(connection: Connection) {
  const roles = connection.model("AccessRole", roleSchema);
  return {
    async initialize() {
      await roles.createIndexes();
      for (const role of [
        { name: "super_admin", permissions: ["*"], isSystem: true },
        { name: "admin", permissions: ADMIN_PERMISSIONS.filter(p => p !== "staff:manage" && p !== "roles:manage"), isSystem: false },
        { name: "customer", permissions: [], isSystem: true },
        { name: "rider", permissions: [], isSystem: true },
      ]) {
        await roles.updateOne({ name: role.name }, { $setOnInsert: role }, { upsert: true, runValidators: true });
      }
      const owner = await roles.findOne({ name: "super_admin" }).lean();
      if (!owner?.isSystem || owner.permissions.length !== 1 || owner.permissions[0] !== "*") throw new Error("Incompatible super_admin role");
    },
    async getRole(id: string) { return roles.findById(id).lean(); },
    async listRoles() {
      const rows = await roles.find({}, { name: 1, permissions: 1, isSystem: 1 }).sort({ name: 1 }).lean();
      return rows.map(role => ({ id: String(role._id), name: role.name, permissions: role.permissions, isSystem: role.isSystem }));
    },
  };
}

export type AccessActor = { kind: "staff" | "customer" | "rider"; permissions: readonly string[]; scope: { all: boolean; warehouseIds: readonly string[] } };
export function canAccess(actor: AccessActor, permission: Permission, scope: { kind: "all" } | { kind: "warehouse"; warehouseId: string }): boolean {
  if (actor.kind !== "staff" || !knownPermissions.has(permission)) return false;
  if (!actor.permissions.includes("*") && !actor.permissions.includes(permission)) return false;
  if (actor.scope.all) return true;
  return scope.kind === "warehouse" && actor.scope.warehouseIds.includes(scope.warehouseId);
}

export function requirePermission(
  resolveActor: (request: Request) => Promise<AccessActor | null>,
  permission: Permission,
  resolveScope: (request: Request) => Parameters<typeof canAccess>[2],
  handler: RequestHandler,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const actor = await resolveActor(req);
      const status = !actor ? 401 : canAccess(actor, permission, resolveScope(req)) ? null : 403;
      if (status) {
        res.status(status).json({ error: {
          code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
          message: status === 401 ? "Authentication required" : "Permission denied",
          requestId: res.getHeader("X-Request-Id"),
        } });
        return;
      }
      await handler(req, res, next);
    } catch (error) { next(error); }
  };
}

