import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { denyAll, type AuthResolver, type CatalogStore, type ProductUsagePort } from "../catalog/catalog.public.js";
import { createOfferingsService } from "./application/offerings-service.js";
import type { EventPublisher, ProductDirectory, WarehouseDirectory } from "./application/ports.js";
import { createImportService } from "./application/import-service.js";
import { createTreeService } from "./application/tree-service.js";
import { createStockService } from "./application/stock-service.js";
import { createMongoOfferingsStore } from "./infrastructure/mongo-offerings-store.js";
import { offeringsRoutes } from "./interface/routes.js";
import type { StockThresholds } from "./domain/stock.js";

export type { StockService, ReserveLine, ReserveResult, Shortage, LineResolution, ReservationView } from "./application/stock-service.js";
export type { ImportService } from "./application/import-service.js";
export type { TreeService } from "./application/tree-service.js";
export type { OfferingsService } from "./application/offerings-service.js";
export type { EventPublisher, ProductDirectory, StockEvent, WarehouseDirectory } from "./application/ports.js";
export { offeringsRoutes } from "./interface/routes.js";

/** Stand-in until geography exists: no warehouse is known, so nothing can be offered (a safe default). */
export const noWarehouses: WarehouseDirectory = { get: async () => null };
export const noEvents: EventPublisher = { publish: () => undefined };

/** Reads master products from the catalog module and turns them into the shape stock rules need. */
export function productDirectoryFrom(catalog: { store: CatalogStore }): ProductDirectory {
  return {
    async getMany(ids) {
      return (await catalog.store.getProducts(ids)).map(p => ({
        id: p.id, name: p.name, type: p.type, stockMode: p.stockMode, categoryId: p.categoryId, status: p.status,
        variants: p.variants.map(v => ({ id: v.id, label: v.label, weightGrams: v.weightGrams, isActive: v.isActive })),
      }));
    },
    async categories() {
      return (await catalog.store.listCategories()).map(c => ({ id: c.id, name: c.name, parentId: c.parentId, sortOrder: c.sortOrder }));
    },
    // shortcut: a search matches at most 500 products; add a store-side join if a catalog ever grows past that.
    async searchIds({ q, categoryId }) {
      const rows = await catalog.store.listProducts({ limit: 500, ...(q !== undefined && { q }), ...(categoryId !== undefined && { categoryId }) });
      return rows.map(p => p.id);
    },
  };
}

export interface OfferingsModuleOptions {
  connection: Connection;
  products: ProductDirectory;
  auth?: AuthResolver;
  warehouses?: WarehouseDirectory;
  events?: EventPublisher;
  thresholds?: StockThresholds;
  /** Asks the orders module whether any order ever referenced the product. Without it, hard delete is always refused. */
  hasOrders?: (productId: string) => Promise<boolean>;
}

/** Builds stock, pricing and the `stock`/`catalog` ports. Call `store.ensureIndexes()` once after the database connects. */
export function createOfferingsModule(options: OfferingsModuleOptions) {
  const { connection, products, auth = denyAll, warehouses = noWarehouses, events = noEvents, thresholds = { grams: 5000, units: 5 }, hasOrders } = options;
  const store = createMongoOfferingsStore(connection);
  const deps = { store, warehouses, products, events, thresholds, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() };
  const offerings = createOfferingsService(deps);
  const stock = createStockService(deps);
  const tree = createTreeService(deps);
  const importer = createImportService(deps);
  const usage: ProductUsagePort = {
    offeringCount: productId => offerings.offeringCount(productId),
    touchOfferings: productId => offerings.touchOfferings(productId),
    // Deleting is allowed only when no offering exists AND the orders module confirms no order ever used the product.
    canDelete: async productId => (await offerings.offeringCount(productId)) === 0 && hasOrders !== undefined && (await hasOrders(productId)) === false,
  };
  return { store, offerings, stock, usage, tree, importer, routes: offeringsRoutes(offerings, auth, { tree, importer }) };
}
