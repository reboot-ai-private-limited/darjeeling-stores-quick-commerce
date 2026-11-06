import type { Connection, Types } from "mongoose";
import { sessionSettings } from "../../config/env.js";
import type { Route } from "../../platform/routes.js";
import { createSessionStore } from "./infrastructure/sessions.js";
import { accessCredential, readSessionCookie, setSessionCookies, clearSessionCookies, trustedCookieMutation } from "./interface/session-cookies.js";

export async function readSessionProfile(connection: Connection, userId: Types.ObjectId, allowDevelopmentAccounts = false) {
  const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
  if (!user || (user.devMockAccount && !allowDevelopmentAccounts)) return null;
  const role = await connection.collection("roles").findOne({ _id: user.roleId });
  if (!role) return null;
  return { id: String(user._id), kind: user.kind, name: user.name, phone: user.phone ?? null, email: user.email ?? null,
    role: role.name, status: user.status, permissions: role.permissions as string[], scope: user.scope };
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
