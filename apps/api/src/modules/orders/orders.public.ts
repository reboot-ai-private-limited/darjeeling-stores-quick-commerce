import type { Connection } from "mongoose";
import { liveSettings } from "../../platform/settings.js";
import { Types } from "mongoose";
import { noGeography, type Geography } from "../../platform/geography.js";
import { denyAll, noCustomers, type AuthResolver, type CustomerResolver } from "../catalog/catalog.public.js";
import { createAdminOrderService } from "./application/admin-service.js";
import { createOrderCore } from "./application/order-core.js";
import { createOrderService } from "./application/order-service.js";
import {
  DEFAULT_ORDER_SETTINGS, type AddressSource, type CartPort, type CouponPort, type DispatchHooks, type MoneyPort, type OrderMedia, type OrderNotifier, type OrderSettings, type QuoteSource,
  type Riders, type SlotPort, type StockPort,
} from "./application/ports.js";
import { createMongoOrderStore } from "./infrastructure/mongo-order-store.js";
import { orderRoutes } from "./interface/routes.js";

export type { OrderService } from "./application/order-service.js";
export type { AdminOrderService } from "./application/admin-service.js";
export type {
  SlotPort, AddressSource, CartPort, CouponPort, DispatchHooks, MoneyPort, OrderMedia, OrderNotifier, OrderSettings, QuoteSource, Riders, StockPort,
} from "./application/ports.js";
export { DEFAULT_ORDER_SETTINGS } from "./application/ports.js";
export type { Order, OrderGroup } from "./domain/order.js";
export { LEGAL, groupStatusOf } from "./domain/order.js";
export { orderRoutes } from "./interface/routes.js";

/** Nothing is refunded and no online payment starts until the payments module is connected. */
export const noMoney: MoneyPort = { refund: async () => null, startPayment: async () => null };
export const silentOrderNotifier: OrderNotifier = {
  placed: async () => undefined, confirmed: async () => undefined, itemUnavailable: async () => undefined, cancelled: async () => undefined, newOrder: async () => undefined,
};
export const noRidersOnOrders: Riders = { riderOf: async () => null, ordersOf: async () => [] };
export const noSlots: SlotPort = { hold: async () => undefined, release: async () => undefined };
export const noDispatchHooks: DispatchHooks = { cancelled: async () => undefined, paid: async () => undefined };

export interface OrdersModuleOptions {
  connection: Connection;
  quotes: QuoteSource; carts: CartPort; addresses: AddressSource; stock: StockPort; coupons: CouponPort; media: OrderMedia;
  riders?: Riders; slots?: SlotPort; money?: MoneyPort; notifier?: OrderNotifier; dispatch?: DispatchHooks; geography?: Geography;
  /** Makes a signed public tracking link for an order (F20). */
  link?: (orderId: string) => { token: string; expiresAt: Date } | null;
  settings?: Partial<OrderSettings>; auth?: AuthResolver; customer?: CustomerResolver;
}

/** Builds order placement, the order state machine and the admin order screens (F13, F14). Call `store.ensureIndexes()` once after the database connects. */
export function createOrdersModule(options: OrdersModuleOptions) {
  const store = createMongoOrderStore(options.connection);
  const settings: OrderSettings = liveSettings(DEFAULT_ORDER_SETTINGS, options.settings);
  const deps = {
    store, quotes: options.quotes, carts: options.carts, addresses: options.addresses, stock: options.stock, coupons: options.coupons, media: options.media,
    riders: options.riders ?? noRidersOnOrders, money: options.money ?? noMoney, notifier: options.notifier ?? silentOrderNotifier, dispatch: options.dispatch ?? noDispatchHooks, slots: options.slots ?? noSlots,
    geography: options.geography ?? noGeography, link: options.link ?? (() => null), settings, now: () => new Date(), newId: () => new Types.ObjectId().toHexString(),
  };
  const core = createOrderCore(deps);
  const service = createOrderService(deps, core);
  const admin = createAdminOrderService(deps, core);
  return {
    store, service, admin, core, settings,
    /** The orders port the delivery modules (dispatch, cash, tracking, sync) use. */
    port: service.port,
    routes: orderRoutes(service, admin, options.auth ?? denyAll, options.customer ?? noCustomers),
  };
}
