import type { Connection } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { createSettingsService } from "./application/settings-service.js";
import { createMongoSettingsStore } from "./infrastructure/mongo-settings-store.js";
import { settingsRoutes } from "./interface/routes.js";

export type { SettingsService, GroupView, SettingView } from "./application/settings-service.js";
export { REGISTRY, GROUPS, DEFS, resolveKey, changeProblems, type Group, type ScopeRef, type SettingDef, type SettingValue } from "./domain/registry.js";

export interface SettingsModuleOptions { connection: Connection; auth?: AuthResolver }

/** Scoped settings with history (F25). Call `store.ensureIndexes()` once after the database connects. */
export function createSettingsModule(options: SettingsModuleOptions) {
  const store = createMongoSettingsStore(options.connection);
  const service = createSettingsService({ store, now: () => new Date() });
  return { store, service, routes: settingsRoutes(service, options.auth ?? denyAll) };
}
