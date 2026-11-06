import type { Connection } from "mongoose";
import mongoose from "mongoose";
import type { Route } from "../platform/routes.js";
import { createAvailabilityModule, notifyProductsFrom, type CustomerResolver } from "../modules/availability/availability.public.js";
import { createCatalogModule, denyAll, type AuthResolver, type MediaPort, type ProductUsagePort } from "../modules/catalog/catalog.public.js";
import {
  createOfferingsModule, noWarehouses, productDirectoryFrom, type EventPublisher, type WarehouseDirectory,
} from "../modules/offerings/offerings.public.js";

export interface Dev2Options {
  connection?: Connection;
  /** Resolves the logged-in staff member. Until Dev 1's auth port exists, the default denies everyone (401). */
  auth?: AuthResolver;
  /** Resolves the logged-in customer for Notify Me. Until the customer session is wired in, nobody is logged in (401). */
  customer?: CustomerResolver;
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
  const ensureIndexes = () => (indexes ??= Promise.all([catalog.store.ensureIndexes(), offerings.store.ensureIndexes(), availability.store.ensureIndexes()])
    .then(() => undefined, error => { indexes = undefined; throw error; }));
  const authThenIndexes: AuthResolver = async req => {
    const actor = await auth(req);
    if (actor) await ensureIndexes();
    return actor;
  };
  const customerThenIndexes: CustomerResolver | undefined = options.customer && (async req => {
    const who = await options.customer!(req);
    if (who) await ensureIndexes();
    return who;
  });

  // The catalog protects products that are already for sale through the offerings module, which is built just after it.
  const usage: ProductUsagePort = {
    offeringCount: id => offerings.usage.offeringCount(id),
    canDelete: id => offerings.usage.canDelete(id),
    touchOfferings: id => offerings.usage.touchOfferings(id),
  };
  const catalog = createCatalogModule({ connection, auth: authThenIndexes, usage, ...(options.media && { media: options.media }) });
  const offerings = createOfferingsModule({
    connection, auth: authThenIndexes, products: productDirectoryFrom(catalog),
    ...(options.warehouses && { warehouses: options.warehouses }),
    // Stock events go to the caller's listener and to Notify Me. A failing listener never undoes a stock change.
    events: { publish: async event => { await Promise.allSettled([options.events?.publish(event), availability.onStockEvent(event)]); } },
    ...(options.hasOrders && { hasOrders: options.hasOrders }),
  });
  const availability = createAvailabilityModule({
    connection, auth: authThenIndexes, products: notifyProductsFrom(catalog), warehouses: options.warehouses ?? noWarehouses,
    zones: { check: (zoneId, productId) => offerings.offerings.zoneAvailability(zoneId, productId) },
    ...(customerThenIndexes && { customer: customerThenIndexes }),
  });
  return {
    catalog, offerings, availability, stock: offerings.stock,
    routes: [...catalog.routes, ...offerings.routes, ...availability.routes] satisfies Route[], ensureIndexes,
  };
}

export function dev2Routes(options: Dev2Options = {}): Route[] { return createDev2Modules(options).routes; }
