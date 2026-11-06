import { Schema, Types, type ClientSession, type Connection } from "mongoose";
import type { Request, RequestHandler } from "express";

export const ADMIN_PERMISSIONS = ["dashboard:view", "reports:view", "orders:view", "orders:manage", "dispatch:manage", "catalog:view", "catalog:manage", "warehouse_catalog:view", "warehouse_catalog:manage", "catalog:import", "stock:view", "stock:manage", "notify_demand:view", "pricing:manage", "customers:view", "customers:manage", "riders:view", "riders:manage", "cash:manage", "payments:view", "payments:manage", "refunds:manage", "warehouses:view", "warehouses:manage", "zones:manage", "delivery_rules:manage", "ops_mode:manage", "notifications:manage", "settings:view", "settings:manage", "staff:manage", "roles:manage", "audit:view"] as const;
// Registry keys describe authority; their presence does not implement the owning feature's endpoints.
const sharedAccountPermissions = ["auth:refresh", "auth:logout", "profile:view", "profile:update", "profile:delete_request", "device:register_token", "notification_pref:update"] as const;
export const CUSTOMER_PERMISSIONS = [...sharedAccountPermissions,
  "location:resolve_zone", "zone:check", "catalog:browse", "catalog:search", "catalog:changes", "store:view_status", "banner:view",
  "address:list", "address:create", "address:update", "address:delete", "address:set_default", "media:upload", "media:delete_own",
  "cart:view", "cart:sync", "cart:add_item", "cart:update_qty", "cart:change_variant", "cart:remove_item", "cart:clear", "coupon:apply", "coupon:remove", "quote:get",
  "notify_me:subscribe", "notify_me:unsubscribe", "order:place_cod", "order:place_online", "order:place_preorder", "order:list_own", "order:view_own", "order:reorder", "order:view_delivery_otp", "order:track",
  "support:contact", "payment:verify", "payment:retry", "payment:pay_online_link", "order:cancel_own", "refund:request", "refund:view_own", "rider:call",
] as const;
export const RIDER_PERMISSIONS = [...sharedAccountPermissions,
  "rider_shift:start", "rider_shift:switch_warehouse", "rider_shift:break", "rider_shift:end", "rider_assignment:list", "rider_assignment:acknowledge",
  "rider_order:view", "rider_order:navigate", "rider_order:call_customer", "rider_order:pickup", "rider_order:start_ride", "rider_order:arrived", "rider_order:verify_delivery_otp", "rider_order:collect_cash", "rider_order:generate_upi_qr", "rider_order:deliver", "rider_order:report_failed", "rider_order:report_problem",
  "rider_sync:push", "rider_location:update", "rider_cash:view", "rider_history:view", "rider_profile:view", "rider_profile:update_photo", "media:upload",
] as const;
export const PERMISSION_GROUPS = { admin: ADMIN_PERMISSIONS, customer: CUSTOMER_PERMISSIONS, rider: RIDER_PERMISSIONS };
export type Permission = typeof ADMIN_PERMISSIONS[number];
const knownPermissions = new Set<string>(ADMIN_PERMISSIONS);
const roleSchema = new Schema({
  name: { type: String, required: true, match: /^[a-z][a-z0-9_]*$/, maxlength: 64 },
  permissions: { type: [String], required: true, validate: (values: string[]) => values.every(value => value === "*" || Object.values(PERMISSION_GROUPS).some(keys => (keys as readonly string[]).includes(value))) },
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
        { name: "customer", permissions: [...CUSTOMER_PERMISSIONS], isSystem: true },
        { name: "rider", permissions: [...RIDER_PERMISSIONS], isSystem: true },
      ]) {
        await roles.updateOne({ name: role.name }, { $setOnInsert: role }, { upsert: true, runValidators: true });
      }
      const owner = await roles.findOne({ name: "super_admin" }).lean();
      if (!owner?.isSystem || owner.permissions.length !== 1 || owner.permissions[0] !== "*") throw new Error("Incompatible super_admin role");
    },
    async getRole(id: string) { return roles.findById(id).lean(); },
    async getRoles(ids: Types.ObjectId[]) { return roles.find({ _id: { $in: ids } }, { name: 1, permissions: 1, isSystem: 1 }).lean(); },
    async lockRole(id: Types.ObjectId, session: ClientSession) {
      return connection.collection<{ _id: Types.ObjectId; name: string; permissions: string[]; isSystem: boolean }>("roles")
        .findOneAndUpdate({ _id: id }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
    },
    async roleDetail(id: string) {
      if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
      const role = await roles.findById(id, { name: 1, permissions: 1, isSystem: 1 }).lean();
      return role ? { id: String(role._id), name: role.name, permissions: role.permissions, isSystem: role.isSystem } : null;
    },
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

export function canGrantPermissions(actor: AccessActor, permissions: readonly string[]): boolean {
  if (!canAccess(actor, "roles:manage", { kind: "all" })) return false;
  return permissions.every(permission => knownPermissions.has(permission) && (actor.permissions.includes("*") || actor.permissions.includes(permission)));
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

