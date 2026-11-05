import { randomBytes } from "node:crypto";
import { Types, type Connection } from "mongoose";
import { z } from "zod";
import type { Route } from "../../platform/routes.js";
import { createIdentityStore } from "./identity.public.js";

const phone = z.string().transform(value => value.replace(/[\s-]/g, "")).transform(value => /^\d{10}$/.test(value) ? `+91${value}` : value).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
const requestInput = z.object({ phone, app: z.enum(["customer", "rider", "admin"]).default("customer"), channel: z.enum(["sms", "whatsapp"]).optional() }).strict();
const verifyInput = z.object({ phone, otp: z.string(), deviceInfo: z.string().max(256).optional() }).strict();
const ownerPhone = "+919000000001";

export async function createDevOtpRoutes(connection: Connection, mode: string): Promise<Route[]> {
  if (mode !== "development" || !/_(dev|test)$/.test(connection.name)) throw new Error("Mock OTP requires development mode and a database ending in _dev or _test");
  const identities = createIdentityStore(connection);
  await identities.initialize();
  await connection.collection("roles").createIndex({ name: 1 }, { unique: true });
  for (const name of ["super_admin", "customer"]) {
    await connection.collection("roles").updateOne({ name }, { $setOnInsert: { name, permissions: name === "super_admin" ? ["*"] : [], isSystem: true } }, { upsert: true });
  }
  const ownerRole = await connection.collection("roles").findOne({ name: "super_admin" });
  const customerRole = await connection.collection("roles").findOne({ name: "customer" });
  if (!ownerRole || !customerRole) throw new Error("Development roles unavailable");
  const existing = await connection.collection("users").findOne({ phone: ownerPhone });
  if (existing && (!existing.devMockAccount || !existing.roleId.equals(ownerRole._id))) throw new Error("Refusing to replace an existing account with a mock super admin");
  await connection.collection("users").updateOne({ phone: ownerPhone }, { $setOnInsert: {
    phone: ownerPhone, name: "Development super admin", kind: "staff", roleId: ownerRole._id,
    status: "active", scope: { all: true, warehouseIds: [] }, devMockAccount: true, createdAt: new Date(), updatedAt: new Date(),
  } }, { upsert: true });

  // shortcut: bounded process-local dev sessions/challenges, replace with durable production authentication before real use.
  const challenges = new Map<string, { expires: number; attempts: number; app: string }>();
  const sessions = new Map<string, { userId: Types.ObjectId; expires: number }>();
  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of challenges) if (entry.expires <= now) challenges.delete(key);
    for (const [key, entry] of sessions) if (entry.expires <= now) sessions.delete(key);
  }
  const error = (res: Parameters<Route["handler"]>[1], status: number, code: string, message: string) => res.status(status).json({ error: { code, message, requestId: res.getHeader("X-Request-Id") } });
  async function profile(userId: Types.ObjectId) {
    const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
    if (!user) return null;
    const role = await connection.collection("roles").findOne({ _id: user.roleId });
    return { id: user._id.toHexString(), name: user.name, phone: user.phone, role: role?.name, status: user.status, scope: user.scope };
  }
  return [
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
      const parsed = verifyInput.safeParse(req.body);
      if (!parsed.success) return error(res, 400, "VALIDATION_ERROR", "Invalid OTP verification");
      const challenge = challenges.get(parsed.data.phone);
      if (!challenge) return error(res, 401, "INVALID_OTP", "Request a development OTP first");
      if (parsed.data.otp !== "000000") {
        challenge.attempts++;
        if (challenge.attempts >= 5) challenges.delete(parsed.data.phone);
        return error(res, 401, "INVALID_OTP", "Invalid development OTP");
      }
      if (sessions.size >= 1000) return error(res, 429, "RATE_LIMITED", "Too many development sessions");
      challenges.delete(parsed.data.phone);
      let user = await connection.collection("users").findOne({ phone: parsed.data.phone });
      if (!user) {
        try { await identities.createUser({ kind: "customer", roleId: customerRole._id.toHexString(), phone: parsed.data.phone }); }
        catch (cause) { if (!(cause && typeof cause === "object" && "code" in cause && cause.code === 11000)) throw cause; }
        user = await connection.collection("users").findOne({ phone: parsed.data.phone });
      }
      if (!user || user.status !== "active" || (user.kind !== "customer" && !(user.phone === ownerPhone && user.devMockAccount))) return error(res, 403, "FORBIDDEN", "Account unavailable");
      const accessToken = `dev_${randomBytes(32).toString("hex")}`;
      sessions.set(accessToken, { userId: user._id, expires: Date.now() + 900_000 });
      return res.json({ data: { accessToken, accessTokenExpiresInSeconds: 900, mockOTP: true, user: await profile(user._id) } });
    } },
    { method: "get", path: "/me", handler: async (req, res) => {
      cleanup();
      const session = sessions.get(req.get("Authorization")?.replace(/^Bearer /, "") ?? "");
      const user = session ? await profile(session.userId) : null;
      if (!user) return error(res, 401, "UNAUTHORIZED", "Development session required");
      return res.json({ data: user });
    } },
    { method: "post", path: "/auth/logout", handler: (req, res) => {
      sessions.delete(req.get("Authorization")?.replace(/^Bearer /, "") ?? "");
      return res.json({ data: { ok: true } });
    } },
  ];
}
