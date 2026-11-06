import { conflict, notFound, validation } from "../../catalog/catalog.public.js";
import type { JobQueue } from "../../jobs/jobs.public.js";
import {
  DEFAULT_PREFS, allowedByPrefs, mapWhatsAppStatus, render, whatsappParams, MissingVariableError,
  type Channel, type Notification, type NotificationStatus, type Prefs, type Purpose, type Vars,
} from "../domain/notification.js";
import {
  DuplicateNotificationError, ProviderError,
  type AuditEntry, type DeviceRegistry, type LogFilters, type NotificationStore, type PushProvider, type SmsProvider, type UserContacts, type WhatsAppProvider,
} from "./ports.js";

export const SEND_JOB = "notification.send";
export const MAX_SEND_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;

export interface NotifyInput {
  userId: string; templateKey: string; vars?: Vars;
  /** Default: push and WhatsApp. SMS is only used when asked for. */
  channels?: readonly Channel[]; purpose?: Purpose; orderId?: string;
  /** For push: what the app reads (`type`, ids, `deepLink`...). Values are text. */
  data?: Record<string, string>; imageUrl?: string; priority?: "high" | "normal";
  /** A repeated key on the same channel is the same message and is not sent twice. */
  dedupeKey?: string;
}
export type SkipReason = "opted_out" | "no_template" | "duplicate";
export interface NotifyResult { queued: { id: string; channel: Channel }[]; skipped: { channel: Channel; reason: SkipReason }[] }

export interface DeliveryDeps {
  store: NotificationStore; queue: JobQueue; push: PushProvider; whatsapp: WhatsAppProvider; sms: SmsProvider;
  contacts: UserContacts; devices: DeviceRegistry; now: () => Date; newId: () => string;
}

const view = (n: Notification) => ({
  id: n.id, userId: n.userId, templateKey: n.templateKey, channel: n.channel, status: n.status, error: n.error, attempts: n.attempts,
  orderId: n.orderId, createdAt: n.createdAt.toISOString(), sentAt: n.sentAt?.toISOString() ?? null,
});

