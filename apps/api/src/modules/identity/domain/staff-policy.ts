import { z } from "zod";

export const staffId = z.string().regex(/^[a-fA-F0-9]{24}$/).transform(value => value.toLowerCase());
const password = z.string().min(10).refine(value => Buffer.byteLength(value, "utf8") <= 1024, "Password is too long");
const scope = z.object({ all: z.boolean(), warehouseIds: z.array(staffId).max(100) }).strict()
  .refine(value => new Set(value.warehouseIds).size === value.warehouseIds.length && (!value.all || value.warehouseIds.length === 0), "Invalid warehouse scope");
const fields = { name: z.string().trim().min(1).max(120), roleId: staffId, scope };
export const createStaffInput = z.object({ ...fields, email: z.string().trim().toLowerCase().pipe(z.email().max(254)), password }).strict();
export const updateStaffInput = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0, "At least one field is required");
export const resetPasswordInput = z.object({ newPassword: password }).strict();
export const emptyStaffInput = z.object({}).strict();
export const staffListInput = z.object({
  q: z.string().trim().max(120).optional(), roleId: staffId.optional(),
  status: z.enum(["active", "deactivated"]).optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).default(50),
  cursor: staffId.optional(),
}).strict();
export type StaffScope = z.infer<typeof scope>;
export type StaffOperation = "create" | "update" | "deactivate" | "reactivate" | "reset-password" | "reset-2fa" | "force-logout";
export class StaffError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function containsStaffScope(actor: StaffScope, target: StaffScope) {
  return actor.all || (!target.all && target.warehouseIds.length > 0 && target.warehouseIds.every(id => actor.warehouseIds.includes(id)));
}
