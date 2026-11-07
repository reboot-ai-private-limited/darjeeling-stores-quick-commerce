import type { Request } from "express";
import { Types, type Connection } from "mongoose";
import type { RiderIdentity } from "../../platform/identity.js";
import { sessionSettings } from "../../config/env.js";
import { createSessionStore } from "./infrastructure/sessions.js";
import { accessCredential } from "./interface/session-cookies.js";

/** Who is signed in: any kind of account, with what it may do. Built from the access token (or session cookie) of the request. */
export interface SignedInUser {
  id: string; kind: "staff" | "customer" | "rider"; roleName: string; permissions: readonly string[];
  scope: { all: boolean; warehouseIds: readonly string[] };
}

export interface UserResolverOptions {
  jwtSecret: string; sessionOptions?: Partial<ReturnType<typeof sessionSettings.parse>>;
  /** Accounts made for development are refused unless this is on. */
  allowDevelopmentAccounts?: boolean;
  /** Browser origins that may change data with a cookie session (they must also send `X-CSRF-Token: 1`). A bearer token is exempt. */
  trustedOrigins?: readonly string[];
}

/**
 * Resolvers for the three kinds of login, all reading the same session store the sign-in routes write to.
 * A deactivated, blocked or deleted account, a revoked or expired session, and a cookie session making a change from an untrusted
 * origin are all treated as "nobody is signed in".
 */
export function createUserResolvers(connection: Connection, options: UserResolverOptions) {
  const sessions = createSessionStore(connection, options.jwtSecret, options.sessionOptions);
  const trusted = options.trustedOrigins ?? [];

  async function whoIs(req: Request): Promise<SignedInUser | null> {
    const credential = accessCredential(req);
    if (!credential) return null;
    // A browser sends cookies by itself, so a change made with one must come from one of our own pages.
    if (req.method !== "GET" && req.method !== "HEAD" && !req.get("Authorization")) {
      const origin = req.get("Origin");
      if (!origin || !trusted.includes(origin) || req.get("X-CSRF-Token") !== "1") return null;
    }
    const userId = await sessions.authenticate(credential);
    if (!userId) return null;
    const user = await connection.collection("users").findOne({ _id: userId, status: "active" });
    if (!user || (user.devMockAccount && !options.allowDevelopmentAccounts)) return null;
    if (user.kind !== "staff" && user.kind !== "customer" && user.kind !== "rider") return null;
    const role = await connection.collection("roles").findOne({ _id: user.roleId });
    if (!role || !Array.isArray(role.permissions)) return null;
    // The wildcard belongs to the system owner role alone.
    if (role.permissions.includes("*") && (role.name !== "super_admin" || role.isSystem !== true)) return null;
    return {
      id: String(userId), kind: user.kind, roleName: String(role.name), permissions: role.permissions.map(String),
      scope: user.kind === "staff"
        ? { all: user.scope?.all === true, warehouseIds: Array.isArray(user.scope?.warehouseIds) ? user.scope.warehouseIds.map(String) : [] }
        : { all: false, warehouseIds: [] },
    };
  }

  return {
    whoIs,
    /** The signed-in customer, or nobody. */
    async customer(req: Request): Promise<{ userId: string } | undefined> { const u = await whoIs(req); return u?.kind === "customer" ? { userId: u.id } : undefined; },
    /** The signed-in rider login, or nobody. (Whether the rider record is active is checked by the rider module.) */
    async rider(req: Request): Promise<{ userId: string } | undefined> { const u = await whoIs(req); return u?.kind === "rider" ? { userId: u.id } : undefined; },
    /** Anyone signed in, for the media routes. */
    async principal(req: Request) {
      const u = await whoIs(req);
      return u ? { userId: u.id, kind: u.kind, role: u.roleName, permissions: u.permissions, scope: u.scope } : undefined;
    },
  };
}

const PHONE = /^\+[1-9]\d{7,14}$/;

