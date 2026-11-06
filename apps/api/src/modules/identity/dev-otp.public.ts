import { createConsumerRoutes } from "./consumer.public.js";
import { createSessionRoutes } from "./session.public.js";
import { createAdministrationRoutes } from "./administration.public.js";
import { sessionSettings } from "../../config/env.js";
import type { Connection } from "mongoose";
import type { Route } from "../../platform/routes.js";
import { createAccessStore } from "../access/access.public.js";
import { createIdentityStore } from "./identity.public.js";

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

  return [
    ...await createAdministrationRoutes(connection, jwtSecret, origins, settings, true),
    ...await createConsumerRoutes(connection, jwtSecret, { mode, mockOTP: true }, origins, secureCookies, settings),
    ...createSessionRoutes(connection, jwtSecret, origins, secureCookies, settings, true),
  ];
}
