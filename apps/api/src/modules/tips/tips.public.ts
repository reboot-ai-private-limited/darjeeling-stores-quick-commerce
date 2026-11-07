import type { Connection } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { noRiders, type Rider, type RiderResolver } from "../riders/riders.public.js";
import { createTipService } from "./application/tip-service.js";
import { createMongoTipStore } from "./infrastructure/mongo-tip-store.js";
import { tipRoutes } from "./interface/routes.js";

export type { TipService } from "./application/tip-service.js";

export interface TipsModuleOptions {
  connection: Connection; auth?: AuthResolver; rider?: RiderResolver;
  /** The rider record for a login. Without it the rider endpoint answers 401. */
  findRider?: (userId: string) => Promise<Rider | null>;
}

/** Rider tips (F22): the rider's own earnings and the owner's list of tips still to pay. */
export function createTipsModule(options: TipsModuleOptions) {
  const store = createMongoTipStore(options.connection);
  const service = createTipService({ store, now: () => new Date() });
  return { store, service, routes: tipRoutes(service, options.rider ?? noRiders, options.findRider ?? (async () => null), options.auth ?? denyAll) };
}
