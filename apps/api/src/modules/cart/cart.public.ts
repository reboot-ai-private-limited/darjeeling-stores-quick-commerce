import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { AppError, noCustomers, type CustomerResolver } from "../catalog/catalog.public.js";
import { createCartService } from "./application/cart-service.js";
import { createQuoteService } from "./application/quote-service.js";
import {
  DEFAULT_CART_SETTINGS, type AddressSource, type CartSettings, type CustomerPolicy, type HoursSource, type LineSource, type PricingSource, type TravelTime,
} from "./application/ports.js";
import { createMongoCartStore } from "./infrastructure/mongo-cart-store.js";
import { cartRoutes } from "./interface/routes.js";

export type { CartService } from "./application/cart-service.js";
export type { QuoteService, QuoteInput } from "./application/quote-service.js";
export type { Quote, QuoteDelivery, QuoteLine, CartSettings, CustomerPolicy, HoursSource } from "./application/ports.js";
export { DEFAULT_CART_SETTINGS } from "./application/ports.js";
export { allocate, shares, mergeItems } from "./domain/cart.js";
export { cartRoutes } from "./interface/routes.js";

/** Every customer may pay cash until the identity module can say otherwise. */
export const anyoneMayPayCash: CustomerPolicy = { codAllowed: async () => true };
/** Without the hours module a zone is open whenever one of its warehouses is open now. */
export const alwaysOpen: HoursSource = {
  closedReason: async () => null,
  forWindow: async () => { throw new AppError("VALIDATION_ERROR", "Pre-orders are not available", { field: "scheduledWindow" }); },
};

export interface CartModuleOptions {
  connection: Connection;
  lines: LineSource; addresses: AddressSource; pricing: PricingSource; travel: TravelTime;
  geography?: Geography; customers?: CustomerPolicy; hours?: HoursSource; settings?: Partial<CartSettings>; customer?: CustomerResolver;
}

/** Builds the server cart and quotes (F10). Call `store.ensureIndexes()` once after the database connects. */
export function createCartModule(options: CartModuleOptions) {
  const { connection, geography = noGeography, customers = anyoneMayPayCash, hours = alwaysOpen, customer = noCustomers } = options;
  const settings: CartSettings = { ...DEFAULT_CART_SETTINGS, ...options.settings };
  const store = createMongoCartStore(connection);
  const deps = {
    store, lines: options.lines, addresses: options.addresses, geography, pricing: options.pricing, travel: options.travel, customers, hours, settings,
    now: () => new Date(), newId: () => new Types.ObjectId().toHexString(),
  };
  const cart = createCartService(deps);
  const quotes = createQuoteService(deps);
  return { store, cart, quotes, settings, routes: cartRoutes(cart, quotes, customer) };
}
