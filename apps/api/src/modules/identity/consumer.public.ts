import type { Connection } from "mongoose";
import { sessionSettings } from "../../config/env.js";
import type { Route } from "../../platform/routes.js";
import { createAccountService } from "./infrastructure/accounts.js";
import { createOtpService, type ConsumerOptions } from "./infrastructure/otp.js";
import { createSessionStore } from "./infrastructure/sessions.js";
import { createIdentityStore } from "./identity.public.js";
import { createAccessStore } from "../access/access.public.js";
import { accessCredential, clearSessionCookies, setSessionCookies, trustedCookieMutation } from "./interface/session-cookies.js";
import { nativeClient } from "./interface/native-session.js";
import { deletionRequest, deviceInput, fcmToken, IdentityError, otpRequest, otpVerify, phoneRequest, phoneVerify, profileUpdate } from "./domain/consumer-policy.js";
export type { ConsumerOptions, OtpTransport } from "./infrastructure/otp.js";

export async function createConsumerRoutes(connection: Connection, jwtSecret: string, options: ConsumerOptions, origins: readonly string[] = [], secureCookies = false, settings = sessionSettings.parse({})): Promise<Route[]> {
  const otp = createOtpService(connection, jwtSecret, options, settings);
  const accounts = createAccountService(connection, jwtSecret, options.mockOTP, settings);
  const sessions = createSessionStore(connection, jwtSecret, settings);
  await createIdentityStore(connection).initialize(); await createAccessStore(connection).initialize();
  await otp.initialize(); await accounts.initialize();
  function handler(operation: "request" | "verify" | "update" | "phone-request" | "phone-verify" | "delete-request" | "register-device" | "remove-device"): Route["handler"] {
    return async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        if ((req.get("Cookie") || req.get("Origin")) && !trustedCookieMutation(req, origins)) throw new IdentityError(403, "FORBIDDEN", "Untrusted identity mutation");
        if (operation !== "request" && operation !== "verify" && !await sessions.authenticate(accessCredential(req))) throw new IdentityError(401, "UNAUTHORIZED", "Sign in again");
        const schema = { request: otpRequest, verify: otpVerify, update: profileUpdate, "phone-request": phoneRequest,
          "phone-verify": phoneVerify, "delete-request": deletionRequest, "register-device": deviceInput, "remove-device": fcmToken }[operation];
        const parsed = schema.safeParse(operation === "remove-device" ? req.params.fcmToken : req.body ?? {});
        if (!parsed.success) throw new IdentityError(400, "VALIDATION_ERROR", "Invalid identity fields");
        const token = accessCredential(req), requestId = String(res.getHeader("X-Request-Id"));
        if (operation === "request") return res.json({ data: await otp.requestLogin(otpRequest.parse(parsed.data), req.ip ?? "unknown") });
        if (operation === "verify") {
          const result = await otp.verifyLogin(otpVerify.parse(parsed.data), requestId);
          if (!result.pair || !result.user) throw new IdentityError(401, "UNAUTHORIZED", "Sign in again");
          const native = nativeClient(req);
          if (native && native !== result.user.kind) { await sessions.revoke(result.pair.accessToken, result.pair.refreshToken); throw new IdentityError(403, "FORBIDDEN", "Client app does not match this account"); }
          if (!native) setSessionCookies(res, result.pair, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
          return res.json({ data: { user: result.user, isNewUser: result.isNewUser, accessTokenExpiresInSeconds: result.pair.accessTokenExpiresInSeconds,
            ...(native ? { accessToken: result.pair.accessToken, refreshToken: result.pair.refreshToken } : !req.get("Origin") && !req.get("Cookie") && req.get("X-Client") !== "admin" && req.get("X-Client") !== "web" ? { accessToken: result.pair.accessToken } : {}),
            ...(options.mockOTP && { mockOTP: true }) } });
        }
        if (operation === "update") return res.json({ data: await accounts.update(token, profileUpdate.parse(parsed.data), requestId) });
        if (operation === "phone-request") return res.json({ data: await otp.requestPhone(token, phoneRequest.parse(parsed.data).phone, req.ip ?? "unknown") });
        if (operation === "phone-verify") return res.json({ data: (await otp.verifyPhone(token, phoneVerify.parse(parsed.data), requestId)).user });
        if (operation === "register-device") return res.json({ data: await accounts.registerDevice(token, deviceInput.parse(parsed.data), requestId) });
        if (operation === "remove-device") return res.json({ data: await accounts.removeDevice(token, fcmToken.parse(parsed.data), requestId) });
        const data = await accounts.deleteRequest(token, deletionRequest.parse(parsed.data).reason, requestId);
        clearSessionCookies(res, secureCookies || req.secure, settings.AUTH_COOKIE_SAME_SITE);
        return res.json({ data });
      } catch (error) {
        if (error instanceof IdentityError) {
          if (error.status === 429) res.setHeader("Retry-After", error.code === "RATE_LIMITED" ? "3600" : "900");
          return res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.getHeader("X-Request-Id"), ...(error.details !== undefined && { details: error.details }) } });
        }
        next(error);
      }
    };
  }
  return [
    { method: "post", path: "/auth/request-otp", handler: handler("request") },
    { method: "post", path: "/auth/verify-otp", handler: handler("verify") },
    { method: "put", path: "/me", handler: handler("update") },
    { method: "post", path: "/me/phone/request-otp", handler: handler("phone-request") },
    { method: "post", path: "/me/phone/verify", handler: handler("phone-verify") },
    { method: "post", path: "/me/delete-request", handler: handler("delete-request") },
    { method: "post", path: "/devices", handler: handler("register-device") },
    { method: "delete", path: "/devices/:fcmToken", handler: handler("remove-device") },
  ];
}
