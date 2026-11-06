import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { createCatalogService } from "./application/catalog-service.js";
import type { MediaPort, ProductUsagePort } from "./application/ports.js";
import { createMongoCatalogStore } from "./infrastructure/mongo-catalog-store.js";
import { catalogRoutes } from "./interface/routes.js";
import { denyAll, type AuthResolver } from "./interface/http-support.js";

export type { Actor, Ctx, MediaPort, ProductUsagePort, CatalogStore } from "./application/ports.js";
export type { ProductView } from "./application/types.js";
export type { CatalogService } from "./application/catalog-service.js";
export type { Product, Variant, Category, ProductType, StockMode, ProductStatus, Nutrition, KeyInfoRow, InfoSection } from "./domain/product.js";
export { AppError, conflict, forbidden, notFound, validation, type ErrorCode } from "./domain/errors.js";
export { assertWarehouseScope, denyAll, guarded, parse, pathId, sendData, sendError, type AuthResolver } from "./interface/http-support.js";
export { catalogRoutes } from "./interface/routes.js";
export { createCatalogService } from "./application/catalog-service.js";
export { createMongoCatalogStore } from "./infrastructure/mongo-catalog-store.js";

/** Stand-in until the media module (F24) exists: images cannot be attached because no file can be found. */
export const noMedia: MediaPort = {
  describe: async () => null,
  urls: async () => ({}),
  remove: async () => undefined,
};

/** Conservative default: nothing may be hard-deleted until the offerings and orders checks are wired in. */
export const protectiveUsage: ProductUsagePort = {
  offeringCount: async () => 0,
  canDelete: async () => false,
  touchOfferings: async () => undefined,
};

export interface CatalogModuleOptions {
  connection: Connection;
  auth?: AuthResolver;
  media?: MediaPort;
  usage?: ProductUsagePort;
}

/** Builds the catalog service and its routes. Call `store.ensureIndexes()` once after the database connects. */
export function createCatalogModule({ connection, auth = denyAll, media = noMedia, usage = protectiveUsage }: CatalogModuleOptions) {
  const store = createMongoCatalogStore(connection);
  const service = createCatalogService({ store, media, usage, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() });
  return { store, service, routes: catalogRoutes(service, auth) };
}
