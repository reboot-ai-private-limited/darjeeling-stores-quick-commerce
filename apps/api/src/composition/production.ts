import { createHmac } from "node:crypto";
import type { Connection } from "mongoose";
import type { loadConfig } from "../config/env.js";
import { liveSettings } from "../platform/settings.js";
import { createPeopleDirectories, createRiderIdentity, createUserResolvers } from "../modules/identity/accounts.public.js";
import { createGeographyPort, warehouseDirectoryFrom, type createGeographyModule } from "../modules/geography/geography.public.js";
import { baselineEta, createGoogleRoutesEta, DEFAULT_TRACKING_SETTINGS, withFallbackEta, type EtaProvider } from "../modules/tracking/tracking.public.js";
import type { createAdminModules } from "./admin.js";
import { createDev2Modules } from "./dev2.js";
import { createLiveSettings } from "./live-settings.js";

type Config = ReturnType<typeof loadConfig>;

/** A key made from the signing secret for one purpose, so no two uses share a key and none falls back to a built-in value. */
export const deriveKey = (jwtSecret: string, purpose: string) => createHmac("sha256", Buffer.from(jwtSecret, "hex")).update(purpose).digest("hex");

export interface ProductionOptions {
  connection: Connection; config: Config & { JWT_SECRET: string };
  geography: ReturnType<typeof createGeographyModule>;
  admin: ReturnType<typeof createAdminModules>;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

/**
 * The real server's backend: Dev 2's modules connected to the real cities, zones and warehouses, to the sign-in sessions of customers,
 * riders and staff, and to the settings an owner changes in admin. `start()` loads the settings and starts the background work (payment
 * expiry, notifications, rider alerts, stock holds, media cleanup); `stop()` ends it, and must run before the database is closed.
 */
export function createProduction({ connection, config, geography, admin, fetch: http }: ProductionOptions) {
  const users = createUserResolvers(connection, {
    jwtSecret: config.JWT_SECRET, sessionOptions: config, allowDevelopmentAccounts: config.mockOTP, trustedOrigins: config.CORS_ORIGINS,
  });
  const people = createPeopleDirectories(connection);
  const live = createLiveSettings(admin.settings, {
    trackingBaseUrl: config.TRACKING_BASE_URL ?? null, otpKeyHex: config.ORDER_OTP_KEY ?? deriveKey(config.JWT_SECRET, "order-delivery-code"),
    ...(config.UPI_VPA && { upi: { vpa: config.UPI_VPA, payeeName: config.UPI_PAYEE_NAME! }, upiPayee: config.UPI_VPA }),
  });

  // Road time from Google when a key is set, with the straight-line estimate whenever Google has no answer.
  const straightLine = baselineEta(liveSettings(DEFAULT_TRACKING_SETTINGS, live.tracking));
  const eta: EtaProvider = config.GOOGLE_MAPS_API_KEY
    ? withFallbackEta(createGoogleRoutesEta({ apiKey: config.GOOGLE_MAPS_API_KEY, ...(http && { fetch: http }) }), straightLine)
    : straightLine;

  const modules = createDev2Modules({
    connection, auth: admin.auth, customer: users.customer, rider: users.rider, principal: users.principal,
    geography: createGeographyPort(geography), warehouses: warehouseDirectoryFrom(geography), riderIdentity: createRiderIdentity(connection),
    contacts: people.contacts, devices: people.devices, audience: people.audience, customerPolicy: people.customerPolicy, hasOrders: people.hasOrders,
    // Settings the owner edits in admin: some per zone or warehouse, the rest everywhere. All are read again on each use.
    cartSettings: admin.providers.cart, pricingSettings: admin.providers.pricing, stockThresholds: admin.providers.stockThresholds,
    priceConflictMode: admin.providers.priceConflictMode, hoursSettings: admin.providers.hours,
    orderSettings: live.orders, paymentSettings: live.payments, refundSettings: live.refunds, deliverySettings: live.delivery,
    trackingSettings: live.tracking, syncSettings: live.sync, mediaSettings: live.media, discoverySettings: live.discovery,
    eta, trackingTokenSecret: config.TRACKING_TOKEN_SECRET ?? deriveKey(config.JWT_SECRET, "tracking-links"),
  });

  return {
    modules, routes: modules.routes, live,
    async start(): Promise<{ stop(): Promise<void> }> {
      const refreshing = await live.start();
      const background = await modules.startBackground();
      return { stop: async () => { refreshing.stop(); await background.stop(); } };
    },
  };
}
