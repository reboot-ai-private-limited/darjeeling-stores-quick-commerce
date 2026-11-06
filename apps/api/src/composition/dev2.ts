import type { Connection } from "mongoose";
import mongoose from "mongoose";
import type { Route } from "../platform/routes.js";
import { createAvailabilityModule, notifyProductsFrom, type CustomerResolver } from "../modules/availability/availability.public.js";
import { createCatalogModule, denyAll, type AuthResolver, type MediaPort, type ProductUsagePort } from "../modules/catalog/catalog.public.js";
import { createJobsModule } from "../modules/jobs/jobs.public.js";
import {
  createMediaModule, storageFromEnv, type AccessPolicy, type MediaSettings, type PrincipalResolver, type StorageProvider,
} from "../modules/media/media.public.js";
import {
  createNotificationsModule, type AudienceDirectory, type DeviceRegistry, type PushProvider, type SmsProvider, type UserContacts, type WebhookConfig, type WhatsAppProvider,
} from "../modules/notifications/notifications.public.js";
import {
  createOfferingsModule, noWarehouses, productDirectoryFrom, type EventPublisher, type WarehouseDirectory,
} from "../modules/offerings/offerings.public.js";

export interface Dev2Options {
  connection?: Connection;
  /** Resolves the logged-in staff member. Until Dev 1's auth port exists, the default denies everyone (401). */
  auth?: AuthResolver;
  /** Resolves the logged-in customer for Notify Me and notification preferences. Until the customer session is wired in, nobody is logged in (401). */
  customer?: CustomerResolver;
  /** Replaces the media the catalog uses. Normally left out: the media module below provides it. */
  media?: MediaPort;
  /** Where files are stored. Defaults to Cloudinary from CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET); without them uploads answer 503. */
  storage?: StorageProvider;
  /** Resolves the logged-in customer, rider or staff member for the media routes. Until the identity session is connected, nobody is logged in (401). */
  principal?: PrincipalResolver;
  mediaPolicy?: AccessPolicy;
  mediaSettings?: Partial<MediaSettings>;
  /** Message providers. Default to FCM and WhatsApp Cloud from environment variables; a missing one makes its messages fail with a clear reason. */
  push?: PushProvider; whatsapp?: WhatsAppProvider; sms?: SmsProvider; webhook?: WebhookConfig;
  /** From the identity and geography modules: phones, push tokens, customers per zone. */
  contacts?: UserContacts; devices?: DeviceRegistry; audience?: AudienceDirectory;
  warehouses?: WarehouseDirectory;
  events?: EventPublisher;
  hasOrders?: (productId: string) => Promise<boolean>;
}

