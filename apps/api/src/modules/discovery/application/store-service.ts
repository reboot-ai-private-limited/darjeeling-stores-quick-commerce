import type { Geography } from "../../../platform/geography.js";
import { notFound, validation } from "../../catalog/catalog.public.js";
import type { BannerSource, MediaUrls, StoreSettings, UserContacts, WaitlistStore } from "./ports.js";

export interface WaitlistInput { phone: string | null; location: { lat: number; lng: number } | null; localityId: string | null }

/** Store status, home banners and the "coming soon" waitlist (F08). */
export function createStoreService(deps: {
  geography: Geography; storeSettings: StoreSettings; banners: BannerSource; media: MediaUrls; contacts: UserContacts; waitlist: WaitlistStore;
  now: () => Date; newId: () => string;
}) {
  const { geography, storeSettings, banners, media, contacts, waitlist, now, newId } = deps;

  return {
    async status(zoneId: string) {
      const zone = await geography.zone(zoneId);
      if (!zone || !zone.isEnabled) throw notFound("Zone");
      const [warehouses, s] = await Promise.all([geography.warehousesOfZone(zoneId), storeSettings.forZone(zoneId)]);
      const open = warehouses.some(w => w.isEnabled && w.isOpenNow);
      const paused = zone.isPaused;
      return {
        zoneId, accepting: open && !paused, open, paused, pauseMessage: paused ? s.pauseMessage : null,
        opensAt: s.opensAt?.toISOString() ?? null, closesAt: s.closesAt?.toISOString() ?? null,
        afterHoursMode: s.afterHoursMode, preOrderAvailable: s.preOrderAvailable,
        eta: { minMinutes: s.etaMinMinutes, maxMinutes: s.etaMaxMinutes },
        minOrder: s.minOrder, freeDeliveryAbove: s.freeDeliveryAbove, smallOrderFee: s.smallOrderFee, notices: s.notices,
      };
    },

    async banners(zoneId: string) {
      const zone = await geography.zone(zoneId);
      if (!zone || !zone.isEnabled) throw notFound("Zone");
      const list = await banners.forZone(zoneId);
      const ids = [...new Set(list.map(b => b.imageMediaId).filter((id): id is string => id !== null))];
      const urls = ids.length > 0 ? await media.urls(ids) : {};
      return list.map(b => ({ id: b.id, title: b.title, image: b.imageMediaId ? { mediaId: b.imageMediaId, urls: urls[b.imageMediaId] ?? {} } : null, link: b.link }));
    },

    /** Joins the "coming soon" list. A logged-in customer's own phone is used; saying the same thing twice changes nothing. */
    async joinWaitlist(customer: { userId: string } | undefined, input: WaitlistInput): Promise<void> {
      const phone = customer ? await contacts.phoneOf(customer.userId) ?? input.phone : input.phone;
      if (!phone) throw validation("A phone number is required", { field: "phone" });
      if (!input.location && !input.localityId) throw validation("Send a location or a locality", { field: "location" });
      if (input.localityId && !(await geography.locality(input.localityId))) throw notFound("Locality");
      // One entry per phone and area: a locality, or a patch of about a kilometre when only a point is known.
      const areaKey = input.localityId ? `loc:${input.localityId}` : `pt:${input.location!.lat.toFixed(2)},${input.location!.lng.toFixed(2)}`;
      await waitlist.add({ id: newId(), userId: customer?.userId ?? null, phone, location: input.location, localityId: input.localityId, areaKey, createdAt: now() });
    },
  };
}

export type StoreService = ReturnType<typeof createStoreService>;
