import { z } from "zod";


export const reservedRoleNames = ["super_admin", "admin", "customer", "rider"];
export const rolePermissions = z.array(z.string()).max(100).refine(keys => new Set(keys).size === keys.length, "Duplicate permissions");
export const createRoleInput = z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).refine(name => !reservedRoleNames.includes(name), "Reserved role name"), permissions: rolePermissions }).strict();
export const updateRoleInput = z.object({ permissions: rolePermissions }).strict();
export type RoleAuthority = { id: string; roleName: string; kind: "staff" | "customer" | "rider"; permissions: readonly string[]; scope: { all: boolean; warehouseIds: readonly string[] } };
export class RoleError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