/** Builds Dev 2's backend modules. The `stock` and `catalog` ports for the orders module are `modules.stock`. */
export function createDev2Modules(options: Dev2Options = {}) {
  const connection = options.connection ?? mongoose.connection;
  const auth = options.auth ?? denyAll;

  // Indexes are created once, on the first request from a signed-in user, so an unauthenticated request never touches the database.
  let indexes: Promise<void> | undefined;
  const ensureIndexes = () => (indexes ??= Promise.all([
    catalog.store.ensureIndexes(), offerings.store.ensureIndexes(), availability.store.ensureIndexes(), media.store.ensureIndexes(),
    jobs.store.ensureIndexes(), notifications.ready(),
  ]).then(() => undefined, error => { indexes = undefined; throw error; }));
  const authThenIndexes: AuthResolver = async req => {
    const actor = await auth(req);
    if (actor) await ensureIndexes();
    return actor;
  };
  const principalThenIndexes: PrincipalResolver | undefined = options.principal && (async req => {
    const who = await options.principal!(req);
    if (who) await ensureIndexes();
    return who;
  });
  const customerThenIndexes: CustomerResolver | undefined = options.customer && (async req => {
    const who = await options.customer!(req);
    if (who) await ensureIndexes();
    return who;
  });

  const jobs = createJobsModule({ connection });
  // The catalog protects products that are already for sale through the offerings module, which is built just after it.
  const usage: ProductUsagePort = {
    offeringCount: id => offerings.usage.offeringCount(id),
    canDelete: id => offerings.usage.canDelete(id),
    touchOfferings: id => offerings.usage.touchOfferings(id),
  };
  const media = createMediaModule({
    connection, storage: options.storage ?? storageFromEnv(process.env), ...(principalThenIndexes && { principal: principalThenIndexes }),
    ...(options.mediaPolicy && { policy: options.mediaPolicy }), ...(options.mediaSettings && { settings: options.mediaSettings }),
  });
  const catalog = createCatalogModule({ connection, auth: authThenIndexes, usage, media: options.media ?? media.catalogPort });
  const offerings = createOfferingsModule({
    connection, auth: authThenIndexes, products: productDirectoryFrom(catalog),
    ...(options.warehouses && { warehouses: options.warehouses }),
    // Stock events go to the caller's listener and to Notify Me, whose "item is back" messages are then handed to the delivery queue
    // at once. A failing listener never undoes a stock change.
    events: {
      publish: async event => {
        await Promise.allSettled([
          options.events?.publish(event),
          availability.onStockEvent(event).then(() => (event.type === "stock.zone_availability_changed" ? notifications.campaigns.drainBackInStock() : undefined)),
        ]);
      },
    },
    ...(options.hasOrders && { hasOrders: options.hasOrders }),
  });
  const availability = createAvailabilityModule({
    connection, auth: authThenIndexes, products: notifyProductsFrom(catalog), warehouses: options.warehouses ?? noWarehouses,
    zones: { check: (zoneId, productId) => offerings.offerings.zoneAvailability(zoneId, productId) },
    ...(customerThenIndexes && { customer: customerThenIndexes }),
  });
  const notifications = createNotificationsModule({
    connection, jobs: jobs.service, auth: authThenIndexes, ...(customerThenIndexes && { customer: customerThenIndexes }),
    ...(options.push && { push: options.push }), ...(options.whatsapp && { whatsapp: options.whatsapp }), ...(options.sms && { sms: options.sms }),
    ...(options.webhook && { webhook: options.webhook }), ...(options.contacts && { contacts: options.contacts }),
    ...(options.devices && { devices: options.devices }), ...(options.audience && { audience: options.audience }),
    outbox: {
      pending: async limit => (await availability.notify.pendingMessages(limit)).map(({ subscriptionId, message }) => ({ subscriptionId, message })),
      markDelivered: id => availability.notify.markDelivered(id),
      markFailed: (id, error) => availability.notify.markFailed(id, error),
    },
    media: { urls: ids => media.service.urls(ids) },
  });

  /**
   * Starts the background work: the job worker and the recurring sweeps.
   *  - release stock held by an order that never finished (every minute, F05)
   *  - hand "item is back" messages from Notify Me to delivery (every minute, F07)
   *  - delete expired and stuck media (hourly, F24)
   * The server calls this once after the database connects, and `await stop()` on shutdown.
   */
  async function startBackground(pollMs = 2000): Promise<{ stop(): Promise<void> }> {
    await ensureIndexes();
    await jobs.service.every("stock.release_expired_holds", 60_000, () => offerings.stock.releaseExpiredHolds());
    await jobs.service.every("notifications.drain_back_in_stock", 60_000, () => notifications.campaigns.drainBackInStock());
    await jobs.service.every("media.sweep", 3_600_000, () => media.service.sweep());
    jobs.service.start(pollMs);
    return { stop: () => jobs.service.stop() };
  }

  return {
    catalog, offerings, availability, media, jobs, notifications, stock: offerings.stock,
    routes: [...catalog.routes, ...offerings.routes, ...availability.routes, ...media.routes, ...notifications.routes] satisfies Route[],
    ensureIndexes, startBackground,
  };
}

export function dev2Routes(options: Dev2Options = {}): Route[] { return createDev2Modules(options).routes; }
