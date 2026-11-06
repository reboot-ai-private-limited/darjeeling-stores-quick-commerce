import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { noCustomers, type CustomerResolver } from "../catalog/catalog.public.js";
import {
  DEFAULT_DISCOVERY_SETTINGS, type Banner, type BannerSource, type CatalogReader, type DiscoverySettings, type MediaUrls, type StoreSettings,
  type StoreSettingsValue, type UserContacts, type ZoneOfferingsSource,
} from "./application/ports.js";
import { createStoreService } from "./application/store-service.js";
import { createZoneCatalogService } from "./application/zone-catalog-service.js";
import { createMongoWaitlistStore } from "./infrastructure/mongo-waitlist-store.js";
import { discoveryRoutes } from "./interface/routes.js";

export type { Banner, BannerSource, DiscoverySettings, StoreSettings, StoreSettingsValue, UserContacts } from "./application/ports.js";
export type { StoreService } from "./application/store-service.js";
export type { ZoneCatalogService } from "./application/zone-catalog-service.js";
export type { ZoneProduct } from "./application/zone-product.js";
export { discoveryRoutes } from "./interface/routes.js";

/** Until the banner admin (F12) exists there are no banners. */
export const noBanners: BannerSource = { forZone: async () => [] };

/**
 * Stand-in for hours, fees and the ETA until F11, F17 and F20 exist: a 15 to 20 minute ETA, no fees, no notices, no pre-orders.
 * Whether the store is open still comes from the warehouses themselves.
 */
export const defaultStoreSettings: StoreSettings = {
  forZone: async (): Promise<StoreSettingsValue> => ({
    etaMinMinutes: 15, etaMaxMinutes: 20, minOrder: 0, freeDeliveryAbove: null, smallOrderFee: 0, afterHoursMode: "closed", preOrderAvailable: false,
    opensAt: null, closesAt: null, pauseMessage: null, notices: [],
  }),
};
export const noContacts: UserContacts = { phoneOf: async () => null };

export interface DiscoveryModuleOptions {
  connection: Connection;
  /** Zones, localities and warehouse hours (F03, Dev 1). */
  geography?: Geography;
  catalog: CatalogReader;
  source: ZoneOfferingsSource;
  media: MediaUrls;
  banners?: BannerSource;
  storeSettings?: StoreSettings;
  contacts?: UserContacts;
  /** Who the logged-in customer is, when there is one. Browsing never needs a login. */
  customer?: CustomerResolver;
  settings?: Partial<DiscoverySettings>;
}

/** Builds the customer catalog and store status (F08). Call `store.ensureIndexes()` once after the database connects. */
export function createDiscoveryModule(options: DiscoveryModuleOptions) {
  const {
    connection, geography = noGeography, catalog, source, media, banners = noBanners, storeSettings = defaultStoreSettings,
    contacts = noContacts, customer = noCustomers,
  } = options;
  const settings: DiscoverySettings = { ...DEFAULT_DISCOVERY_SETTINGS, ...options.settings };
  const now = () => new Date();
  const waitlist = createMongoWaitlistStore(connection);
  const zoneCatalog = createZoneCatalogService({ geography, catalog, source, media, banners, storeSettings, settings, now });
  const store = createStoreService({ geography, storeSettings, banners, media, contacts, waitlist, now, newId: () => new Types.ObjectId().toHexString() });
  return { store: waitlist, zoneCatalog, storeService: store, routes: discoveryRoutes(zoneCatalog, store, customer) };
}
