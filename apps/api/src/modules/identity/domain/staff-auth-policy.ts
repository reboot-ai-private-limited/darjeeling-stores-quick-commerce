import { z } from "zod";
import { resetPasswordInput } from "./staff-policy.js";

export const loginInput = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).refine(value => Buffer.byteLength(value) <= 1024) }).strict();
export const changePasswordInput = resetPasswordInput;
export type CredentialState = { kind: string; devMockAccount?: boolean; mustChangePassword?: boolean };
/** What a staff member must do before they get a session: only a temporary password needs changing. */
export function nextStaffAction(user: CredentialState) {
  return user.mustChangePassword ? ("change_password" as const) : null;
}
