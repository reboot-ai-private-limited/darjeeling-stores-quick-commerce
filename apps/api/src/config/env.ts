import { z } from "zod";

import { publicAppPolicy } from "../modules/settings/app-config.public.js";

export function durationSeconds(value: string): number {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
  if (!match) return NaN;
  return Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2] as "s" | "m" | "h" | "d"]);
}
const duration = (min: number, max: number) => z.string().refine(value => {
  const seconds = durationSeconds(value);
  return Number.isSafeInteger(seconds) && seconds >= min && seconds <= max;
}, "Use a duration such as 30m or 15d within the allowed lifetime");

export const sessionSettings = z.object({
  ACCESS_TOKEN_TTL: duration(30, 3600).default("30m"),
  REFRESH_TOKEN_TTL: duration(60, 2592000).default("15d"),
  JWT_ISSUER: z.string().trim().min(1).max(128).default("darjeeling-stores-api"),
  JWT_AUDIENCE: z.string().trim().min(1).max(128).default("darjeeling-stores-clients"),
  AUTH_COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("strict"),
});

const schema = sessionSettings.extend({
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  mockOTP: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  JWT_SECRET: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  STAFF_TOTP_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  /** Locks delivery codes at rest. When left out, a separate key is derived from JWT_SECRET, so it still never falls back to a built-in key. */
  ORDER_OTP_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  /** Signs the customer's public tracking links. Derived from JWT_SECRET when left out. */
  TRACKING_TOKEN_SECRET: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  /** Where customers open a tracking link, for example https://darjeelingstores.in (a link is /track/<token> under it). Without it there are no links. */
  TRACKING_BASE_URL: z.url().refine(value => value.startsWith("http://") || value.startsWith("https://"), "must be an HTTP(S) URL").optional(),
  /** Doorstep UPI details for the rider app's QR code. */
  UPI_VPA: z.string().regex(/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9]{2,32}$/).optional(),
  UPI_PAYEE_NAME: z.string().trim().min(1).max(60).optional(),
  /** Road travel times for ETAs (Google Routes). Without it the straight-line estimate is used. */
  GOOGLE_MAPS_API_KEY: z.string().trim().min(10).max(200).optional(),
  PUBLIC_APP_CONFIG_JSON: z.string().default("{}").transform((value, context) => {
    try { return JSON.parse(value) as unknown; }
    catch { context.addIssue({ code: "custom", message: "Must be valid JSON" }); return z.NEVER; }
  }).pipe(publicAppPolicy),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/\S+$/, "must be a MongoDB URI"),
  CORS_ORIGINS: z.string().default("").transform(value => value.split(",").map(origin => origin.trim()).filter(Boolean)).refine(origins => origins.every(origin => {
    try { const url = new URL(origin); return ["http:", "https:"].includes(url.protocol) && url.origin === origin; } catch { return false; }
  }), "must be comma-separated HTTP origins"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  /** Requests one client address may make per minute before getting 429. 0 turns it off. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).max(100_000).default(600),
}).superRefine((config, context) => {
  if (config.mockOTP && config.NODE_ENV !== "development") context.addIssue({ code: "custom", path: ["mockOTP"], message: "Mock OTP requires development mode" });
  if (config.mockOTP && !config.JWT_SECRET) context.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "JWT signing key required" });
  if (!config.mockOTP && config.JWT_SECRET && !config.STAFF_TOTP_KEY) context.addIssue({ code: "custom", path: ["STAFF_TOTP_KEY"], message: "Staff authentication requires a separate encryption key" });
  if (config.UPI_VPA && !config.UPI_PAYEE_NAME) context.addIssue({ code: "custom", path: ["UPI_PAYEE_NAME"], message: "Name the UPI payee together with the UPI address" });
  if (config.STAFF_TOTP_KEY && config.STAFF_TOTP_KEY === config.JWT_SECRET) context.addIssue({ code: "custom", path: ["STAFF_TOTP_KEY"], message: "Use an independent encryption key" });
  if (durationSeconds(config.ACCESS_TOKEN_TTL) >= durationSeconds(config.REFRESH_TOKEN_TTL)) context.addIssue({ code: "custom", path: ["REFRESH_TOKEN_TTL"], message: "Refresh lifetime must exceed access lifetime" });
  const secure = config.AUTH_COOKIE_SECURE === undefined ? config.NODE_ENV === "production" : config.AUTH_COOKIE_SECURE === "true";
  if (config.NODE_ENV === "production" && !secure) context.addIssue({ code: "custom", path: ["AUTH_COOKIE_SECURE"], message: "Production requires Secure cookies" });
  if (config.AUTH_COOKIE_SAME_SITE === "none" && !secure) context.addIssue({ code: "custom", path: ["AUTH_COOKIE_SAME_SITE"], message: "SameSite=None requires Secure" });
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${[...new Set(result.error.issues.map(issue => issue.path.join(".")))].join(", ")}`);
  return { ...result.data, AUTH_COOKIE_SECURE: result.data.AUTH_COOKIE_SECURE === undefined ? result.data.NODE_ENV === "production" : result.data.AUTH_COOKIE_SECURE === "true" };
}
