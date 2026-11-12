import { createRoleMutations, RoleError } from "../access/role-mutations.public.js";
import { sessionSettings } from "../../config/env.js";
import type { Request } from "express";
import { createSessionStore } from "./infrastructure/sessions.js";
import { accessCredential, trustedCookieMutation } from "./interface/session-cookies.js";
import type { Connection } from "mongoose";
import type { Route } from "../../platform/routes.js";
import { PERMISSION_GROUPS, requirePermission, createAccessStore, type AccessActor } from "../access/access.public.js";
import { createIdentityStore } from "./identity.public.js";
import { createStaffRoutes } from "./staff.public.js";

export async function createAdministrationRoutes(connection: Connection, jwtSecret: string, origins: readonly string[] = [], settings = sessionSettings.parse({}), allowDevelopmentAccounts = false): Promise<Route[]> {
  const identities = createIdentityStore(connection);
  await identities.initialize();
  const access = createAccessStore(connection);
  await access.initialize();
  const sessions = createSessionStore(connection, jwtSecret, settings);
  await sessions.initialize();
  const error = (res: Parameters<Route["handler"]>[1], status: number, code: string, message: string) => res.status(status).json({ error: { code, message, requestId: res.getHeader("X-Request-Id") } });
  async function resolveActor(req: Request): Promise<AccessActor | null> {
    const userId = await sessions.authenticate(accessCredential(req));
    if (!userId) return null;
    const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
    if (!user || user.kind !== "staff" || !user.roleId || !user.scope || (user.devMockAccount && !allowDevelopmentAccounts)) return null;
    const role = await access.getRole(String(user.roleId));
    if (!role || !Array.isArray(role.permissions) || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) return null;
    const actor: AccessActor = { kind: "staff", permissions: role.permissions, scope: { all: user.scope.all === true, warehouseIds: Array.isArray(user.scope.warehouseIds) ? user.scope.warehouseIds.map(String) : [] } };
    return actor;
  }
  const mutateRole = createRoleMutations(connection);
  function mutation(operation: "create" | "update" | "delete"): Route["handler"] {
    return requirePermission(resolveActor, "roles:manage", () => ({ kind: "all" }), async (req, res, next) => {
      if ((req.get("Cookie") || req.get("Origin")) && !trustedCookieMutation(req, origins)) return error(res, 403, "FORBIDDEN", "Untrusted role mutation");
      const userId = await sessions.authenticate(accessCredential(req));
      if (!userId) return error(res, 401, "UNAUTHORIZED", "Session required");
      try {
        const data = await mutateRole(operation, typeof req.params.id === "string" ? req.params.id : undefined, req.body, {
          actor: async transaction => {
            if (!await sessions.authenticate(accessCredential(req), transaction)) return null;
            const user = await identities.lockActiveStaff(userId, transaction);
            if (!user || (user.devMockAccount && !allowDevelopmentAccounts)) return null;
            const role = await connection.collection("roles").findOne({ _id: user.roleId }, { session: transaction });
            if (!role || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) return null;
            return { id: String(userId), kind: "staff", roleName: role.name, permissions: role.permissions, scope: { all: user.scope?.all === true, warehouseIds: (user.scope?.warehouseIds ?? []).map(String) } };
          },
          assigned: (roleId, transaction) => identities.isRoleAssigned(roleId, transaction),
        });
        res.setHeader("Cache-Control", "no-store");
        return res.status(operation === "create" ? 201 : 200).json({ data });
      } catch (cause) {
        if (cause instanceof RoleError) return error(res, cause.status, cause.code, cause.message);
        next(cause);
      }
    });
  }
  return [
    { method: "post", path: "/admin/roles", handler: mutation("create") },
    { method: "put", path: "/admin/roles/:id", handler: mutation("update") },
    { method: "delete", path: "/admin/roles/:id", handler: mutation("delete") },
    { method: "get", path: "/admin/roles", handler: requirePermission(resolveActor, "roles:manage", () => ({ kind: "all" }), async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const data = await access.listRoles();
      return res.json({ data, meta: { count: data.length } });
    }) },
    { method: "get", path: "/admin/roles/:id", handler: requirePermission(resolveActor, "roles:manage", () => ({ kind: "all" }), async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const id = req.params.id;
      const role = typeof id === "string" ? await access.roleDetail(id) : null;
      if (!role) return error(res, 404, "NOT_FOUND", "Role not found");
      return res.json({ data: role });
    }) },
    { method: "get", path: "/admin/permissions", handler: requirePermission(resolveActor, "roles:manage", () => ({ kind: "all" }), (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ data: PERMISSION_GROUPS, meta: { count: Object.values(PERMISSION_GROUPS).reduce((count, keys) => count + keys.length, 0) } });
    }) },
    ...createStaffRoutes(connection, jwtSecret, origins, settings, allowDevelopmentAccounts),
  ];
}