/** Queues messages from templates, sends them through the channel adapters, and keeps the delivery log (F23). */
export function createDeliveryService(deps: DeliveryDeps) {
  const { store, queue, push, whatsapp, sms, contacts, devices, now, newId } = deps;

  async function enqueueSend(id: string, key = `send:${id}`) { await queue.enqueue({ type: SEND_JOB, payload: { notificationId: id }, dedupeKey: key, maxAttempts: MAX_SEND_ATTEMPTS }); }

  /** Saves a message and puts it on the queue. False when the same message was already queued. */
  async function queueMessage(n: Notification): Promise<boolean> {
    try { await store.insert(n); }
    catch (error) { if (error instanceof DuplicateNotificationError) return false; throw error; }
    await enqueueSend(n.id);
    return true;
  }

  function blank(input: Pick<Notification, "userId" | "templateKey" | "channel"> & Partial<Notification>): Notification {
    const at = now();
    return {
      title: null, body: null, whatsapp: null, data: {}, imageUrl: null, priority: "high", to: null, status: "queued", providerMessageId: null, error: null,
      attempts: 0, orderId: null, dedupeKey: null, lockedUntil: null, createdAt: at, updatedAt: at, sentAt: null, ...input, id: newId(),
    };
  }

  async function sendOne(n: Notification): Promise<string> {
    if (n.channel === "push") {
      const tokens = n.userId ? await devices.tokensFor(n.userId) : [];
      if (tokens.length === 0) throw new ProviderError("No registered device for this user", true);
      let transient: ProviderError | undefined;
      let first: string | undefined;
      for (const token of tokens) {
        try {
          const sent = await push.send({
            token, ...(n.title !== null && { title: n.title }), ...(n.body !== null && { body: n.body }), ...(n.imageUrl !== null && { imageUrl: n.imageUrl }),
            data: { ...n.data, notificationId: n.id }, priority: n.priority,
          });
          first ??= sent.messageId;
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          if (error.invalidToken) await devices.removeToken(token);
          else if (!error.permanent) transient = error;
        }
      }
      if (first !== undefined) return first;
      if (transient) throw transient;
      throw new ProviderError("None of the user's devices can receive push any more", true);
    }
    const phone = n.userId ? await contacts.phoneOf(n.userId) : null;
    if (!phone) throw new ProviderError("No phone number for this user", true);
    if (n.channel === "whatsapp") {
      if (!n.whatsapp) throw new ProviderError("This message has no WhatsApp template", true);
      return (await whatsapp.sendTemplate({ to: phone, templateName: n.whatsapp.templateName, language: n.whatsapp.language, params: n.whatsapp.params, buttonParams: n.whatsapp.buttonParams })).messageId;
    }
    return (await sms.send({ to: phone, text: n.body ?? "" })).messageId;
  }

  return {
    queueMessage, blank,

    async notify(input: NotifyInput): Promise<NotifyResult> {
      const purpose = input.purpose ?? "transactional";
      const wanted = [...new Set(input.channels ?? (["push", "whatsapp"] as const))];
      const templates = (await store.templatesFor(input.templateKey)).filter(t => t.isActive);
      const prefs = purpose === "transactional" ? DEFAULT_PREFS : (await store.getPrefs(input.userId)) ?? DEFAULT_PREFS;
      const result: NotifyResult = { queued: [], skipped: [] };
      const vars = input.vars ?? {};
      const messages: Notification[] = [];

      for (const channel of wanted) {
        const template = templates.find(t => t.channel === channel);
        if (!template) { result.skipped.push({ channel, reason: "no_template" }); continue; }
        if (!allowedByPrefs(prefs, purpose, channel)) { result.skipped.push({ channel, reason: "opted_out" }); continue; }
        try {
          messages.push(blank({
            userId: input.userId, templateKey: input.templateKey, channel, orderId: input.orderId ?? null,
            title: template.title === null ? null : render(template.title, vars), body: render(template.body, vars),
            data: input.data ?? {}, imageUrl: input.imageUrl ?? null, priority: input.priority ?? "high",
            dedupeKey: input.dedupeKey === undefined ? null : `${input.dedupeKey}:${channel}`,
            whatsapp: channel === "whatsapp" ? { templateName: template.whatsappTemplateName!, language: template.language, params: whatsappParams(template.body, vars), buttonParams: [] } : null,
          }));
        } catch (error) {
          if (error instanceof MissingVariableError) throw validation(error.message, { field: "vars", variable: error.variable });
          throw error;
        }
      }
      for (const message of messages) {
        if (await queueMessage(message)) result.queued.push({ id: message.id, channel: message.channel });
        else result.skipped.push({ channel: message.channel, reason: "duplicate" });
      }
      return result;
    },

    /**
     * The job handler for one message. Safe to run twice: only a queued message nobody else holds is sent. A failure that
     * cannot be fixed by waiting is recorded and ends the job; any other failure leaves the message queued and retries.
     */
    async deliver(notificationId: string): Promise<"sent" | "failed" | "skipped"> {
      const at = now();
      const n = await store.claim(notificationId, at, new Date(at.getTime() + LEASE_MS));
      if (!n) return "skipped";
      try {
        const providerMessageId = await sendOne(n);
        await store.markSent(n.id, providerMessageId, now());
        return "sent";
      } catch (error) {
        const message = error instanceof Error ? error.message : "Send failed";
        if (error instanceof ProviderError && error.permanent) { await store.markFailed(n.id, message, now()); return "failed"; }
        await store.release(n.id, message, now());
        throw error;
      }
    },

    /** The job gave up after its last try. */
    async giveUp(notificationId: string, error: Error): Promise<void> { await store.markFailed(notificationId, `Gave up after ${MAX_SEND_ATTEMPTS} tries: ${error.message}`.slice(0, 500), now()); },

    async list(filters: LogFilters, cursor: string | undefined, limit: number) {
      if (cursor !== undefined && !/^[a-f0-9]{24}$/.test(cursor)) throw validation("Invalid cursor", { field: "cursor" });
      const rows = await store.list(filters, cursor, limit + 1);
      const page = rows.slice(0, limit);
      return { items: page.map(view), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null, failedCount: await store.failedCount(filters) };
    },

    async retry(id: string, audit: Omit<AuditEntry, "action" | "entityId" | "entityType">) {
      const n = await store.get(id);
      if (!n) throw notFound("Notification");
      if (n.status !== "failed") throw conflict("Only a failed message can be retried", { reason: "not_failed" });
      const at = now();
      if (!(await store.requeue(id, at, { ...audit, action: "notification.retry", entityType: "notification", entityId: id }))) throw conflict("Only a failed message can be retried", { reason: "not_failed" });
      await enqueueSend(id, `send:${id}:retry:${at.getTime()}`);
      return { id, status: "queued" as const };
    },

    /** Delivery reports from WhatsApp: sent, delivered, read, failed. A report only moves a message forward. */
    async applyWhatsAppReports(reports: { id: string; status: string; error?: string }[]): Promise<number> {
      let applied = 0;
      for (const report of reports) {
        const next: NotificationStatus | null = mapWhatsAppStatus(report.status);
        if (next && (await store.applyProviderStatus(report.id, next, report.error ?? null, now()))) applied++;
      }
      return applied;
    },

    async getPrefs(userId: string): Promise<Prefs> { return (await store.getPrefs(userId)) ?? DEFAULT_PREFS; },
    async setPrefs(userId: string, patch: { [K in keyof Prefs]?: boolean | undefined }): Promise<Prefs> {
      const current = (await store.getPrefs(userId)) ?? DEFAULT_PREFS;
      const next: Prefs = {
        promoPush: patch.promoPush ?? current.promoPush, promoWhatsApp: patch.promoWhatsApp ?? current.promoWhatsApp, cartReminders: patch.cartReminders ?? current.cartReminders,
      };
      await store.savePrefs(userId, next, now());
      return next;
    },
  };
}

export type DeliveryService = ReturnType<typeof createDeliveryService>;
