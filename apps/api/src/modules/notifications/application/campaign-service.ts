import { validation } from "../../catalog/catalog.public.js";
import type { JobQueue } from "../../jobs/jobs.public.js";
import { DEFAULT_PREFS, allowedByPrefs, whatsappParams, type Channel } from "../domain/notification.js";
import type { DeliveryService } from "./delivery-service.js";
import type { AudienceDirectory, AuditEntry, BackInStockOutbox, MediaUrls, NotificationStore } from "./ports.js";

export const BROADCAST_JOB = "notification.broadcast";
export const BROADCAST_TEMPLATE = "promo_broadcast";
const PAGE = 200;
const COUNT_LIMIT = 50_000;

export interface BroadcastInput { zoneIds: string[]; title: string; body: string; deepLink: string | null; channels: Channel[] }
interface BroadcastPayload extends BroadcastInput { broadcastId: string }

/** Promo broadcasts and the back-in-stock hand-over from Notify Me (F23, F07). */
export function createCampaignService(deps: {
  store: NotificationStore; queue: JobQueue; delivery: DeliveryService; audience: AudienceDirectory;
  outbox: BackInStockOutbox; media: MediaUrls; now: () => Date; newId: () => string;
}) {
  const { store, queue, delivery, audience, outbox, media, newId } = deps;

  /** Customers in the zones who accept at least one of the channels. */
  async function* optedIn(zoneIds: readonly string[], channels: readonly Channel[]) {
    for (let after: string | undefined; ;) {
      const ids = await audience.customerIds(zoneIds, after, PAGE);
      if (ids.length === 0) return;
      const prefs = await store.getPrefsMany(ids);
      for (const userId of ids) {
        const mine = prefs.get(userId) ?? DEFAULT_PREFS;
        const wants = channels.filter(channel => allowedByPrefs(mine, "promo", channel));
        if (wants.length > 0) yield { userId, channels: wants };
      }
      after = ids[ids.length - 1];
      if (ids.length < PAGE) return;
    }
  }

  return {
    /** Queues a promo to opted-in customers of the zones. Returns at once with how many will get it. */
    async broadcast(input: BroadcastInput, audit: Omit<AuditEntry, "action" | "entityId" | "entityType">) {
      if (input.channels.includes("whatsapp")) {
        const template = (await store.templatesFor(BROADCAST_TEMPLATE)).find(t => t.channel === "whatsapp" && t.isActive && t.category === "marketing");
        if (!template) throw validation("WhatsApp broadcasts need an active marketing template with the key promo_broadcast", { field: "channels" });
      }
      let recipients = 0;
      for await (const _customer of optedIn(input.zoneIds, input.channels)) { if (++recipients >= COUNT_LIMIT) break; }
      const broadcastId = newId();
      const { id: jobId } = await queue.enqueue({ type: BROADCAST_JOB, payload: { broadcastId, ...input } satisfies BroadcastPayload, dedupeKey: `broadcast:${broadcastId}`, maxAttempts: 3 });
      await store.recordAudit({ ...audit, action: "notification.broadcast", entityType: "broadcast", entityId: broadcastId });
      return { jobId, recipients };
    },

    /** The job that does the broadcast. Repeating it queues nobody twice. */
    async runBroadcast(payload: BroadcastPayload): Promise<{ queued: number }> {
      let queued = 0;
      const wa = payload.channels.includes("whatsapp")
        ? (await store.templatesFor(BROADCAST_TEMPLATE)).find(t => t.channel === "whatsapp" && t.isActive && t.whatsappTemplateName)
        : undefined;
      for await (const customer of optedIn(payload.zoneIds, payload.channels)) {
        for (const channel of customer.channels) {
          const message = delivery.blank({
            userId: customer.userId, templateKey: BROADCAST_TEMPLATE, channel, title: channel === "push" ? payload.title : null, body: payload.body,
            data: { type: "promo", ...(payload.deepLink && { deepLink: payload.deepLink }) }, priority: "normal", dedupeKey: `broadcast:${payload.broadcastId}:${customer.userId}:${channel}`,
            whatsapp: channel === "whatsapp" && wa ? { templateName: wa.whatsappTemplateName!, language: wa.language, params: whatsappParams(wa.body, { title: payload.title, body: payload.body }), buttonParams: [] } : null,
          });
          if (channel === "whatsapp" && !message.whatsapp) continue;
          if (await delivery.queueMessage(message)) queued++;
        }
      }
      return { queued };
    },

    /**
     * Hands the "item is back" messages from Notify Me to the delivery queue and tells Notify Me they were taken.
     * Safe to repeat: a subscription's message is queued once however often this runs.
     */
    async drainBackInStock(limit = 100): Promise<{ handedOver: number; failed: number }> {
      const pending = await outbox.pending(limit);
      if (pending.length === 0) return { handedOver: 0, failed: 0 };
      const imageIds = [...new Set(pending.map(p => p.message.imageMediaId).filter((id): id is string => id !== null))];
      const images = imageIds.length > 0 ? await media.urls(imageIds) : {};
      let handedOver = 0;
      let failed = 0;
      for (const { subscriptionId, message } of pending) {
        try {
          const imageUrl = message.imageMediaId ? images[message.imageMediaId]?.["320"] : undefined;
          const result = await delivery.notify({
            userId: message.userId, templateKey: "back_in_stock", dedupeKey: `back-in-stock:${subscriptionId}`,
            channels: message.channels.filter((c): c is "push" | "whatsapp" => c === "push" || c === "whatsapp"),
            vars: { productName: message.productName, variantLabel: message.variantLabel ?? "all sizes" },
            data: { type: "back_in_stock", productId: message.productId, zoneId: message.zoneId, deepLink: `ds://${message.deepLink}` },
            ...(imageUrl && { imageUrl }),
          });
          if (result.queued.length === 0 && !result.skipped.some(s => s.reason === "duplicate" || s.reason === "opted_out")) {
            await outbox.markFailed(subscriptionId, "No active back_in_stock template for the customer's channels");
            failed++;
          } else { await outbox.markDelivered(subscriptionId); handedOver++; }
        } catch (error) {
          await outbox.markFailed(subscriptionId, error instanceof Error ? error.message : "Hand-over failed");
          failed++;
        }
      }
      return { handedOver, failed };
    },
  };
}

export type CampaignService = ReturnType<typeof createCampaignService>;
