export type AddressLabel = "Home" | "Work" | "Other";
export const MAX_ADDRESSES = 20;

export interface Address {
  id: string; userId: string; label: AddressLabel; line1: string; cityId: string; localityId: string; localityName: string; pincode: string;
  /** Required: in hilly streets the landmark is what a rider actually finds the door by. */
  landmark: string; contactName: string; contactPhone: string;
  location: { lat: number; lng: number }; locationAccuracyM: number | null;
  /** The zone the point is in, if any. An address outside every zone is still saved, but not deliverable. */
  zoneId: string | null; isDeliverable: boolean; isDefault: boolean;
  voiceMediaId: string | null; voiceDurationSec: number | null; housePhotoMediaId: string | null; deliveryNotes: string | null;
  createdAt: Date; updatedAt: Date;
}

/** The address as the apps see it. */
export function addressView(a: Address) {
  return {
    id: a.id, label: a.label, line1: a.line1, cityId: a.cityId, localityId: a.localityId, localityName: a.localityName, pincode: a.pincode,
    landmark: a.landmark, contactName: a.contactName, contactPhone: a.contactPhone, location: a.location, locationAccuracyM: a.locationAccuracyM,
    zoneId: a.zoneId, isDeliverable: a.isDeliverable, isDefault: a.isDefault,
    voiceNote: a.voiceMediaId ? { mediaId: a.voiceMediaId, durationSec: a.voiceDurationSec } : null,
    housePhoto: a.housePhotoMediaId ? { mediaId: a.housePhotoMediaId } : null,
    deliveryNotes: a.deliveryNotes,
  };
}