/** Rider login accounts, for the rider module (F01 and F19): made ahead of the rider's first sign-in, switched off and on, and renamed. */
export function createRiderIdentity(connection: Connection): RiderIdentity {
  const users = () => connection.collection("users");
  return {
    async register({ name, phone }) {
      if (!PHONE.test(phone)) return { ok: false, reason: "phone_used" };
      const role = await connection.collection("roles").findOne({ name: "rider", isSystem: true });
      if (!role) throw new Error("The rider role is missing; start the API once so the roles are created");
      if (await users().findOne({ phone }, { projection: { _id: 1 } })) return { ok: false, reason: "phone_used" };
      const now = new Date();
      const _id = new Types.ObjectId();
      try {
        await users().insertOne({ _id, kind: "rider", roleId: role._id, name, phone, status: "active", scope: { all: false, warehouseIds: [] }, credentialRevision: 0, createdAt: now, updatedAt: now });
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000) return { ok: false, reason: "phone_used" };
        throw error;
      }
      return { ok: true, userId: String(_id) };
    },
    async rename(userId, name) {
      if (Types.ObjectId.isValid(userId)) await users().updateOne({ _id: new Types.ObjectId(userId), kind: "rider" }, { $set: { name, updatedAt: new Date() } });
    },
    async setActive(userId, active) {
      if (!Types.ObjectId.isValid(userId)) return;
      const id = new Types.ObjectId(userId);
      const at = new Date();
      await users().updateOne({ _id: id, kind: "rider" }, { $set: { status: active ? "active" : "deactivated", updatedAt: at }, $inc: { credentialRevision: 1 } });
      // Switching a rider off ends every session at once, so the phone stops working immediately.
      if (!active) await connection.collection("auth_sessions").updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: at } });
    },
  };
}

/** What the notification and discovery modules need to know about people: phones, push tokens, who lives in which zone, who may pay cash. */
export function createPeopleDirectories(connection: Connection) {
  const users = () => connection.collection("users");
  const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
  return {
    contacts: {
      async phoneOf(userId: string): Promise<string | null> {
        const id = oid(userId);
        const user = id ? await users().findOne({ _id: id }, { projection: { phone: 1 } }) : null;
        return typeof user?.phone === "string" ? user.phone : null;
      },
    },
    devices: {
      async tokensFor(userId: string): Promise<string[]> {
        const id = oid(userId);
        if (!id) return [];
        return (await connection.collection("device_tokens").find({ userId: id }).toArray()).map(d => String(d.fcmToken));
      },
      async removeToken(token: string): Promise<void> { await connection.collection("device_tokens").deleteMany({ fcmToken: token }); },
    },
    audience: {
      /** Active customers who have an address in one of the zones, in id order. */
      async customerIds(zoneIds: readonly string[], afterId: string | undefined, limit: number): Promise<string[]> {
        const rows = await connection.collection("addresses").aggregate([
          { $match: { zoneId: { $in: [...zoneIds] }, ...(afterId && { userId: { $gt: afterId } }) } },
          { $group: { _id: "$userId" } }, { $sort: { _id: 1 } }, { $limit: Math.max(1, limit) * 3 },
        ]).toArray();
        const ids = rows.map(r => String(r._id)).filter(id => Types.ObjectId.isValid(id));
        const active = new Set((await users().find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) }, kind: "customer", status: "active" }, { projection: { _id: 1 } }).toArray()).map(u => String(u._id)));
        return ids.filter(id => active.has(id)).slice(0, limit);
      },
    },
    /** A blocked or deleted customer, or one an admin switched off for cash, cannot pay on delivery. */
    customerPolicy: {
      async codAllowed(userId: string): Promise<boolean> {
        const id = oid(userId);
        const user = id ? await users().findOne({ _id: id }, { projection: { status: 1, codAllowed: 1 } }) : null;
        return !!user && user.status === "active" && user.codAllowed !== false;
      },
    },
    /** Whether any order ever contained the product, so the catalog does not delete one that was sold. */
    async hasOrders(productId: string): Promise<boolean> {
      return (await connection.collection("orders").countDocuments({ "items.productId": productId }, { limit: 1 })) > 0;
    },
  };
}
