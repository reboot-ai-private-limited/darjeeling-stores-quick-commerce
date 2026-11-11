import type { Connection } from "mongoose";
import { z } from "zod";
import type { Route } from "../../platform/routes.js";
import { sessionSettings } from "../../config/env.js";
import { createStaffAuthService } from "./infrastructure/staff-auth.js";
import { loginInput, changePasswordInput } from "./domain/staff-auth-policy.js";
import { StaffError } from "./domain/staff-policy.js";
import { clearSessionCookies, setSessionCookies, trustedCookieMutation } from "./interface/session-cookies.js";
export { createStaffAuthService } from "./infrastructure/staff-auth.js";

const challengeCookie = "ds_enrol";
const path = "/api/v1/admin/auth";
function readChallenge(cookie: string) {
  const entries = cookie.split(";").map(value => value.trim()).filter(value => value.startsWith(`${challengeCookie}=`));
  const value = entries.length === 1 ? entries[0]!.slice(challengeCookie.length + 1) : "";
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}
export async function createStaffAuthRoutes(connection: Connection, jwtSecret: string, origins: readonly string[], secureCookies: boolean, settings = sessionSettings.parse({})): Promise<Route[]> {
  const service = createStaffAuthService(connection, jwtSecret, settings);
  await service.initialize();
  function handler(operation: "login" | "status" | "cancel" | "change-password"): Route["handler"] {
    return async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      const cookieOptions = { httpOnly: true, secure: secureCookies || req.secure, sameSite: settings.AUTH_COOKIE_SAME_SITE, path };
      try {
        if (operation !== "status" && (req.get("Origin") || req.get("Cookie")) && !trustedCookieMutation(req, origins)) throw new StaffError(403, "FORBIDDEN", "Untrusted authentication request");
        const schema = operation === "login" ? loginInput : operation === "change-password" ? changePasswordInput : z.object({}).strict();
        const input = schema.safeParse(req.body ?? {});
        if (!input.success) throw new StaffError(400, "VALIDATION_ERROR", "Invalid authentication fields");
        let token = readChallenge(req.get("Cookie") ?? "");
        if (operation === "cancel") {
          await service.cancel(token); res.clearCookie(challengeCookie, cookieOptions);
          return res.json({ data: { ok: true } });
        }
        const result = operation === "login" ? await service.login(loginInput.parse(input.data), req.ip ?? "unknown")
          : await service.challenge(token, operation, input.data);
        if (result.kind === "session") {
          res.clearCookie(challengeCookie, cookieOptions);
          setSessionCookies(res, result.pair, cookieOptions.secure, settings.AUTH_COOKIE_SAME_SITE);
          return res.json({ data: { user: result.user, accessTokenExpiresInSeconds: result.pair.accessTokenExpiresInSeconds,
            ...(req.get("X-Client") !== "admin" && { accessToken: result.pair.accessToken }) } });
        }
        if (result.kind === "challenge") {
          clearSessionCookies(res, cookieOptions.secure, settings.AUTH_COOKIE_SAME_SITE);
          res.cookie(challengeCookie, result.token, { ...cookieOptions, maxAge: 600000 });
          return res.json({ data: { nextAction: result.nextAction, expiresInSeconds: 600 } });
        }
        return res.json({ data: { nextAction: result.kind === "status" ? result.nextAction : null } });
      } catch (error) {
        if (error instanceof StaffError) {
          if (error.status === 429) res.setHeader("Retry-After", "900");
          return res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.getHeader("X-Request-Id") } });
        }
        next(error);
      }
    };
  }
  return [
    { method: "post", path: "/admin/auth/login", handler: handler("login") },
    { method: "get", path: "/admin/auth/status", handler: handler("status") },
    { method: "post", path: "/admin/auth/cancel", handler: handler("cancel") },
    { method: "post", path: "/admin/auth/change-password", handler: handler("change-password") },
  ];
}
