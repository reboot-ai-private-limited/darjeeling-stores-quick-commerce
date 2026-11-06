import { z } from "zod";
import { resetPasswordInput } from "./staff-policy.js";

export const loginInput = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).refine(value => Buffer.byteLength(value) <= 1024), totpCode: z.string().regex(/^\d{6}$/).optional() }).strict();
export const changePasswordInput = resetPasswordInput;
export const totpInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type CredentialState = { kind: string; devMockAccount?: boolean; mustChangePassword?: boolean; twoFactor?: { enabled?: boolean; requiresEnrollment?: boolean } };
export function nextStaffAction(user: CredentialState, roleName: string) {
  if (user.mustChangePassword) return "change_password" as const;
  if (user.twoFactor?.requiresEnrollment || (roleName === "super_admin" && !user.twoFactor?.enabled)) return "enrol_2fa" as const;
  return null;
}
