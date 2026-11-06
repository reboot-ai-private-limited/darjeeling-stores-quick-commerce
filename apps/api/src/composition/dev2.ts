import type { Connection } from "mongoose";
import mongoose from "mongoose";
import type { Route } from "../platform/routes.js";
import { createCatalogModule, denyAll, type AuthResolver, type MediaPort, type ProductUsagePort } from "../modules/catalog/catalog.public.js";
import {
  createOfferingsModule, productDirectoryFrom, type EventPublisher, type WarehouseDirectory,
} from "../modules/offerings/offerings.public.js";

export interface Dev2Options {
  connection?: Connection;
  /** Resolves the logged-in actor. Until Dev 1's auth port exists, the default denies everyone (401). */
  auth?: AuthResolver;
  media?: MediaPort;
  warehouses?: WarehouseDirectory;
  events?: EventPublisher;
  hasOrders?: (productId: string) => Promise<boolean>;
}

/** Builds Dev 2's backend modules. The `stock` and `catalog` ports for the orders module are `modules.stock`. */
export function createDev2Modules(options: Dev2Options = {}) {
  const connection = options.connection ?? mongoose.connection;
  const auth = options.auth ?? denyAll;

  // Indexes are created once, on the first request from a signed-in user, so an unauthenticated request never touches the database.
  let indexes: Promise<void> | undefined;
  const ensureIndexes = () => (indexes ??= Promise.all([catalog.store.ensureIndexes(), offerings.store.ensureIndexes()])
    .then(() => undefined, error => { indexes = undefined; throw error; }));
  const authThenIndexes: AuthResolver = async req => {
    const actor = await auth(req);
    if (actor) await ensureIndexes();
    return actor;
  };

  // The catalog protects products that are already for sale through the offerings module, which is built just after it.
  const usage: ProductUsagePort = {
    offeringCount: id => offerings.usage.offeringCount(id),
    canDelete: id => offerings.usage.canDelete(id),
    touchOfferings: id => offerings.usage.touchOfferings(id),
  };
  const catalog = createCatalogModule({ connection, auth: authThenIndexes, usage, ...(options.media && { media: options.media }) });
  const offerings = createOfferingsModule({
    connection, auth: authThenIndexes, products: productDirectoryFrom(catalog),
    ...(options.warehouses && { warehouses: options.warehouses }), ...(options.events && { events: options.events }),
    ...(options.hasOrders && { hasOrders: options.hasOrders }),
  });
  return { catalog, offerings, stock: offerings.stock, routes: [...catalog.routes, ...offerings.routes] satisfies Route[], ensureIndexes };
}

export function dev2Routes(options: Dev2Options = {}): Route[] { return createDev2Modules(options).routes; }
