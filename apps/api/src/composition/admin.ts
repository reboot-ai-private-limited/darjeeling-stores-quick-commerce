import type { Request } from "express";
import type { Connection } from "mongoose";
import type { Route } from "../platform/routes.js";
import type { Actor, AuthResolver } from "../modules/catalog/catalog.public.js";
import { createCustomersModule } from "../modules/customers/customers.public.js";
import { createMediaModule, storageFromEnv } from "../modules/media/media.public.js";
import { createReportsModule, type SettingsSource } from "../modules/reports/reports.public.js";
import { createSettingsModule, type SettingsService } from "../modules/settings/settings.public.js";
import { createSettingsProviders, type SettingsProviders } from "./settings-providers.js";

/** What the staff session resolver (identity) returns. */
export interface StaffSession { id: string; roleName: string; permissions: readonly string[]; scope: { all: boolean; warehouseIds: readonly string[] } }

export interface AdminOptions {
  connection: Connection;
  /** Resolves the signed-in staff member (identity module). */
  resolveStaff: (req: Request) => Promise<StaffSession | null> | StaffSession | null;
  /** The browser origins allowed to change data with a cookie session. */
  trustedOrigins: readonly string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * Settings, dashboard and reports, and customers (F25).
 * A cookie session may only change data from a trusted origin with the CSRF header; a bearer token is not sent by browsers on their own, so it is exempt.
 */
export function createAdminModules({ connection, resolveStaff, trustedOrigins, env = process.env }: AdminOptions): { routes: Route[]; ensureIndexes: () => Promise<void>; auth: AuthResolver; providers: SettingsProviders; settings: SettingsService } {
  const auth: AuthResolver = async (req): Promise<Actor | undefined> => {
    const safeMethod = req.method === "GET" || req.method === "HEAD";
    if (!safeMethod && !req.get("Authorization")) {
      const origin = req.get("Origin");
      if (!origin || !trustedOrigins.includes(origin) || req.get("X-CSRF-Token") !== "1") return undefined;
    }
    const staff = await resolveStaff(req);
    return staff ? { userId: staff.id, role: staff.roleName, permissions: staff.permissions, scope: staff.scope } : undefined;
  };

  const settings = createSettingsModule({ connection, auth });
  const dashboardSettings: SettingsSource = async warehouseId => {
    const scope = warehouseId ? { type: "warehouse" as const, id: warehouseId } : { type: "global" as const, id: null };
    const [assignment, stock] = await Promise.all([settings.service.effectiveValues("assignment", scope), settings.service.effectiveValues("stock", scope)]);
    return { delayedAfterMinutes: Number(assignment.delayedAfterMinutes), lowStockGrams: Number(stock.lowStockGrams), lowStockUnits: Number(stock.lowStockUnits) };
  };
  const reports = createReportsModule({ connection, auth, settings: dashboardSettings });
  const media = createMediaModule({ connection, storage: storageFromEnv(env) });
  const customers = createCustomersModule({
    connection, auth, media: { removeAddressMedia: (addressId, reason) => media.service.removeForOwner({ type: "address", id: addressId }, reason) },
  });

  const providers = createSettingsProviders(settings.service);
  return { routes: [...settings.routes, ...reports.routes, ...customers.routes], ensureIndexes: async () => { await settings.store.ensureIndexes(); }, auth, providers, settings: settings.service };
}
