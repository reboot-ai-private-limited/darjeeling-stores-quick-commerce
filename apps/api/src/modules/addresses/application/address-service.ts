import type { Geography } from "../../../platform/geography.js";
import { notFound, validation } from "../../catalog/catalog.public.js";
import { MAX_ADDRESSES, addressView, type Address, type AddressLabel } from "../domain/address.js";
import type { AddressMedia, AddressStore } from "./ports.js";

export interface AddressInput {
  label: AddressLabel; line1: string; localityId: string; pincode: string; landmark: string; contactName: string; contactPhone: string;
  location: { lat: number; lng: number }; locationAccuracyM: number | null; voiceMediaId: string | null; housePhotoMediaId: string | null;
  deliveryNotes: string | null; makeDefault: boolean;
}
/** Only what the customer sent. A media id of `null` removes that file; leaving it out keeps it. */
export type AddressPatch = { [K in keyof AddressInput]?: AddressInput[K] | undefined };

/** A customer's saved addresses (F09). */
export function createAddressService(deps: { store: AddressStore; geography: Geography; media: AddressMedia; now: () => Date; newId: () => string }) {
  const { store, geography, media, now, newId } = deps;

  /** City, area name and zone for a point. Outside every zone is not an error: the address is saved but not deliverable. */
  async function placeOf(localityId: string, location: { lat: number; lng: number }) {
    const locality = await geography.locality(localityId);
    if (!locality || !locality.isActive) throw notFound("Locality");
    const zone = await geography.zoneAt(location);
    return { cityId: locality.cityId, localityName: locality.name, zoneId: zone?.id ?? null, isDeliverable: zone !== null && zone.isEnabled && !zone.isPaused };
  }
  async function mine(userId: string, id: string): Promise<Address> {
    const address = await store.get(userId, id);
    if (!address) throw notFound("Address");
    return address;
  }

  return {
    async list(userId: string) { return (await store.list(userId)).map(addressView); },
    async get(userId: string, id: string) { return addressView(await mine(userId, id)); },

    async create(userId: string, input: AddressInput) {
      if ((await store.count(userId)) >= MAX_ADDRESSES) throw validation(`You can save at most ${MAX_ADDRESSES} addresses; delete one first`, { reason: "too_many" });
      const id = newId();
      const place = await placeOf(input.localityId, input.location);
      const claimed: string[] = [];
      try {
        const voice = input.voiceMediaId ? await media.claim({ mediaId: input.voiceMediaId, userId, kind: "address_voice", addressId: id }) : null;
        if (input.voiceMediaId) claimed.push(input.voiceMediaId);
        if (input.housePhotoMediaId) { await media.claim({ mediaId: input.housePhotoMediaId, userId, kind: "address_photo", addressId: id }); claimed.push(input.housePhotoMediaId); }
        const at = now();
        const saved = await store.insert({
          id, userId, label: input.label, line1: input.line1, ...place, localityId: input.localityId, pincode: input.pincode, landmark: input.landmark,
          contactName: input.contactName, contactPhone: input.contactPhone, location: input.location, locationAccuracyM: input.locationAccuracyM, isDefault: false,
          voiceMediaId: input.voiceMediaId, voiceDurationSec: voice?.durationSec ?? null, housePhotoMediaId: input.housePhotoMediaId, deliveryNotes: input.deliveryNotes,
          createdAt: at, updatedAt: at,
        }, input.makeDefault);
        return addressView(saved);
      } catch (error) {
        // Nothing was saved, so do not leave the customer's files attached to an address that does not exist.
        for (const mediaId of claimed) await media.unclaim(mediaId, id).catch(() => undefined);
        throw error;
      }
    },

    async update(userId: string, id: string, patch: AddressPatch) {
      const current = await mine(userId, id);
      const next: Address = { ...current, updatedAt: now() };
      if (patch.label !== undefined) next.label = patch.label;
      if (patch.line1 !== undefined) next.line1 = patch.line1;
      if (patch.pincode !== undefined) next.pincode = patch.pincode;
      if (patch.landmark !== undefined) next.landmark = patch.landmark;
      if (patch.contactName !== undefined) next.contactName = patch.contactName;
      if (patch.contactPhone !== undefined) next.contactPhone = patch.contactPhone;
      if (patch.locationAccuracyM !== undefined) next.locationAccuracyM = patch.locationAccuracyM;
      if (patch.deliveryNotes !== undefined) next.deliveryNotes = patch.deliveryNotes;
      if (patch.location !== undefined) next.location = patch.location;
      if (patch.localityId !== undefined) next.localityId = patch.localityId;
      // A new place or a new locality means the zone, city and area name are worked out again.
      if (patch.location !== undefined || patch.localityId !== undefined) Object.assign(next, await placeOf(next.localityId, next.location));

      const replaced: string[] = [];
      const claimed: string[] = [];
      try {
        if (patch.voiceMediaId !== undefined && patch.voiceMediaId !== current.voiceMediaId) {
          if (patch.voiceMediaId === null) { next.voiceMediaId = null; next.voiceDurationSec = null; }
          else {
            const voice = await media.claim({ mediaId: patch.voiceMediaId, userId, kind: "address_voice", addressId: id });
            claimed.push(patch.voiceMediaId);
            next.voiceMediaId = patch.voiceMediaId; next.voiceDurationSec = voice.durationSec;
          }
          if (current.voiceMediaId) replaced.push(current.voiceMediaId);
        }
        if (patch.housePhotoMediaId !== undefined && patch.housePhotoMediaId !== current.housePhotoMediaId) {
          if (patch.housePhotoMediaId === null) next.housePhotoMediaId = null;
          else { await media.claim({ mediaId: patch.housePhotoMediaId, userId, kind: "address_photo", addressId: id }); claimed.push(patch.housePhotoMediaId); next.housePhotoMediaId = patch.housePhotoMediaId; }
          if (current.housePhotoMediaId) replaced.push(current.housePhotoMediaId);
        }
        await store.save(next);
      } catch (error) {
        for (const mediaId of claimed) await media.unclaim(mediaId, id).catch(() => undefined);
        throw error;
      }
      // The old voice note or photo goes only once the new state is saved.
      for (const mediaId of replaced) await media.release(mediaId, "address_media_replaced").catch(() => undefined);
      if (patch.makeDefault === true) await store.setDefault(userId, id, now());
      return addressView(await mine(userId, id));
    },

    async remove(userId: string, id: string): Promise<void> {
      const { deleted } = await store.delete(userId, id, now());
      if (!deleted) throw notFound("Address");
      await media.releaseAll(id, "address_deleted");
    },

    async makeDefault(userId: string, id: string) {
      if (!(await store.setDefault(userId, id, now()))) throw notFound("Address");
      return addressView(await mine(userId, id));
    },

    /** For the orders module (Dev 1): one of the customer's addresses with its zone, or null. Another customer's id is null too. */
    async forOrder(userId: string, id: string) { const a = await store.get(userId, id); return a ? addressView(a) : null; },

    /** When an account is closed: every address and its files. */
    async removeAllFor(userId: string): Promise<number> {
      const removed = await store.deleteAll(userId);
      for (const address of removed) await media.releaseAll(address.id, "account_deleted");
      return removed.length;
    },
  };
}

export type AddressService = ReturnType<typeof createAddressService>;
