import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Types, type ClientSession, type Connection } from "mongoose";
import { createAccessStore } from "../../access/access.public.js";
import { createAuditWriter } from "../../audit/audit.public.js";
import { sessionSettings } from "../../../config/env.js";
import { IdentityError } from "../domain/consumer-policy.js";
import { createSessionStore } from "./sessions.js";
import { readProfile, type IdentityUser } from "./profile.js";

export interface OtpTransport { send(input: { phone: string; code: string; channel: "sms" | "whatsapp"; signal: AbortSignal }): Promise<void> }
export type ConsumerOptions = { mode: string; mockOTP: boolean; transport?: OtpTransport };
type Challenge = { _id: string; nonce: string; phone: string; app: "customer" | "rider" | "admin";
  purpose: "login" | "phone_change"; userId: Types.ObjectId | null; sourcePhone: string | null; revision: number;
  hash: string; mock: boolean; attempts: number; expiresAt: Date; purgeAt: Date; lockedUntil: Date | null;
  consumedAt: Date | null; sent: boolean };
const ttlSeconds = 300, maxAttempts = 5, maxPerHour = 5;
type Failure = { error: IdentityError };

export function createOtpService(connection: Connection, jwtSecret: string, options: ConsumerOptions, settings = sessionSettings.parse({})) {
  if (options.mockOTP && (options.mode !== "development" || !/_(dev|test)$/.test(connection.name))) throw new Error("Mock OTP requires development mode and a database ending in _dev or _test");
  const users = connection.collection<IdentityUser>("users");
  const challenges = connection.collection<Challenge>("otps");
  const limits = connection.collection<{ _id: string; count: number; expiresAt: Date }>("otp_limits");
  const access = createAccessStore(connection);
  const sessions = createSessionStore(connection, jwtSecret, settings);
  const audit = createAuditWriter(connection);
  const hash = (value: string) => createHmac("sha256", Buffer.from(jwtSecret, "hex")).update(`consumer-otp:${value}`).digest("hex");
  const challengeId = (purpose: string, phone: string, userId?: Types.ObjectId) => hash(`${purpose}:${userId ?? ""}:${phone}`);
  const unavailable = () => { if (!options.mockOTP && !options.transport) throw new IdentityError(503, "OTP_DELIVERY_UNAVAILABLE", "OTP delivery is not configured"); };
  async function transaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = await connection.startSession();
    try { return await session.withTransaction(() => work(session)); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new IdentityError(409, "CONFLICT", "Phone number is already in use");
      throw error;
    } finally { await session.endSession(); }
  }
  async function quota(phone: string, ip: string, userId?: Types.ObjectId) {
    const bucket = Math.floor(Date.now() / 3600000);
    const keys = [`phone:${phone}`, `ip:${ip}`, ...(userId ? [`user:${userId}`] : [])];
    for (const key of keys) {
      const counter = await limits.findOneAndUpdate({ _id: hash(`limit:${bucket}:${key}`) },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * 3600000) } }, { upsert: true, returnDocument: "after" });
      if (counter && counter.count > maxPerHour) throw new IdentityError(429, "RATE_LIMITED", "Too many OTP requests. Try again later.");
    }
  }
  async function deliver(phone: string, code: string, channel: "sms" | "whatsapp") {
    if (options.mockOTP) return "mock" as const;
    const send = async (choice: "sms" | "whatsapp") => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([options.transport!.send({ phone, code, channel: choice, signal: controller.signal }), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("OTP delivery timed out")); }, 10000);
        })]);
      } finally { clearTimeout(timer); }
    };
    try { await send(channel); return channel; }
    catch {
      if (channel === "whatsapp") { try { await send("sms"); return "sms" as const; } catch { /* Return the same safe provider failure. */ } }
      throw new IdentityError(502, "OTP_DELIVERY_FAILED", "The code could not be sent. Try again later.");
    }
  }
  async function activeCustomer(token: string, session?: ClientSession) {
    const id = await sessions.authenticate(token, session);
    if (!id) throw new IdentityError(401, "UNAUTHORIZED", "Sign in again");
    const filter = { _id: id, kind: "customer" as const, status: "active" };
    const user = session ? await users.findOneAndUpdate(filter, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" }) : await users.findOne(filter);
    if (!user) throw new IdentityError(403, "FORBIDDEN", "Customer account required");
    return user;
  }
  async function request(input: { phone: string; app: Challenge["app"]; channel: "sms" | "whatsapp" }, ip: string, user?: IdentityUser) {
    unavailable();
    const developmentOwner = options.mockOTP && input.app === "admin";
    if (!developmentOwner) await quota(input.phone, ip, user?._id);
    const existing = await users.findOne({ phone: input.phone });
    if (user) {
      if (existing) throw new IdentityError(409, "CONFLICT", "Phone number is already in use");
    } else if (input.app === "admin") {
      if (!developmentOwner || input.phone !== "+919000000001" || existing?.kind !== "staff" || !existing.devMockAccount || existing.status !== "active") throw new IdentityError(403, "OTP_REQUEST_REJECTED", "Account unavailable");
    } else if ((existing && (existing.kind !== input.app || existing.status !== "active" || (existing.devMockAccount && !options.mockOTP))) || (!existing && input.app === "rider")) {
      throw new IdentityError(403, "OTP_REQUEST_REJECTED", "Account unavailable");
    }
    const purpose = user ? "phone_change" : "login";
    const id = challengeId(purpose, input.phone, user?._id);
    const previous = await challenges.findOne({ _id: id });
    if (previous?.lockedUntil && previous.lockedUntil.getTime() > Date.now()) throw new IdentityError(429, "OTP_LOCKED", "Too many wrong codes. Try again later.");
    if (previous && !previous.consumedAt && previous.expiresAt.getTime() > Date.now()) throw new IdentityError(429, "RATE_LIMITED", "A code is already active. Wait for it to expire.");
    const code = options.mockOTP ? "000000" : String(randomInt(1, 1000000)).padStart(6, "0");
    const nonce = randomBytes(16).toString("hex");
    const challenge: Challenge = { _id: id, nonce, phone: input.phone, app: input.app, purpose,
      userId: user?._id ?? null, sourcePhone: user?.phone ?? null, revision: user?.credentialRevision ?? 0,
      hash: hash(`${id}:${nonce}:${code}`), mock: options.mockOTP, attempts: 0, expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      purgeAt: new Date(Date.now() + 3900000), lockedUntil: null, consumedAt: null, sent: false };
    try {
      if (previous) {
        if (!(await challenges.replaceOne({ _id: id, nonce: previous.nonce }, challenge)).matchedCount) throw new IdentityError(429, "RATE_LIMITED", "Another OTP request is in progress");
      } else await challenges.insertOne(challenge);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new IdentityError(429, "RATE_LIMITED", "Another OTP request is in progress");
      throw error;
    }
    try {
      const channel = await deliver(input.phone, code, input.channel);
      await challenges.updateOne({ _id: id, nonce }, { $set: { sent: true } });
      return { expiresInSeconds: ttlSeconds, channel, ...(options.mockOTP && { mockOTP: true }) };
    } catch (error) { await challenges.deleteOne({ _id: id, nonce }); throw error; }
  }
  async function verify(input: { phone: string; otp: string; deviceInfo?: string | undefined }, requestId: string, token?: string) {
    unavailable();
    const customer = token !== undefined ? await activeCustomer(token) : undefined;
    const id = challengeId(customer ? "phone_change" : "login", input.phone, customer?._id);
    const result = await transaction(async session => {
      const challenge = await challenges.findOneAndUpdate({ _id: id, consumedAt: null }, { $inc: { attempts: 0 } }, { session, returnDocument: "after" });
      if (!challenge || !challenge.sent || challenge.mock !== options.mockOTP) throw new IdentityError(401, "INVALID_OTP", "Request a code first");
      if (challenge.lockedUntil && challenge.lockedUntil.getTime() > Date.now()) throw new IdentityError(429, "OTP_LOCKED", "Too many wrong codes. Try again later.");
      if (challenge.expiresAt.getTime() <= Date.now()) throw new IdentityError(400, "OTP_EXPIRED", "The code has expired");
      const candidate = hash(`${id}:${challenge.nonce}:${input.otp}`);
      if (!timingSafeEqual(Buffer.from(challenge.hash, "hex"), Buffer.from(candidate, "hex"))) {
        const attempts = challenge.attempts + 1;
        await challenges.updateOne({ _id: id }, { $set: { attempts, ...(attempts >= maxAttempts && { lockedUntil: new Date(Date.now() + 900000) }) } }, { session });
        return { error: new IdentityError(attempts >= maxAttempts ? 429 : 401, attempts >= maxAttempts ? "OTP_LOCKED" : "INVALID_OTP", "The code is incorrect", { attemptsLeft: Math.max(0, maxAttempts - attempts) }) } satisfies Failure;
      }
      await challenges.updateOne({ _id: id }, { $set: { consumedAt: new Date() } }, { session });
      if (customer) {
        const user = await activeCustomer(token!, session);
        if (String(user._id) !== String(challenge.userId) || user.phone !== challenge.sourcePhone || (user.credentialRevision ?? 0) !== challenge.revision) return { error: new IdentityError(401, "INVALID_OTP", "Request a new phone-change code") } satisfies Failure;
        if (await users.findOne({ phone: input.phone }, { session })) return { error: new IdentityError(409, "CONFLICT", "Phone number is already in use") } satisfies Failure;
        await users.updateOne({ _id: user._id }, { $set: { phone: input.phone, updatedAt: new Date() }, $inc: { credentialRevision: 1 } }, { session });
        await challenges.deleteMany({ userId: user._id, _id: { $ne: id } }, { session });
        await sessions.revokeOtherSessions(user._id, token!, session);
        const role = await access.getRole(String(user.roleId));
        await audit({ actorId: String(user._id), actorRole: role?.name ?? "customer", action: "identity.phone_change", entityType: "user", entityId: String(user._id), requestId }, session);
        return { user: await readProfile(connection, user._id, options.mockOTP, session), isNewUser: false };
      }
      const roleRow = await connection.collection("roles").findOne({ name: challenge.app === "admin" ? "super_admin" : challenge.app }, { session });
      const role = roleRow ? await access.lockRole(roleRow._id, session) : null;
      if (!role || !role.isSystem || (challenge.app !== "admin" && role.permissions.includes("*"))) throw new IdentityError(403, "FORBIDDEN", "Account unavailable");
      let user = await users.findOneAndUpdate({ phone: input.phone }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
      const isNewUser = !user;
      if (!user && challenge.app === "customer") {
        user = { _id: new Types.ObjectId(), kind: "customer", roleId: role._id, phone: input.phone, name: "", status: "active", scope: { all: false, warehouseIds: [] }, devMockAccount: options.mockOTP, credentialRevision: 0, createdAt: new Date(), updatedAt: new Date() };
        await users.insertOne(user, { session });
      }
      const allowed = user && user.status === "active" && (!user.devMockAccount || options.mockOTP) && String(user.roleId) === String(role._id) && (challenge.app === "admin"
        ? options.mockOTP && user.kind === "staff" && user.devMockAccount && input.phone === "+919000000001" : user.kind === challenge.app);
      if (!user || !allowed) return { error: new IdentityError(403, "FORBIDDEN", "Account unavailable") } satisfies Failure;
      await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }, { session });
      await audit({ actorId: String(user._id), actorRole: role.name, action: "identity.login", entityType: "user", entityId: String(user._id), requestId }, session);
      return { user: await readProfile(connection, user._id, options.mockOTP, session), pair: await sessions.issue(user._id, session, input.deviceInfo), isNewUser };
    });
    if ("error" in result) throw result.error;
    return result;
  }
  return {
    async initialize() { await challenges.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }); await limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); await sessions.initialize(); },
    requestLogin: (input: { phone: string; app: Challenge["app"]; channel: "sms" | "whatsapp" }, ip: string) => request(input, ip),
    verifyLogin: (input: { phone: string; otp: string; deviceInfo?: string | undefined }, requestId: string) => verify(input, requestId),
    async requestPhone(token: string, phone: string, ip: string) { const user = await activeCustomer(token); return request({ phone, app: "customer", channel: "whatsapp" }, ip, user); },
    verifyPhone: (token: string, input: { phone: string; otp: string }, requestId: string) => verify(input, requestId, token),
  };
}
