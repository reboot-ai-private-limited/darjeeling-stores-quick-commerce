import { z } from "zod";

export const phoneNumber = z.string().max(32).transform(value => value.replace(/[\s-]/g, "")).transform(value => /^\d{10}$/.test(value) ? `+91${value}` : value).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
export const otpRequest = z.object({ phone: phoneNumber, app: z.enum(["customer", "rider", "admin"]).default("customer"), channel: z.enum(["whatsapp", "sms"]).default("whatsapp") }).strict();
export const otpVerify = z.object({ phone: phoneNumber, otp: z.string().regex(/^\d{6}$/), deviceInfo: z.string().trim().max(256).optional() }).strict();
export const phoneRequest = z.object({ phone: phoneNumber }).strict();
export const phoneVerify = z.object({ phone: phoneNumber, otp: z.string().regex(/^\d{6}$/) }).strict();
export const profileUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional() }).strict().refine(value => Object.keys(value).length > 0);
export const deletionRequest = z.object({ reason: z.string().trim().max(1000).optional() }).strict();
export const fcmToken = z.string().min(1).max(4096).regex(/^[A-Za-z0-9:._-]+$/);
export const appVersion = z.string().max(32).regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/);
export const deviceInput = z.object({ fcmToken, platform: z.enum(["android", "ios"]), app: z.enum(["customer", "rider"]), appVersion }).strict()
  .refine(value => value.app !== "rider" || value.platform === "android", "The rider app supports Android only");
export const refreshInput = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export class IdentityError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
