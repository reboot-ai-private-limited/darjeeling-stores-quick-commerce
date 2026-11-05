import { sessionSettings } from "../../config/env.js";
import type { Request } from "express";
import { createSessionStore } from "./infrastructure/sessions.js";
import { accessCredential, readSessionCookie, setSessionCookies, clearSessionCookies, trustedCookieMutation } from "./interface/session-cookies.js";
import { Types, type Connection } from "mongoose";
import { z } from "zod";
import type { Route } from "../../platform/routes.js";
import { ADMIN_PERMISSIONS, requirePermission, createAccessStore, type AccessActor } from "../access/access.public.js";
import { createIdentityStore } from "./identity.public.js";

const phone = z.string().transform(value => value.replace(/[\s-]/g, "")).transform(value => /^\d{10}$/.test(value) ? `+91${value}` : value).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
const requestInput = z.object({ phone, app: z.enum(["customer", "rider", "admin"]).default("customer"), channel: z.enum(["sms", "whatsapp"]).optional() }).strict();
const verifyInput = z.object({ phone, otp: z.string(), deviceInfo: z.string().max(256).optional() }).strict();
const ownerPhone = "+919000000001";

export async function createDevOtpRoutes(connection: Connection, mode: string, jwtSecret: string, origins: readonly string[] = ["http://localhost:3000"], secureCookies = false, settings = sessionSettings.parse({})): Promise<Route[]> {
  if (mode !== "development" || !/_(dev|test)$/.test(connection.name)) throw new Error("Mock OTP requires development mode and a database ending in _dev or _test");
  const identities = createIdentityStore(connection);
  await identities.initialize();
  const access = createAccessStore(connection);
  await access.initialize();
  const ownerRole = await connection.collection("roles").findOne({ name: "super_admin" });
  const customerRole = await connection.collection("roles").findOne({ name: "customer" });
  if (!ownerRole || !customerRole) throw new Error("Development roles unavailable");
  const existing = await connection.collection("users").findOne({ phone: ownerPhone });
  if (existing && (!existing.devMockAccount || !existing.roleId.equals(ownerRole._id))) throw new Error("Refusing to replace an existing account with a mock super admin");
  await connection.collection("users").updateOne({ phone: ownerPhone }, { $setOnInsert: {
    phone: ownerPhone, name: "Development super admin", kind: "staff", roleId: ownerRole._id,
    status: "active", scope: { all: true, warehouseIds: [] }, devMockAccount: true, createdAt: new Date(), updatedAt: new Date(),
  } }, { upsert: true });

  // shortcut: process-local mock challenges, replace with durable OTP delivery before real use.
  const challenges = new Map<string, { expires: number; attempts: number; app: string }>();
  const sessions = createSessionStore(connection, jwtSecret, settings);
  await sessions.initialize();
  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of challenges) if (entry.expires <= now) challenges.delete(key);
  }
  const error = (res: Parameters<Route["handler"]>[1], status: number, code: string, message: string) => res.status(status).json({ error: { code, message, requestId: res.getHeader("X-Request-Id") } });
  async function profile(userId: Types.ObjectId) {
    const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
    if (!user) return null;
    const role = await connection.collection("roles").findOne({ _id: user.roleId });
    return { id: user._id.toHexString(), name: user.name, phone: user.phone, role: role?.name, status: user.status, scope: user.scope };
  }
  async function resolveActor(req: Request): Promise<AccessActor | null> {
    cleanup();
    const userId = await sessions.authenticate(accessCredential(req));
    if (!userId) return null;
    const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
    if (!user || user.kind !== "staff" || !user.roleId || !user.scope) return null;
    const role = await access.getRole(String(user.roleId));
    if (!role || !Array.isArray(role.permissions) || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) return null;
    const actor: AccessActor = { kind: "staff", permissions: role.permissions, scope: { all: user.scope.all === true, warehouseIds: Array.isArray(user.scope.warehouseIds) ? user.scope.warehouseIds.map(String) : [] } };
    return actor;
  }
  return [
    { method: "get", path: "/admin/roles", handler: requirePermission(resolveActor, "roles:manage", () => ({ kind: "all" }), async (_req, res) => {
      const data = await access.listRoles();
      return res.json({ data, meta: { count: data.length } });
    }) },
    { method: "get", path: "/admin/permissions", handler: requirePermission(resolveActor, "roles:manage", () => ({ kind: "all" }), (_req, res) => {
      return res.json({ data: { admin: ADMIN_PERMISSIONS }, meta: { count: ADMIN_PERMISSIONS.length } });
    }) },
    { method: "post", path: "/auth/request-otp", handler: async (req, res) => {
      cleanup();
      const parsed = requestInput.safeParse(req.body);
      if (!parsed.success) return error(res, 400, "VALIDATION_ERROR", "Invalid OTP request");
      if (challenges.size >= 1000) return error(res, 429, "RATE_LIMITED", "Too many development challenges");
      if (parsed.data.app === "rider") return error(res, 403, "OTP_REQUEST_REJECTED", "Rider login is not implemented");
      if (parsed.data.app === "admin" && parsed.data.phone !== ownerPhone) return error(res, 403, "OTP_REQUEST_REJECTED", "Account unavailable");
      if (challenges.has(parsed.data.phone)) return error(res, 429, "RATE_LIMITED", "A development challenge is already active");
      challenges.set(parsed.data.phone, { expires: Date.now() + 300_000, attempts: 0, app: parsed.data.app });
      return res.json({ data: { expiresInSeconds: 300, channel: "mock", mockOTP: true } });
    } },
    { method: "post", path: "/auth/verify-otp", handler: async (req, res) => {
      cleanup();
      if (req.get("Origin") && !trustedCookieMutation(req, origins)) return error(res, 403, "FORBIDDEN", "Untrusted sign-in request");
      const parsed = verifyInput.safeParse(req.body);
      if (!parsed.success) return error(res, 400, "VALIDATION_ERROR", "Invalid OTP verification");
      const challenge = challenges.get(parsed.data.phone);
      if (!challenge) return error(res, 401, "INVALID_OTP", "Request a development OTP first");
      if (parsed.data.otp !== "000000") {
        challenge.attempts++;
        if (challenge.attempts >= 5) challenges.delete(parsed.data.phone);
        return error(res, 401, "INVALID_OTP", "Invalid development OTP");
      }
      challenges.delete(parsed.data.phone);
      let user = await connection.collection("users").findOne({ phone: parsed.data.phone });
      if (!user) {
        try { await identities.createUser({ kind: "customer", roleId: customerRole._id.toHexString(), phone: parsed.data.phone }); }
        catch (cause) { if (!(cause && typeof cause === "object" && "code" in cause && cause.code === 11000)) throw cause; }
        user = await connection.collection("users").findOne({ phone: parsed.data.phone });
      }
      if (!user || user.status !== "active" || (user.kind !== "customer" && !(user.phone === ownerPhone && user.devMockAccount))) return error(res, 403, "FORBIDDEN", "Account unavailable");
      const pair = await sessions.issue(user._id);
      setSessionCookies(res, pair, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
      return res.json({ data: { ...(req.get("X-Client") === "admin" ? {} : { accessToken: pair.accessToken }), accessTokenExpiresInSeconds: pair.accessTokenExpiresInSeconds, mockOTP: true, user: await profile(user._id) } });
    } },
    { method: "post", path: "/auth/refresh", handler: async (req, res) => {
      if (!trustedCookieMutation(req, origins)) return error(res, 403, "FORBIDDEN", "Untrusted refresh request");
      const pair = await sessions.rotate(readSessionCookie(req, "refresh"));
      if ("error" in pair) {
        clearSessionCookies(res, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
        return error(res, 401, pair.error, "Sign in again");
      }
      const user = await profile(pair.userId);
      if (!user || !user.role) {
        await sessions.revoke(pair.accessToken, pair.refreshToken);
        clearSessionCookies(res, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
        return error(res, 401, "UNAUTHORIZED", "Account unavailable");
      }
      setSessionCookies(res, pair, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
      return res.json({ data: { accessTokenExpiresInSeconds: pair.accessTokenExpiresInSeconds, user } });
    } },
    { method: "get", path: "/me", handler: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const userId = await sessions.authenticate(accessCredential(req));
      const user = userId ? await profile(userId) : null;
      if (!user) return error(res, 401, "UNAUTHORIZED", "Session required");
      return res.json({ data: user });
    } },
    { method: "post", path: "/auth/logout", handler: async (req, res) => {
      if ((req.get("Cookie") || req.get("Origin")) && !trustedCookieMutation(req, origins)) return error(res, 403, "FORBIDDEN", "Untrusted logout request");
      await sessions.revoke(accessCredential(req), readSessionCookie(req, "refresh"));
      clearSessionCookies(res, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
      return res.json({ data: { ok: true } });
    } },
  ];
}
