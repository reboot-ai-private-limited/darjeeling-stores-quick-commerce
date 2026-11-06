import type { Connection } from "mongoose";
import { noOrders, type OrdersPort } from "../../platform/orders.js";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { noRiders, type RiderResolver, type RiderService } from "../riders/riders.public.js";
import { createSyncService, type SyncDeps } from "./application/sync-service.js";
import { DEFAULT_SYNC_SETTINGS, type SyncSettings } from "./domain/sync.js";
import { createMongoSyncStore } from "./infrastructure/mongo-sync-store.js";
import { syncRoutes } from "./interface/routes.js";

export type { SyncService, SyncEvent } from "./application/sync-service.js";
export type { SyncSettings } from "./domain/sync.js";
export { DEFAULT_SYNC_SETTINGS } from "./domain/sync.js";
export { syncRoutes } from "./interface/routes.js";

export interface SyncModuleOptions {
  connection: Connection;
  riders: SyncDeps["riders"] & Pick<RiderService, "forUser">;
  field: SyncDeps["field"];
  cash: SyncDeps["cash"];
  tracking: SyncDeps["tracking"];
  media: SyncDeps["media"];
  orders?: OrdersPort;
  settings?: Partial<SyncSettings>;
  rider?: RiderResolver;
  auth?: AuthResolver;
}

/** Builds the rider's offline bundle and sync queue, and the review of offline deliveries (F21). Call `store.ensureIndexes()` once after the database connects. */
export function createSyncModule(options: SyncModuleOptions) {
  const { connection, riders, field, cash, tracking, media, orders = noOrders, rider = noRiders, auth = denyAll } = options;
  const settings: SyncSettings = { ...DEFAULT_SYNC_SETTINGS, ...options.settings };
  const store = createMongoSyncStore(connection);
  const service = createSyncService({ store, orders, settings, now: () => new Date(), field, cash, tracking, riders, media });
  return { store, service, settings, routes: syncRoutes(service, riders, rider, auth) };
}
