import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import type { JobService } from "../jobs/jobs.public.js";
import { BROADCAST_JOB, createCampaignService } from "./application/campaign-service.js";
import { SEND_JOB, createDeliveryService } from "./application/delivery-service.js";
import { createOtpTransport } from "./application/otp-transport.js";
import type {
  AudienceDirectory, BackInStockOutbox, DeviceRegistry, MediaUrls, PushProvider, SmsProvider, UserContacts, WhatsAppProvider,
} from "./application/ports.js";
import { createTemplateService } from "./application/template-service.js";
import type { Template } from "./domain/notification.js";
import { createFcmPush, fcmConfigFromEnv } from "./infrastructure/fcm-push.js";
import { createMongoNotificationStore } from "./infrastructure/mongo-notification-store.js";
import { unconfiguredPush, unconfiguredSms, unconfiguredWhatsApp } from "./infrastructure/unconfigured.js";
import { createWhatsAppCloud, whatsappConfigFromEnv } from "./infrastructure/whatsapp-cloud.js";
import { noCustomers, notificationRoutes, type CustomerResolver, type WebhookConfig } from "./interface/routes.js";

export type { NotifyInput, NotifyResult } from "./application/delivery-service.js";
export type { OtpChannel, OtpTransport } from "./application/otp-transport.js";
export type {
  AudienceDirectory, BackInStockOutbox, DeviceRegistry, MediaUrls, PushMessage, PushProvider, SmsProvider, UserContacts, WhatsAppMessage, WhatsAppProvider,
} from "./application/ports.js";
export { ProviderError } from "./application/ports.js";
export type { Channel, Purpose } from "./domain/notification.js";
export { createFcmPush, fcmConfigFromEnv } from "./infrastructure/fcm-push.js";
export { createWhatsAppCloud, whatsappConfigFromEnv } from "./infrastructure/whatsapp-cloud.js";
export { unconfiguredPush, unconfiguredSms, unconfiguredWhatsApp } from "./infrastructure/unconfigured.js";
export { noCustomers, type CustomerResolver, type WebhookConfig } from "./interface/routes.js";
export { verifyMetaSignature } from "./domain/webhook.js";

/** Stand-ins until the identity and geography modules provide the real ones: nobody has a phone, a device, or a place. */
export const noContacts: UserContacts = { phoneOf: async () => null };
export const noDevices: DeviceRegistry = { tokensFor: async () => [], removeToken: async () => undefined };
export const noAudience: AudienceDirectory = { customerIds: async () => [] };
export const noBackInStock: BackInStockOutbox = { pending: async () => [], markDelivered: async () => undefined, markFailed: async () => undefined };
export const noMediaUrls: MediaUrls = { urls: async () => ({}) };

/**
 * Templates every install starts with. They are added only when missing, so an admin's edits are never overwritten.
 * The WhatsApp names must match templates approved by the provider.
 */
