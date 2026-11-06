import type { Connection, Types } from "mongoose";
import type { Request } from "express";
import { sessionSettings } from "../../config/env.js";
import type { Route } from "../../platform/routes.js";
import { createAccessStore } from "../access/access.public.js";
import { createSessionStore } from "./infrastructure/sessions.js";
import { accessCredential, readSessionCookie, setSessionCookies, clearSessionCookies, trustedCookieMutation } from "./interface/session-cookies.js";
import { nativeClient } from "./interface/native-session.js";
import { refreshInput } from "./domain/consumer-policy.js";
import { readProfile } from "./infrastructure/profile.js";

export { trustedCookieMutation } from "./interface/session-cookies.js";

export function createStaffActorResolver(
  connection: Connection,
  jwtSecret: string,
  settings = sessionSettings.parse({}),
  allowDevelopmentAccounts = false
) {
  const sessions = createSessionStore(connection, jwtSecret, settings);
  const access = createAccessStore(connection);
  return async (req: Request) => {
    const credential = accessCredential(req);
    const userId = await sessions.authenticate(credential);
    if (!userId) return null;
    const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
    if (!user || user.kind !== "staff" || !user.roleId || !user.scope || (user.devMockAccount && !allowDevelopmentAccounts)) return null;
    const role = await access.getRole(String(user.roleId));
    if (!role || !Array.isArray(role.permissions) || (role.permissions.includes("*") && (role.name !== "super_admin" || !role.isSystem))) return null;
    return {
      id: String(userId),
      roleName: role.name,
      kind: "staff" as const,
      authenticate: async (transaction: import("mongoose").ClientSession) =>
        (await sessions.authenticate(credential, transaction))?.equals(userId) === true,
      permissions: role.permissions,
      scope: {
        all: user.scope.all === true,
        warehouseIds: Array.isArray(user.scope.warehouseIds) ? user.scope.warehouseIds.map(String) : [],
      },
    };
  };
}

export async function readSessionProfile(connection: Connection, userId: Types.ObjectId, allowDevelopmentAccounts = false) {
  return readProfile(connection, userId, allowDevelopmentAccounts);
}
export function createSessionRoutes(connection: Connection, jwtSecret: string, origins: readonly string[], secureCookies: boolean, settings = sessionSettings.parse({}), allowDevelopmentAccounts = false): Route[] {
  const sessions = createSessionStore(connection, jwtSecret, settings);
  const profile = (id: Types.ObjectId) => readSessionProfile(connection, id, allowDevelopmentAccounts);
  const error = (res: Parameters<Route["handler"]>[1], status: number, code: string, message: string) => res.status(status).json({ error: { code, message, requestId: res.getHeader("X-Request-Id") } });
  return [
    { method: "get", path: "/me/access", handler: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const id = await sessions.authenticate(accessCredential(req));
      const user = id ? await profile(id) : null;
      if (!user) return error(res, 401, "UNAUTHORIZED", "Session required");
      return res.json({ data: { role: user.role, permissions: user.permissions, scope: user.scope } });
    } },
    { method: "post", path: "/auth/refresh", handler: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const browser = !!(req.get("Cookie") || req.get("Origin"));
      const body = refreshInput.safeParse(req.body);
      if ((browser || !body.success) && !trustedCookieMutation(req, origins)) return error(res, 403, "FORBIDDEN", "Untrusted refresh request");
      if (browser && req.body && Object.keys(req.body).length) return error(res, 400, "VALIDATION_ERROR", "Browser refresh uses cookies only");
      const native = !browser && body.success;
      const pair = await sessions.rotate(native ? body.data.refreshToken : readSessionCookie(req, "refresh"));
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
      if (native && (user.kind === "staff" || (nativeClient(req) && nativeClient(req) !== user.kind))) {
        await sessions.revoke(pair.accessToken, pair.refreshToken);
        return error(res, 403, "FORBIDDEN", "Client app does not match this account");
      }
      if (native) return res.json({ data: { accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessTokenExpiresInSeconds: pair.accessTokenExpiresInSeconds, user } });
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
      res.setHeader("Cache-Control", "no-store");
      if ((req.get("Cookie") || req.get("Origin")) && !trustedCookieMutation(req, origins)) return error(res, 403, "FORBIDDEN", "Untrusted logout request");
      const body = refreshInput.partial().safeParse(req.body ?? {});
      if (!body.success) return error(res, 400, "VALIDATION_ERROR", "Invalid logout fields");
      if ((req.get("Cookie") || req.get("Origin")) && body.data.refreshToken) return error(res, 400, "VALIDATION_ERROR", "Browser logout uses cookies only");
      await sessions.revoke(accessCredential(req), body.data.refreshToken ?? readSessionCookie(req, "refresh"));
      clearSessionCookies(res, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
      return res.json({ data: { ok: true } });
    } },
  ];
}
