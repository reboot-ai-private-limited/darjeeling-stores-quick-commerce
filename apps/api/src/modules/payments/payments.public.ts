import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { denyAll, noCustomers, type AuthResolver, type CustomerResolver } from "../catalog/catalog.public.js";
import { createPaymentService } from "./application/payment-service.js";
import { DEFAULT_PAYMENT_SETTINGS, type GroupAccess, type LateRefunds, type PaymentNotifier, type PaymentProvider, type PaymentSettings } from "./application/ports.js";
import { createMongoPaymentStore } from "./infrastructure/mongo-payment-store.js";
import { razorpayFromEnv, unconfiguredProvider } from "./infrastructure/razorpay-provider.js";
import { paymentRoutes } from "./interface/routes.js";

export type { PaymentService } from "./application/payment-service.js";
export type { GroupAccess, LateRefunds, PaymentNotifier, PaymentProvider, PaymentSettings } from "./application/ports.js";
export { DEFAULT_PAYMENT_SETTINGS } from "./application/ports.js";
export { checkoutSignature, verifyCheckout, verifyWebhook } from "./domain/payment.js";
export { createRazorpayProvider, razorpayFromEnv, unconfiguredProvider } from "./infrastructure/razorpay-provider.js";
export { paymentRoutes } from "./interface/routes.js";

export const silentPaymentNotifier: PaymentNotifier = { adminAlert: async () => undefined };

export interface PaymentsModuleOptions {
  connection: Connection; groups: GroupAccess; refunds: LateRefunds;
  /** Razorpay, or a stand-in. Defaults to the one set up by the RAZORPAY_* environment variables, or none. */
  provider?: PaymentProvider; notifier?: PaymentNotifier; settings?: Partial<PaymentSettings>; auth?: AuthResolver; customer?: CustomerResolver;
}

/** Builds online payments, the Razorpay webhook and reconciliation (F15). Call `store.ensureIndexes()` once after the database connects. */
export function createPaymentsModule(options: PaymentsModuleOptions) {
  const store = createMongoPaymentStore(options.connection);
  const settings: PaymentSettings = { ...DEFAULT_PAYMENT_SETTINGS, ...options.settings };
  const service = createPaymentService({
    store, provider: options.provider ?? razorpayFromEnv(process.env), groups: options.groups, refunds: options.refunds, notifier: options.notifier ?? silentPaymentNotifier,
    settings, now: () => new Date(), newId: () => new Types.ObjectId().toHexString(),
  });
  return { store, service, settings, routes: paymentRoutes(service, options.auth ?? denyAll, options.customer ?? noCustomers) };
}
export { unconfiguredProvider as noPaymentProvider };
