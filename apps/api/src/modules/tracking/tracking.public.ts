import type { Connection } from "mongoose";
import { noOrders, type OrdersPort } from "../../platform/orders.js";
import { noCustomers, type CustomerResolver } from "../catalog/catalog.public.js";
import { noRiders, type RiderResolver, type RiderService } from "../riders/riders.public.js";
import { createTrackingService, type TrackingDeps } from "./application/tracking-service.js";
import { createTokenSigner } from "./application/token.js";
import { baselineEta, DEFAULT_TRACKING_SETTINGS, type EtaProvider, type TrackingSettings } from "./domain/tracking.js";
import { createMongoTrackingStore } from "./infrastructure/mongo-tracking-store.js";
import { trackingRoutes } from "./interface/routes.js";

export type { TrackingService, PingInput } from "./application/tracking-service.js";
export type { EtaProvider, TrackingSettings } from "./domain/tracking.js";
export { baselineEta, DEFAULT_TRACKING_SETTINGS } from "./domain/tracking.js";
export { trackingRoutes } from "./interface/routes.js";

export interface TrackingModuleOptions {
  connection: Connection;
  riders: TrackingDeps["riders"] & Pick<RiderService, "forUser">;
  relations: TrackingDeps["relations"];
  orders?: OrdersPort;
  settings?: Partial<TrackingSettings>;
  /** Replaces the straight-line estimate, for example with a routes service. */
  eta?: EtaProvider;
  /** Signs the public tracking links. Without it links cannot be made and every link answers 404. */
  tokenSecret?: string;
  rider?: RiderResolver;
  customer?: CustomerResolver;
}

/** Builds rider positions, live ETA and tracking (F20). Call `store.ensureIndexes()` once after the database connects. */
export function createTrackingModule(options: TrackingModuleOptions) {
  const { connection, riders, relations, orders = noOrders, rider = noRiders, customer = noCustomers } = options;
  const settings: TrackingSettings = { ...DEFAULT_TRACKING_SETTINGS, ...options.settings };
  const store = createMongoTrackingStore(connection);
  const eta = options.eta ?? baselineEta(settings);
  const service = createTrackingService({
    store, orders, settings, eta, signer: createTokenSigner(options.tokenSecret), now: () => new Date(), riders, relations,
  });
  return { store, service, settings, eta, routes: trackingRoutes(service, riders, rider, customer) };
}
