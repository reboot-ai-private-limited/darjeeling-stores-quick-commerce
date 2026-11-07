import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { settingsProvider, type SettingsProvider } from "../../platform/settings.js";
import { denyAll, noCustomers, AppError, type AuthResolver, type CustomerResolver } from "../catalog/catalog.public.js";
import { createPricingService, DEFAULT_PRICING_SETTINGS, type PricingSettings } from "./application/pricing-service.js";
import type { BannerMedia, OrderHistory } from "./application/ports.js";
import { createMongoPricingStore } from "./infrastructure/mongo-pricing-store.js";
import { pricingRoutes, type CustomerNames } from "./interface/routes.js";

export type { PricingService, PricingSettings } from "./application/pricing-service.js";
export type { BannerMedia, OrderHistory } from "./application/ports.js";
export { DEFAULT_PRICING_SETTINGS } from "./application/pricing-service.js";
export { computeBill, couponDiscount, couponProblem, inWindow, tierProblem } from "./domain/pricing.js";
export type { Bill, Charge, Coupon, Rule } from "./domain/pricing.js";
export { pricingRoutes } from "./interface/routes.js";

const unavailable = () => new AppError("SERVICE_UNAVAILABLE", "Image storage is not connected");
export const noBannerMedia: BannerMedia = { claim: async () => { throw unavailable(); }, release: async () => undefined };
/** Until the orders module exists nobody has ordered, so every customer is on a first order. */
export const noOrderHistory: OrderHistory = { orderCount: async () => 0 };

export interface PricingModuleOptions {
  connection: Connection;
  geography?: Geography;
  media?: BannerMedia;
  orders?: OrderHistory;
  settings?: Partial<PricingSettings> | SettingsProvider<PricingSettings>;
  /** Names for the coupon usage list. */
  customerNames?: CustomerNames;
  auth?: AuthResolver;
  customer?: CustomerResolver;
}

/** Builds fees, surcharges, coupons and banners (F11, F12). Call `store.ensureIndexes()` once after the database connects. */
export function createPricingModule(options: PricingModuleOptions) {
  const { connection, geography = noGeography, media = noBannerMedia, orders = noOrderHistory, auth = denyAll, customer = noCustomers } = options;
  const settings = settingsProvider(DEFAULT_PRICING_SETTINGS, options.settings);
  const store = createMongoPricingStore(connection);
  const service = createPricingService({ store, geography, media, orders, settings, now: () => new Date(), newId: () => new Types.ObjectId().toHexString() });
  return {
    store, service, settings,
    /** For discovery's home screen. */
    bannerSource: { forZone: async (zoneId: string) => (await service.bannersForZone(zoneId)).map(b => ({ id: b.id, title: b.title, imageMediaId: b.imageMediaId, link: b.link })) },
    routes: pricingRoutes(service, auth, customer, options.customerNames ?? (async () => new Map())),
  };
}
