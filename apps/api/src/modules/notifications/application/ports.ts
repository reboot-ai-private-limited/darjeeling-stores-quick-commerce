import type { Channel, Notification, NotificationStatus, Prefs, Template } from "../domain/notification.js";

/** A failure from a provider. `permanent` means trying again cannot help (a bad number, an unapproved template). */
export class ProviderError extends Error {
  constructor(message: string, readonly permanent: boolean, readonly code?: string, readonly invalidToken = false) { super(message); this.name = "ProviderError"; }
}

export interface PushMessage { token: string; title?: string; body?: string; imageUrl?: string; data: Record<string, string>; priority: "high" | "normal" }
export interface PushProvider { readonly name: string; send(message: PushMessage): Promise<{ messageId: string }> }

export interface WhatsAppMessage { to: string; templateName: string; language: string; params: string[]; buttonParams?: string[] }
export interface WhatsAppProvider { readonly name: string; sendTemplate(message: WhatsAppMessage): Promise<{ messageId: string }> }

export interface SmsProvider { readonly name: string; send(message: { to: string; text: string }): Promise<{ messageId: string }> }

/** The identity module (Dev 1) knows each user's phone and registered push tokens. */
export interface UserContacts { phoneOf(userId: string): Promise<string | null> }
export interface DeviceRegistry { tokensFor(userId: string): Promise<string[]>; removeToken(token: string): Promise<void> }
/** Customers in given zones, for promo broadcasts. Comes from the addresses and geography modules. */
export interface AudienceDirectory { customerIds(zoneIds: readonly string[], afterId: string | undefined, limit: number): Promise<string[]> }

/** The Notify Me module's queue of "item is back" messages (F07). */
export interface BackInStockOutbox {
  pending(limit: number): Promise<{
    subscriptionId: string;
    message: { userId: string; zoneId: string; productId: string; variantId: string | null; productName: string; variantLabel: string | null; imageMediaId: string | null; channels: Channel[]; deepLink: string };
  }[]>;
  markDelivered(subscriptionId: string): Promise<void>;
  markFailed(subscriptionId: string, error: string): Promise<void>;
}
export interface MediaUrls { urls(mediaIds: readonly string[]): Promise<Record<string, Record<string, string>>> }

export class DuplicateTemplateError extends Error { constructor() { super("A template with this key and channel exists"); this.name = "DuplicateTemplateError"; } }
export class DuplicateNotificationError extends Error { constructor() { super("This notification was already queued"); this.name = "DuplicateNotificationError"; } }

export interface AuditEntry { actorId: string; actorRole: string; action: string; entityType: string; entityId: string; requestId: string }

export interface LogFilters {
  status?: NotificationStatus | undefined; channel?: Channel | undefined; userId?: string | undefined; orderId?: string | undefined;
  from?: Date | undefined; to?: Date | undefined;
}

export interface NotificationStore {
  ensureIndexes(): Promise<void>;
  /** Adds the built-in templates that are missing. Never changes one an admin has edited. */
  seedTemplates(templates: readonly Omit<Template, "id" | "createdAt" | "updatedAt">[], newId: () => string, at: Date): Promise<void>;

  listTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | null>;
  templatesFor(key: string): Promise<Template[]>;
  insertTemplate(template: Template, audit: AuditEntry): Promise<void>;
  saveTemplate(template: Template, audit: AuditEntry): Promise<void>;

  getPrefs(userId: string): Promise<Prefs | null>;
  getPrefsMany(userIds: readonly string[]): Promise<Map<string, Prefs>>;
  savePrefs(userId: string, prefs: Prefs, at: Date): Promise<void>;

  /** Throws DuplicateNotificationError for a repeated dedupe key on the same channel. */
  insert(notification: Notification): Promise<void>;
  get(id: string): Promise<Notification | null>;
  /** Takes a queued notification for sending, holding it until `until`. Null if it is not queued or someone else holds it. */
  claim(id: string, now: Date, until: Date): Promise<Notification | null>;
  markSent(id: string, providerMessageId: string, at: Date): Promise<void>;
  markFailed(id: string, error: string, at: Date): Promise<void>;
  /** After a try that can be repeated: keeps it queued with the reason. */
  release(id: string, error: string, at: Date): Promise<void>;
  requeue(id: string, at: Date, audit: AuditEntry): Promise<boolean>;
  list(filters: LogFilters, beforeId: string | undefined, limit: number): Promise<Notification[]>;
  failedCount(filters: LogFilters): Promise<number>;
  applyProviderStatus(providerMessageId: string, next: NotificationStatus, error: string | null, at: Date): Promise<boolean>;
  recordAudit(entry: AuditEntry): Promise<void>;
}
