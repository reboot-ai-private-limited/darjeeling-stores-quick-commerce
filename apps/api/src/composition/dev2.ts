import type { Connection } from "mongoose";
import mongoose from "mongoose";
import { noGeography, type Geography } from "../platform/geography.js";
import type { RiderIdentity } from "../platform/identity.js";
import type { OrdersPort } from "../platform/orders.js";
import type { Route } from "../platform/routes.js";
import { createAddressesModule } from "../modules/addresses/addresses.public.js";
import { createAvailabilityModule, notifyProductsFrom, type CustomerResolver } from "../modules/availability/availability.public.js";
import { createCatalogModule, denyAll, type AuthResolver, type MediaPort, type ProductUsagePort } from "../modules/catalog/catalog.public.js";
import { createDispatchModule, type DispatchSettings } from "../modules/dispatch/dispatch.public.js";
import { createDiscoveryModule, type BannerSource, type DiscoverySettings, type StoreSettings } from "../modules/discovery/discovery.public.js";
import { createJobsModule } from "../modules/jobs/jobs.public.js";
import {
  createMediaModule, storageFromEnv, type AccessPolicy, type MediaSettings, type PrincipalResolver, type StorageProvider,
} from "../modules/media/media.public.js";
import {
  createNotificationsModule, type AudienceDirectory, type DeviceRegistry, type PushProvider, type SmsProvider, type UserContacts, type WebhookConfig, type WhatsAppProvider,
} from "../modules/notifications/notifications.public.js";
import { createRidersModule, type RiderResolver } from "../modules/riders/riders.public.js";
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
  /** Zones, localities and warehouse hours (F03, Dev 1). Until it exists there are no zones, so nothing can be browsed or delivered to. */
  geography?: Geography;
  /** Home banners (F12) and hours, fees and the ETA (F11, F17, F20), all Dev 1's. */
  banners?: BannerSource; storeSettings?: StoreSettings; discoverySettings?: Partial<DiscoverySettings>;
  /** Orders and their state machine (F13, F14), Dev 1's. Without it nothing can be dispatched. */
  orders?: OrdersPort;
  /** Rider login accounts (F01), Dev 1's. Without it riders cannot be created. */
  riderIdentity?: RiderIdentity;
  /** Who the signed-in rider is. Until the identity session is connected, nobody is signed in (401). */
  rider?: RiderResolver;
  deliverySettings?: Partial<DispatchSettings>;
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
    jobs.store.ensureIndexes(), notifications.ready(), discovery.store.ensureIndexes(), addresses.store.ensureIndexes(), riders.store.ensureIndexes(), dispatch.store.ensureIndexes(),
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
  const riderThenIndexes: RiderResolver | undefined = options.rider && (async req => {
    const who = await options.rider!(req);
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

  const geography = options.geography ?? noGeography;
  const discovery = createDiscoveryModule({
    connection, geography, catalog: catalog.store, source: offerings.zoneSource, media: { urls: ids => media.service.urls(ids) },
    ...(options.banners && { banners: options.banners }), ...(options.storeSettings && { storeSettings: options.storeSettings }),
    ...(options.contacts && { contacts: options.contacts }), ...(customerThenIndexes && { customer: customerThenIndexes }),
    ...(options.discoverySettings && { settings: options.discoverySettings }),
  });
  const addresses = createAddressesModule({
    connection, geography, ...(customerThenIndexes && { customer: customerThenIndexes }),
    // Voice notes and photos are the customer's own uploads; the media module checks that and attaches them to the address.
    media: {
      claim: ({ mediaId, userId, kind, addressId }) => media.service.claimOwned({ mediaId, userId, kind, owner: { type: "address", id: addressId } }),
      unclaim: (mediaId, addressId) => media.service.detach(mediaId, { type: "address", id: addressId }),
      release: (mediaId, reason) => media.service.removeInternal(mediaId, reason),
      releaseAll: async (addressId, reason) => { await media.service.removeForOwner({ type: "address", id: addressId }, reason); },
    },
  });

  // Riders and dispatch. Riders are built first; dispatch reads them and tells them what their orders are.
  const riders = createRidersModule({
    connection, geography, ...(options.riderIdentity && { identity: options.riderIdentity }), ...(options.deliverySettings && { settings: options.deliverySettings }),
    ...(riderThenIndexes && { rider: riderThenIndexes }), auth: authThenIndexes,
    media: {
      claim: async ({ mediaId, userId, riderId }) => { await media.service.claimOwned({ mediaId, userId, kind: "rider_photo", owner: { type: "rider", id: riderId } }); },
      release: (mediaId, reason) => media.service.removeInternal(mediaId, reason),
    },
    loads: { pickedUpCount: id => dispatch.field.pickedUpCount(id) },
  });
  /** Messages to riders go through the same notifications as everything else; a failure never undoes a dispatch decision. */
  const tell = (userId: string, templateKey: string, channels: ("push" | "whatsapp")[], vars: Record<string, string>, data: Record<string, string>, dedupeKey: string) =>
    notifications.notify({ userId, templateKey, channels, vars, data, dedupeKey });
  const dispatch = createDispatchModule({
    connection, geography, ...(options.orders && { orders: options.orders }), settings: { ...options.deliverySettings, ...riders.settings, ...options.deliverySettings },
    ...(riderThenIndexes && { rider: riderThenIndexes }), auth: authThenIndexes,
    riders: {
      get: id => riders.service.byId(id), getMany: ids => riders.service.getMany(ids), listActive: () => riders.service.listActive(), forUser: userId => riders.service.forUser(userId),
      reserveCapacity: (id, max) => riders.service.reserveCapacity(id, max), releaseCapacity: id => riders.service.releaseCapacity(id), markAssigned: (id, at) => riders.service.markAssigned(id, at),
    },
    notifier: {
      assigned: async (rider, i) => { await tell(rider.userId, "assignment_assigned", ["push"], { orderNo: i.orderNo }, { type: "assignment", assignmentId: i.assignmentId, ackDeadlineAt: i.ackDeadlineAt.toISOString(), deepLink: `dsr://assignment/${i.assignmentId}` }, `assignment:${i.assignmentId}:assigned`); },
      handover: async (rider, i) => { await tell(rider.userId, "handover_assigned", ["push"], { orderNo: i.orderNo }, { type: "handover", assignmentId: i.assignmentId, orderId: i.orderId, deepLink: `dsr://assignment/${i.assignmentId}` }, `assignment:${i.assignmentId}:handover`); },
      cancelled: async (rider, i) => { await tell(rider.userId, "assignment_cancelled", ["push"], { orderNo: i.orderNo }, { type: "assignment_cancelled", assignmentId: i.assignmentId, orderId: i.orderId }, `assignment:${i.assignmentId}:cancelled`); },
      paid: async (rider, i) => { await tell(rider.userId, "payment_paid", ["push"], { orderNo: i.orderNo }, { type: "payment_paid", orderId: i.orderId }, `order:${i.orderId}:paid:${rider.id}`); },
      unacknowledged: async (rider, i) => (await tell(rider.userId, "assignment_unacknowledged", ["whatsapp"], { name: rider.name, orderNo: i.orderNo }, {}, `assignment:${i.assignmentId}:escalated`)).queued.length > 0,
    },
    evidence: {
      claim: async ({ mediaId, userId, orderId }) => { await media.service.claimOwned({ mediaId, userId, kind: "failed_delivery_photo", owner: { type: "order", id: orderId } }); },
      unclaim: (mediaId, orderId) => media.service.detach(mediaId, { type: "order", id: orderId }),
    },
  });

  /**
   * Starts the background work: the job worker and the recurring sweeps.
   *  - tell riders (WhatsApp) and the board about orders nobody acknowledged (every 10 seconds, F18)
   *  - in auto mode, give waiting ready orders to riders (every 15 seconds, F18)
   *  - mark riders whose phone has gone quiet offline (every minute, F19)
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
    await jobs.service.every("dispatch.ack_sweep", 10_000, () => dispatch.assign.sweepAcks());
    await jobs.service.every("dispatch.auto_assign", 15_000, () => dispatch.assign.autoAssignPending());
    await jobs.service.every("riders.silent_sweep", 60_000, () => riders.service.sweepSilent());
    jobs.service.start(pollMs);
    return { stop: () => jobs.service.stop() };
  }

  return {
    catalog, offerings, availability, media, jobs, notifications, discovery, addresses, riders, dispatch, stock: offerings.stock,
    routes: [
      ...catalog.routes, ...offerings.routes, ...availability.routes, ...media.routes, ...notifications.routes, ...discovery.routes, ...addresses.routes,
      // `/admin/riders/live` must be registered before the riders' `/admin/riders/:id`, or "live" would be read as an id.
      ...dispatch.routes, ...riders.routes,
    ] satisfies Route[],
    ensureIndexes, startBackground,
  };
}

export function dev2Routes(options: Dev2Options = {}): Route[] { return createDev2Modules(options).routes; }
