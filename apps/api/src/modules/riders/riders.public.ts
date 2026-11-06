import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import type { RiderIdentity } from "../../platform/identity.js";
import { AppError, denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { createRiderService } from "./application/rider-service.js";
import type { RiderLoads, RiderMedia } from "./application/ports.js";
import { DEFAULT_RIDER_SETTINGS, type RiderSettings } from "./domain/rider.js";
import { createMongoRiderStore } from "./infrastructure/mongo-rider-store.js";
import { noRiders, riderGuarded, riderRoutes, type RiderResolver } from "./interface/routes.js";

export type { RiderService } from "./application/rider-service.js";
export type { RiderLoads, RiderMedia } from "./application/ports.js";
export { DEFAULT_RIDER_SETTINGS, haversineMeters, riderView, type Rider, type RiderSettings, type RiderStatus, type Shift } from "./domain/rider.js";
export { noRiders, riderGuarded, riderRoutes, type RiderResolver } from "./interface/routes.js";

/** Until Dev 1's login accounts exist, rider accounts cannot be created or switched off. */
export const unavailableRiderIdentity: RiderIdentity = {
  register: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Rider accounts are not connected yet"); },
  rename: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Rider accounts are not connected yet"); },
  setActive: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Rider accounts are not connected yet"); },
};
export const noLoads: RiderLoads = { pickedUpCount: async () => 0 };

export interface RidersModuleOptions {
  connection: Connection;
  geography?: Geography;
  identity?: RiderIdentity;
  /** Profile photos (F24). */
  media: RiderMedia;
  /** What dispatch knows about a rider's orders. */
  loads?: RiderLoads;
  settings?: Partial<RiderSettings>;
  /** Who the signed-in rider is. Until the identity session is connected, nobody is signed in (401). */
  rider?: RiderResolver;
  auth?: AuthResolver;
}

/** Builds rider profiles, shifts and attendance (F19). Call `store.ensureIndexes()` once after the database connects. */
export function createRidersModule(options: RidersModuleOptions) {
  const { connection, geography = noGeography, identity = unavailableRiderIdentity, media, loads = noLoads, rider = noRiders, auth = denyAll } = options;
  const settings: RiderSettings = { ...DEFAULT_RIDER_SETTINGS, ...options.settings };
  const store = createMongoRiderStore(connection);
  const service = createRiderService({ store, geography, identity, media, loads, settings, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() });
  return { store, service, settings, routes: riderRoutes(service, rider, auth) };
}