export const DEFAULT_TEMPLATES: readonly Omit<Template, "id" | "createdAt" | "updatedAt">[] = [
  { key: "back_in_stock", channel: "push", title: "Back in stock", body: "{{productName}} ({{variantLabel}}) is available again. Order now before it sells out.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "back_in_stock", channel: "whatsapp", title: null, body: "Good news! {{productName}} ({{variantLabel}}) is back in stock at Darjeeling Stores. Order now.", whatsappTemplateName: "back_in_stock_v1", category: "utility", language: "en", isActive: true },
  { key: "assignment_assigned", channel: "push", title: "New order assigned", body: "Order {{orderNo}} is assigned to you. Acknowledge it now.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "handover_assigned", channel: "push", title: "Order handed over to you", body: "Order {{orderNo}} is handed over to you. Acknowledge it now.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "assignment_cancelled", channel: "push", title: "Order taken back", body: "Order {{orderNo}} was taken back by dispatch.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "payment_paid", channel: "push", title: "Already paid", body: "Order {{orderNo}} is already paid. Do not collect cash.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "assignment_unacknowledged", channel: "whatsapp", title: null, body: "{{name}}, order {{orderNo}} is waiting for you to acknowledge. Open the rider app now.", whatsappTemplateName: "assignment_unacknowledged_v1", category: "utility", language: "en", isActive: true },
  { key: "customer_order_placed", channel: "push", title: "Order placed", body: "Your order {{orderNo}} is placed. We will bring it soon.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "customer_order_confirmed", channel: "push", title: "Order confirmed", body: "Order {{orderNo}} is confirmed and will be packed shortly.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "customer_item_unavailable", channel: "push", title: "An item is unavailable", body: "{{itemName}} in order {{orderNo}} is not available. Your bill has been updated.", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "customer_order_cancelled", channel: "push", title: "Order cancelled", body: "Order {{orderNo}} was cancelled. {{reason}}", whatsappTemplateName: null, category: "utility", language: "en", isActive: true },
  { key: "otp_login", channel: "whatsapp", title: null, body: "{{code}} is your Darjeeling Stores login code. Do not share it with anyone.", whatsappTemplateName: "login_otp", category: "authentication", language: "en", isActive: true },
  { key: "otp_login", channel: "sms", title: null, body: "Your Darjeeling Stores login code is {{code}}. Valid for 5 minutes.", whatsappTemplateName: null, category: "authentication", language: "en", isActive: true },
];

/** Providers named by environment variables; any that is missing is "not configured" and fails with a clear reason. */
export function providersFromEnv(env: NodeJS.ProcessEnv): { push: PushProvider; whatsapp: WhatsAppProvider; sms: SmsProvider; webhook: WebhookConfig } {
  const fcm = fcmConfigFromEnv(env);
  const wa = whatsappConfigFromEnv(env);
  return {
    push: fcm ? createFcmPush(fcm) : unconfiguredPush,
    whatsapp: wa ? createWhatsAppCloud(wa) : unconfiguredWhatsApp,
    sms: unconfiguredSms,
    webhook: { ...(env.WHATSAPP_VERIFY_TOKEN && { verifyToken: env.WHATSAPP_VERIFY_TOKEN }), ...(env.WHATSAPP_APP_SECRET && { appSecret: env.WHATSAPP_APP_SECRET }) },
  };
}

export interface NotificationsModuleOptions {
  connection: Connection;
  /** The job queue and worker. Message sending and broadcasts run as jobs on it. */
  jobs: JobService;
  auth?: AuthResolver;
  customer?: CustomerResolver;
  push?: PushProvider; whatsapp?: WhatsAppProvider; sms?: SmsProvider; webhook?: WebhookConfig;
  contacts?: UserContacts; devices?: DeviceRegistry; audience?: AudienceDirectory;
  outbox?: BackInStockOutbox; media?: MediaUrls;
}

/** Builds notifications (F23). Call `await ready()` once after the database connects. */
export function createNotificationsModule(options: NotificationsModuleOptions) {
  const env = providersFromEnv(process.env);
  const {
    connection, jobs, auth = denyAll, customer = noCustomers, push = env.push, whatsapp = env.whatsapp, sms = env.sms, webhook = env.webhook,
    contacts = noContacts, devices = noDevices, audience = noAudience, outbox = noBackInStock, media = noMediaUrls,
  } = options;
  const store = createMongoNotificationStore(connection);
  const now = () => new Date();
  const newId = () => new Types.ObjectId().toHexString();

  const delivery = createDeliveryService({ store, queue: jobs.queue, push, whatsapp, sms, contacts, devices, now, newId });
  const templates = createTemplateService({ store, now, newId });
  const campaigns = createCampaignService({ store, queue: jobs.queue, delivery, audience, outbox, media, now, newId });
  const otp = createOtpTransport({ store, whatsapp, sms, now, newId });

  jobs.register(SEND_JOB, async ({ payload }) => delivery.deliver(String(payload.notificationId)), {
    onExhausted: (job, error) => delivery.giveUp(String(job.payload.notificationId), error),
  });
  jobs.register(BROADCAST_JOB, async ({ payload }) => campaigns.runBroadcast(payload as never));

  return {
    store, delivery, templates, campaigns,
    /** For the identity module: deliver a login code by WhatsApp, falling back to SMS. */
    otp,
    /** For every other module: queue a message from a template. */
    notify: delivery.notify,
    routes: notificationRoutes({ templates, delivery, campaigns }, customer, auth, webhook),
    /** Creates indexes and adds the built-in templates that are missing. */
    async ready(): Promise<void> {
      await store.ensureIndexes();
      await store.seedTemplates(DEFAULT_TEMPLATES, newId, now());
    },
  };
}
