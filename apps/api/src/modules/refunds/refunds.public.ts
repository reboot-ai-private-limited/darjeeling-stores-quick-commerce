import type { Connection } from "mongoose";
import { liveSettings } from "../../platform/settings.js";
import { Types } from "mongoose";
import { AppError, denyAll, noCustomers, type AuthResolver, type CustomerResolver } from "../catalog/catalog.public.js";
import { createRefundService } from "./application/refund-service.js";
import {
  DEFAULT_REFUND_SETTINGS, type Eligibility, type RefundGateway, type OrderAccess, type RefundMedia, type RefundNotifier, type RefundSettings,
} from "./application/ports.js";
import { createMongoRefundStore } from "./infrastructure/mongo-refund-store.js";
import { refundRoutes } from "./interface/routes.js";

export type { RefundService, AutoRefundInput } from "./application/refund-service.js";
export type { Eligibility, RefundGateway, OrderAccess, RefundMedia, RefundNotifier, RefundSettings } from "./application/ports.js";
export { DEFAULT_REFUND_SETTINGS } from "./application/ports.js";
export { refundRoutes } from "./interface/routes.js";

export const everythingEligible: Eligibility = { eligible: async () => true };
export const silentRefundNotifier: RefundNotifier = { approved: async () => undefined, rejected: async () => undefined, done: async () => undefined };
export const noRefundGateway: RefundGateway = { refund: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Online refunds are not connected") } };
export const noRefundMedia: RefundMedia = { claim: async () => { throw new AppError("SERVICE_UNAVAILABLE", "Photo storage is not connected"); } };

export interface RefundsModuleOptions {
  connection: Connection; orders: OrderAccess; cancelOwn: (userId: string, orderId: string, reason: string) => Promise<unknown>;
  media?: RefundMedia; eligibility?: Eligibility; notifier?: RefundNotifier; gateway?: RefundGateway; settings?: Partial<RefundSettings>; auth?: AuthResolver; customer?: CustomerResolver;
}

/** Builds customer cancellation, refund requests and the admin refund list (F16). Call `store.ensureIndexes()` once after the database connects. */
export function createRefundsModule(options: RefundsModuleOptions) {
  const store = createMongoRefundStore(options.connection);
  const settings: RefundSettings = liveSettings(DEFAULT_REFUND_SETTINGS, options.settings);
  const service = createRefundService({
    store, orders: options.orders, media: options.media ?? noRefundMedia, eligibility: options.eligibility ?? everythingEligible, notifier: options.notifier ?? silentRefundNotifier,
    gateway: options.gateway ?? noRefundGateway, settings, now: () => new Date(), newId: () => new Types.ObjectId().toHexString(),
  });
  return { store, service, settings, routes: refundRoutes(service, options.cancelOwn, options.auth ?? denyAll, options.customer ?? noCustomers) };
}
