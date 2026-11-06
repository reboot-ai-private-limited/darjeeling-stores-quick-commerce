import type { Request } from "express";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { createApp } from "../../../src/app.js";
import type { Route } from "../../../src/platform/routes.js";
import type { Actor } from "../../../src/modules/catalog/catalog.public.js";
import type { Principal } from "../../../src/modules/media/media.public.js";

export const everything: Actor = { userId: "000000000000000000000001", role: "super_admin", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

/** Test-only login: the `X-Test-Actor` header picks who is calling. Never used outside tests. */
export function actorFromHeader(req: Request): Actor | undefined {
  const who = req.get("X-Test-Actor");
  if (!who) return undefined;
  if (who === "admin") return everything;
  if (who === "viewer") {
    return { userId: "000000000000000000000002", role: "viewer", permissions: ["catalog:view", "warehouse_catalog:view", "stock:view"], scope: { all: true, warehouseIds: [] } };
  }
  if (who.startsWith("scoped:")) {
    return {
      userId: "000000000000000000000003", role: "manager", scope: { all: false, warehouseIds: [who.slice("scoped:".length)] },
      permissions: ["catalog:view", "warehouse_catalog:view", "warehouse_catalog:manage", "catalog:import", "stock:view", "stock:manage", "notify_demand:view", "riders:view", "riders:manage", "dispatch:manage", "orders:view", "orders:manage", "warehouses:manage", "cash:manage", "delivery_rules:manage", "ops_mode:manage", "pricing:manage"],
    };
  }
  return undefined;
}

export interface Harness {
  connection: mongoose.Connection;
  stop(): Promise<void>;
  /** Drop all data so each test starts clean. Recreate indexes afterwards. */
  reset(): Promise<void>;
  appWith(routes: Route[]): ReturnType<typeof createApp>;
}

export async function startHarness(databaseName: string): Promise<Harness> {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  // The URI comes only from the freshly started local server, never from the environment.
  const connection = await mongoose.createConnection(replica.getUri(databaseName), { serverSelectionTimeoutMS: 5000 }).asPromise();
  return {
    connection,
    async stop() { await connection.close(); await replica.stop(); },
    async reset() { await connection.dropDatabase(); },
    appWith(routes) { return createApp({ isReady: () => true, dev2Routes: routes }); },
  };
}

export const api = "/api/v1";

/** Test-only customer login: the `X-Test-Customer` header carries the customer id. Never used outside tests. */
export function customerFromHeader(req: Request): { userId: string } | undefined {
  const userId = req.get("X-Test-Customer");
  return userId ? { userId } : undefined;
}

const NONE = { all: false, warehouseIds: [] as string[] };
/** Test-only login for media: `X-Test-Principal` is `customer:<id>`, `rider:<id>`, `admin`, `viewer`, `orders` or `scoped:<warehouseId>`. Never used outside tests. */
export function principalFromHeader(req: Request): Principal | undefined {
  const who = req.get("X-Test-Principal");
  if (!who) return undefined;
  const [kind, id] = who.split(":") as [string, string | undefined];
  if (kind === "customer" && id) return { userId: id, kind: "customer", role: "customer", permissions: [], scope: NONE };
  if (kind === "rider" && id) return { userId: id, kind: "rider", role: "rider", permissions: [], scope: NONE };
  const staff = (permissions: string[], scope: Principal["scope"], userId = "000000000000000000000001"): Principal => ({ userId, kind: "staff", role: "staff", permissions, scope });
  if (kind === "admin") return staff(["*"], { all: true, warehouseIds: [] });
  if (kind === "viewer") return staff(["catalog:view"], { all: true, warehouseIds: [] }, "000000000000000000000002");
  if (kind === "orders") return staff(["orders:view"], { all: true, warehouseIds: [] }, "000000000000000000000004");
  if (kind === "scoped" && id) return staff(["orders:view", "catalog:manage"], { all: false, warehouseIds: [id] }, "000000000000000000000003");
  return undefined;
}

/** Test-only rider login: the `X-Test-Rider` header carries the rider's login id. Never used outside tests. */
export function riderFromHeader(req: Request): { userId: string } | undefined {
  const userId = req.get("X-Test-Rider");
  return userId ? { userId } : undefined;
}
