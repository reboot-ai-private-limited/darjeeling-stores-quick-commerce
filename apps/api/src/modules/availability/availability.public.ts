import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { denyAll, type AuthResolver, type CatalogStore } from "../catalog/catalog.public.js";
import { createNotifyService } from "./application/notify-service.js";
import type { ProductLookup, WarehouseZones, ZoneAvailabilityPort } from "./application/ports.js";
import { createMongoSubscriptionStore } from "./infrastructure/mongo-subscription-store.js";
import { noCustomers, notifyRoutes, type CustomerResolver } from "./interface/routes.js";

export type { NotifyService } from "./application/notify-service.js";
export type { ProductLookup, WarehouseZones, ZoneAvailabilityPort } from "./application/ports.js";
export type { BackInStockMessage, OutboxEntry } from "./domain/subscription.js";
export { noCustomers, notifyRoutes, type CustomerResolver } from "./interface/routes.js";

/** Reads master products from the catalog module in the shape Notify Me needs. */
export function notifyProductsFrom(catalog: { store: CatalogStore }): ProductLookup {
  return {
    async getMany(ids) {
      return (await catalog.store.getProducts(ids)).map(p => ({
        id: p.id, name: p.name, status: p.status, imageMediaId: [...p.images].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.mediaId ?? null,
        variants: p.variants.map(v => ({ id: v.id, label: v.label, isActive: v.isActive })),
      }));
    },
  };
}

export interface AvailabilityModuleOptions {
  connection: Connection;
  zones: ZoneAvailabilityPort;
  products: ProductLookup;
  warehouses: WarehouseZones;
  /** Resolves the logged-in customer. Until the identity module provides it, nobody is logged in (401). */
  customer?: CustomerResolver;
  auth?: AuthResolver;
}

/** Builds Notify Me. Call `store.ensureIndexes()` once after the database connects. */
export function createAvailabilityModule(options: AvailabilityModuleOptions) {
  const { connection, zones, products, warehouses, customer = noCustomers, auth = denyAll } = options;
  const store = createMongoSubscriptionStore(connection);
  const notify = createNotifyService({ store, zones, products, warehouses, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() });
  return {
    store, notify, routes: notifyRoutes(notify, customer, auth),
    /** Feed every stock event here; only the zone back-in-stock event does anything. */
    async onStockEvent(event: { type: string; zoneId?: string; productId?: string; variantId?: string | null }): Promise<void> {
      if (event.type === "stock.zone_availability_changed" && event.zoneId && event.productId && event.variantId) {
        await notify.onZoneAvailabilityChanged({ zoneId: event.zoneId, productId: event.productId, variantId: event.variantId });
      }
    },
  };
}
