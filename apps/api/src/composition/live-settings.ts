import type { DiscoverySettings } from "../modules/discovery/discovery.public.js";
import type { DispatchSettings } from "../modules/dispatch/dispatch.public.js";
import type { MediaSettings } from "../modules/media/media.public.js";
import type { OrderSettings } from "../modules/orders/orders.public.js";
import type { PaymentSettings } from "../modules/payments/payments.public.js";
import type { RefundSettings } from "../modules/refunds/refunds.public.js";
import { DEFS, type Group, type SettingsService, type SettingValue } from "../modules/settings/settings.public.js";
import type { SyncSettings } from "../modules/sync/sync.public.js";
import type { TrackingSettings } from "../modules/tracking/tracking.public.js";

/** Values that are not owner-editable settings: secrets and addresses that come from the environment. */
export interface FixedValues {
  trackingBaseUrl?: string | null; otpKeyHex?: string | null;
  upiPayee?: string | null; upi?: { vpa: string; payeeName: string } | null;
}

const GROUPS: readonly Group[] = ["orders", "payments", "assignment", "delivery", "eta", "media", "store"];

/**
 * The settings of the modules that have no zone or warehouse to ask about (orders, payments, refunds, riders, dispatch, tracking, offline
 * sync, media, discovery), as live objects. Each value is read from a copy of the admin settings that is refreshed right after every saved
 * change, and every half minute in case something else changed the database, so an owner's change applies to the next request.
 */
export function createLiveSettings(service: SettingsService, fixed: FixedValues = {}) {
  const cache = new Map<Group, Record<string, SettingValue>>();
  async function refresh(): Promise<void> {
    await Promise.all(GROUPS.map(async group => { cache.set(group, await service.effectiveValues(group)); }));
  }
  service.onChange(refresh);

  const read = (group: Group, key: string): SettingValue => cache.get(group)?.[key] ?? DEFS.get(`${group}.${key}`)!.default;
  const n = (group: Group, key: string) => Number(read(group, key));
  const b = (group: Group, key: string) => read(group, key) === true;
  const s = <T extends string>(group: Group, key: string) => String(read(group, key)) as T;
  /** An object whose properties are read each time they are used. */
  const live = <T extends object>(getters: { [K in keyof T]?: () => T[K] }): Partial<T> =>
    Object.defineProperties({}, Object.fromEntries(Object.entries(getters as Record<string, () => unknown>).map(([key, get]) => [key, { get, enumerable: true }]))) as Partial<T>;

  const orders = live<OrderSettings>({
    confirmMode: () => s("orders", "confirmMode"), paymentWindowMinutes: () => n("orders", "paymentWindowMinutes"), otpMaxTries: () => n("orders", "otpMaxTries"),
    customerCancelUntil: () => s("orders", "customerCancelUntil"),
    slaMinutes: () => ({ confirm: n("orders", "slaConfirmMinutes"), pack: n("orders", "slaPackMinutes"), assign: n("orders", "slaAssignMinutes") }),
    ...(fixed.trackingBaseUrl !== undefined && { trackingBaseUrl: () => fixed.trackingBaseUrl ?? null }),
    ...(fixed.otpKeyHex !== undefined && { otpKeyHex: () => fixed.otpKeyHex ?? null }),
  });
  const payments = live<PaymentSettings>({
    payLinkMinutes: () => n("payments", "payLinkMinutes"), ...(fixed.upiPayee !== undefined && { upiPayee: () => fixed.upiPayee ?? null }),
  });
  const refunds = live<RefundSettings>({
    refundWindowHours: () => n("payments", "refundWindowHours"), refundPhotoRequired: () => b("payments", "refundPhotoRequired"), maxPhotos: () => n("payments", "maxRefundPhotos"),
  });
  const delivery = live<DispatchSettings>({
    punchInRadiusMeters: () => n("delivery", "punchInRadiusMeters"), deliveryOtpEnabled: () => b("delivery", "deliveryOtpEnabled"),
    locationPingSecondsOnOrder: () => n("delivery", "locationPingSecondsOnOrder"), locationPingSecondsIdle: () => n("delivery", "locationPingSecondsIdle"),
    ackTimeoutSeconds: () => n("assignment", "ackTimeoutSeconds"), maxActiveOrders: () => n("assignment", "maxActiveOrders"),
    locationStaleSeconds: () => n("assignment", "locationStaleSeconds"), offlineAfterMinutes: () => n("assignment", "offlineAfterMinutes"),
    assignmentMode: () => s("assignment", "assignmentMode"), maxBatchOrders: () => n("assignment", "maxBatchOrders"), delayedAfterMinutes: () => n("assignment", "delayedAfterMinutes"),
  });
  const tracking = live<TrackingSettings>({
    averageSpeedKmh: () => n("eta", "averageSpeedKmh"), detourFactor: () => n("eta", "detourFactor"), extraMinutes: () => n("eta", "extraMinutes"),
    etaRefreshSeconds: () => n("eta", "etaRefreshSeconds"), tokenTtlHours: () => n("eta", "tokenTtlHours"), maxPointAgeDays: () => n("eta", "maxPointAgeDays"),
  });
  const sync = live<SyncSettings>({
    geofenceMeters: () => n("delivery", "geofenceMeters"), maxClockSkewMinutes: () => n("delivery", "maxClockSkewMinutes"), ...(fixed.upi !== undefined && { upi: () => fixed.upi ?? null }),
  });
  const media = live<MediaSettings>({
    maxImageBytes: () => n("media", "maxImageBytes"), maxVoiceBytes: () => n("media", "maxVoiceBytes"), maxVoiceSeconds: () => n("media", "maxVoiceSeconds"),
    orderMediaRetentionDays: () => n("media", "orderMediaRetentionDays"), evidenceRetentionDays: () => n("media", "evidenceRetentionDays"),
    unattachedHours: () => n("media", "unattachedHours"), maxPendingPerUser: () => n("media", "maxPendingPerUser"),
  });
  const discovery = live<DiscoverySettings>({
    showOutOfStockItems: () => b("store", "showOutOfStockItems"), maxChanges: () => n("store", "maxChangesPerSync"), maxQtyPerItem: () => n("orders", "maxQtyPerItem"),
  });

  let timer: NodeJS.Timeout | undefined;
  return {
    orders, payments, refunds, delivery, tracking, sync, media, discovery, refresh,
    /** Loads the settings now and then keeps them fresh. Call `stop()` on shutdown. */
    async start(everyMs = 30_000): Promise<{ stop(): void }> {
      await refresh();
      timer = setInterval(() => { void refresh().catch(() => undefined); }, everyMs);
      timer.unref();
      return { stop: () => { if (timer) clearInterval(timer); timer = undefined; } };
    },
  };
}

export type LiveSettings = ReturnType<typeof createLiveSettings>;
