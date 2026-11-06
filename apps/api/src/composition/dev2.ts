import type { Connection } from "mongoose";
import mongoose from "mongoose";
import { noGeography, type Geography } from "../platform/geography.js";
import type { RiderIdentity } from "../platform/identity.js";
import type { OrdersPort } from "../platform/orders.js";
import type { Route } from "../platform/routes.js";
import { createAddressesModule } from "../modules/addresses/addresses.public.js";
import { createAvailabilityModule, notifyProductsFrom, type CustomerResolver } from "../modules/availability/availability.public.js";
import { createCatalogModule, denyAll, type AuthResolver, type MediaPort, type ProductUsagePort } from "../modules/catalog/catalog.public.js";
import { createCartModule, type CartSettings, type CustomerPolicy, type HoursSource } from "../modules/cart/cart.public.js";
import { createCashModule } from "../modules/cash/cash.public.js";
import { createDispatchModule, type DispatchSettings } from "../modules/dispatch/dispatch.public.js";
import { createHoursModule } from "../modules/hours/hours.public.js";
import { createOrdersModule, type MoneyPort, type OrderSettings } from "../modules/orders/orders.public.js";
import { createPricingModule, type OrderHistory, type PricingSettings } from "../modules/pricing/pricing.public.js";
import { createSyncModule, type SyncSettings } from "../modules/sync/sync.public.js";
import { baselineEta, createTrackingModule, DEFAULT_TRACKING_SETTINGS, type EtaProvider, type TrackingSettings } from "../modules/tracking/tracking.public.js";
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
  /** Fee, surcharge and coupon settings (F11, F12) and how many orders a customer has placed (for first-order coupons). */
  /** Cart and quote settings, whether a customer may pay cash, and hours/pre-order rules (F10, F17). */
  cartSettings?: Partial<CartSettings>; customerPolicy?: CustomerPolicy; hours?: HoursSource;
  orderSettings?: Partial<OrderSettings>;
  /** Refunds and online payments (F15, F16). Until the payments module is connected nothing is refunded and online orders get no checkout. */
  money?: MoneyPort;
  pricingSettings?: Partial<PricingSettings>; orderHistory?: OrderHistory; customerNames?: (userIds: readonly string[]) => Promise<Map<string, string>>;
  /** Live ETA settings, the routes provider that replaces the straight-line estimate, and the secret that signs public tracking links (F20). */
  trackingSettings?: Partial<TrackingSettings>; eta?: EtaProvider; trackingTokenSecret?: string;
  /** Offline sync: the doorstep UPI details and the offline delivery checks (F21). */
  syncSettings?: Partial<SyncSettings>;
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
    cash.store.ensureIndexes(), tracking.store.ensureIndexes(), sync.store.ensureIndexes(), pricing.store.ensureIndexes(), cart.store.ensureIndexes(), orders.store.ensureIndexes(), hours.store.ensureIndexes(),
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

  // Opening hours and pauses sit in front of the geography port: a warehouse is open only inside its hours and not paused.
  const hours = createHoursModule({
    connection, geography: options.geography ?? noGeography, auth: authThenIndexes, ...(customerThenIndexes && { customer: customerThenIndexes }),
    preorders: { list: query => orders.service.preorders(query) },
  });
  const geography = hours.service.decorate(options.geography ?? noGeography);
  const pricing = createPricingModule({
    connection, geography, auth: authThenIndexes, ...(customerThenIndexes && { customer: customerThenIndexes }),
    ...(options.pricingSettings && { settings: options.pricingSettings }), orders: options.orderHistory ?? { orderCount: userId => orders.service.orderCount(userId) },
    ...(options.customerNames && { customerNames: options.customerNames }),
    media: {
      claim: async ({ mediaId, userId, bannerId }) => { await media.service.claimOwned({ mediaId, userId, kind: "banner", owner: { type: "banner", id: bannerId } }); },
      release: (mediaId, reason) => media.service.removeInternal(mediaId, reason),
    },
  });
  const discovery = createDiscoveryModule({
    connection, geography, catalog: catalog.store, source: offerings.zoneSource, media: { urls: ids => media.service.urls(ids) },
    banners: options.banners ?? pricing.bannerSource, ...(options.storeSettings && { storeSettings: options.storeSettings }),
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

  // The cart and quotes, then orders placed from them. Orders also work as the port that delivery reads and changes orders through.
  const eta = options.eta ?? baselineEta({ ...DEFAULT_TRACKING_SETTINGS, ...options.trackingSettings });
  const cart = createCartModule({
    connection, geography, lines: offerings.stock, addresses: addresses.reader, pricing: pricing.service, travel: eta,
    ...(customerThenIndexes && { customer: customerThenIndexes }), ...(options.cartSettings && { settings: options.cartSettings }),
    ...(options.customerPolicy && { customers: options.customerPolicy }), hours: options.hours ?? hours.service,
  });
  const orders = createOrdersModule({
    connection, geography, auth: authThenIndexes, ...(customerThenIndexes && { customer: customerThenIndexes }), ...(options.orderSettings && { settings: options.orderSettings }), ...(options.money && { money: options.money }),
    quotes: {
      get: (userId, id) => cart.quotes.get(userId, id), revalidate: (userId, id) => cart.quotes.revalidate(userId, id),
      claim: (id, groupId) => cart.store.claimQuote(id, groupId), clearCart: userId => cart.store.clearCart(userId),
    },
    carts: { reorder: (userId, items) => cart.cart.reorder(userId, items) },
    addresses: {
      forOrder: async (userId, id) => {
        const a = await addresses.reader.forOrder(userId, id);
        return a && {
          id: a.id, label: a.label, line1: a.line1, localityName: a.localityName, pincode: a.pincode, landmark: a.landmark, contactName: a.contactName, contactPhone: a.contactPhone, cityId: a.cityId,
          location: a.location, locationAccuracyM: a.locationAccuracyM, deliveryNotes: a.deliveryNotes, voiceMediaId: a.voiceNote?.mediaId ?? null, voiceDurationSec: a.voiceNote?.durationSec ?? null,
          housePhotoMediaId: a.housePhoto?.mediaId ?? null,
        };
      },
    },
    stock: offerings.stock, coupons: pricing.service,
    slots: { hold: (orderId, warehouseId, window) => hours.service.hold(orderId, warehouseId, window), release: async orderId => { await hours.service.release(orderId); } },
    media: {
      copyToOrder: async ({ sourceMediaId, orderId }) => { try { return await media.service.copyToOrder({ sourceMediaId, orderId }); } catch { return null; } },
      scheduleDeletion: async (orderId, endedAt) => { await media.service.scheduleOrderMediaExpiry(orderId, endedAt); },
      isExpired: id => media.service.isGone(id),
    },
    riders: {
      riderOf: async orderId => { const id = await dispatch.field.riderOfOrder(orderId); const r = id ? await riders.service.byId(id) : null; return r && { id: r.id, name: r.name, phone: r.phone }; },
      ordersOf: riderId => dispatch.field.liveOrderIds(riderId),
    },
    dispatch: { cancelled: orderId => dispatch.hooks.onOrderCancelled(orderId), paid: orderId => dispatch.hooks.onOrderPaid(orderId) },
    link: orderId => { try { return tracking.service.link(orderId); } catch { return null; } },
    notifier: {
      placed: async (userId, group, orderNos) => { await notifications.notify({ userId, templateKey: "customer_order_placed", channels: ["push"], vars: { orderNo: orderNos.join(", ") }, data: { type: "order", groupId: group.id }, dedupeKey: `order:${group.id}:placed` }); },
      confirmed: async (userId, order) => { await notifications.notify({ userId, templateKey: "customer_order_confirmed", channels: ["push"], vars: { orderNo: order.orderNo }, data: { type: "order", orderId: order.id }, dedupeKey: `order:${order.id}:confirmed` }); },
      itemUnavailable: async (userId, order, itemName) => { await notifications.notify({ userId, templateKey: "customer_item_unavailable", channels: ["push"], vars: { orderNo: order.orderNo, itemName }, data: { type: "order", orderId: order.id }, dedupeKey: `order:${order.id}:item:${itemName}:${order.rev}` }); },
      cancelled: async (userId, order, reason) => { await notifications.notify({ userId, templateKey: "customer_order_cancelled", channels: ["push"], vars: { orderNo: order.orderNo, reason }, data: { type: "order", orderId: order.id }, dedupeKey: `order:${order.id}:cancelled` }); },
      newOrder: async () => undefined,
    },
  });
  const ordersPort = options.orders ?? orders.port;

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
    connection, geography, orders: ordersPort, settings: { ...options.deliverySettings, ...riders.settings, ...options.deliverySettings },
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

  // Cash, tracking and offline sync sit on top of dispatch: they ask it how a rider stands with an order.
  const relations = {
    relation: (riderId: string, orderId: string) => dispatch.field.relation(riderId, orderId),
    riderOfOrder: (orderId: string) => dispatch.field.riderOfOrder(orderId),
    liveOrderIds: (riderId: string) => dispatch.field.liveOrderIds(riderId),
    deliveredToday: (riderId: string) => dispatch.field.deliveredToday(riderId),
  };
  const slim = (r: { id: string; name: string; zoneId: string } | null) => (r ? { id: r.id, name: r.name, zoneId: r.zoneId } : null);
  const cash = createCashModule({
    connection, geography, relations, orders: ordersPort, ...(riderThenIndexes && { rider: riderThenIndexes }), auth: authThenIndexes,
    riders: {
      forUser: userId => riders.service.forUser(userId),
      get: async id => slim(await riders.service.byId(id)),
      getMany: async ids => (await riders.service.getMany(ids)).map(r => ({ id: r.id, name: r.name, zoneId: r.zoneId })),
    },
  });
  const tracking = createTrackingModule({
    connection, relations, orders: ordersPort, ...(riderThenIndexes && { rider: riderThenIndexes }), ...(customerThenIndexes && { customer: customerThenIndexes }),
    riders: { forUser: userId => riders.service.forUser(userId), byId: id => riders.service.byId(id), recordLocation: (id, location, at) => riders.service.recordLocation(id, location, at) },
    settings: { pingOnOrderSeconds: riders.settings.locationPingSecondsOnOrder, pingIdleSeconds: riders.settings.locationPingSecondsIdle, ...options.trackingSettings },
    eta, ...(options.trackingTokenSecret && { tokenSecret: options.trackingTokenSecret }),
  });
  const sync = createSyncModule({
    connection, orders: ordersPort, ...(riderThenIndexes && { rider: riderThenIndexes }), auth: authThenIndexes,
    riders: { forUser: userId => riders.service.forUser(userId), byId: id => riders.service.byId(id) },
    field: dispatch.field, cash: cash.service, tracking: tracking.service, media: { linkFor: id => media.service.linkFor(id) },
    ...(options.syncSettings && { settings: options.syncSettings }),
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
    await jobs.service.every("pricing.expire_rain", 60_000, () => pricing.service.expireRain());
    await jobs.service.every("dispatch.ack_sweep", 10_000, () => dispatch.assign.sweepAcks());
    await jobs.service.every("dispatch.auto_assign", 15_000, () => dispatch.assign.autoAssignPending());
    await jobs.service.every("riders.silent_sweep", 60_000, () => riders.service.sweepSilent());
    jobs.service.start(pollMs);
    return { stop: () => jobs.service.stop() };
  }

  return {
    catalog, offerings, availability, media, jobs, notifications, discovery, addresses, riders, dispatch, cash, tracking, sync, pricing, cart, orders, hours, stock: offerings.stock,
    routes: [
      ...catalog.routes, ...offerings.routes, ...availability.routes, ...media.routes, ...notifications.routes, ...discovery.routes, ...addresses.routes,
      // `/admin/riders/live` must be registered before the riders' `/admin/riders/:id`, or "live" would be read as an id.
      ...dispatch.routes, ...riders.routes, ...cash.routes, ...tracking.routes, ...sync.routes, ...pricing.routes, ...cart.routes, ...orders.routes, ...hours.routes,
    ] satisfies Route[],
    ensureIndexes, startBackground,
  };
}

export function dev2Routes(options: Dev2Options = {}): Route[] { return createDev2Modules(options).routes; }
