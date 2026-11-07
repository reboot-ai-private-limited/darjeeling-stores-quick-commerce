import type { Connection } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { createCustomerService } from "./application/customer-service.js";
import { noCustomerMedia, type CustomerMedia } from "./application/ports.js";
import { createMongoCustomerStore } from "./infrastructure/mongo-customer-store.js";
import { customerRoutes } from "./interface/routes.js";

export type { CustomerService } from "./application/customer-service.js";
export type { CustomerMedia } from "./application/ports.js";

export interface CustomersModuleOptions {
  connection: Connection; auth?: AuthResolver;
  /** Removes an address's voice note and photo when an account is finalised. Without it no files are removed. */
  media?: CustomerMedia;
}

/** Customer administration (F25): search, block, COD flag, notes, account deletion and export. */
export function createCustomersModule(options: CustomersModuleOptions) {
  const store = createMongoCustomerStore(options.connection);
  const service = createCustomerService({ store, media: options.media ?? noCustomerMedia, now: () => new Date() });
  return { store, service, routes: customerRoutes(service, options.auth ?? denyAll) };
}
