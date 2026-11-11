import { api } from "./http";

export type Address = {
  id: string; label: "Home" | "Work" | "Other"; line1: string; cityId?: string; localityId: string; localityName?: string; pincode: string; landmark: string;
  contactName: string; contactPhone: string; location: { lat: number; lng: number }; zoneId?: string | null; isDeliverable: boolean; isDefault: boolean;
  voiceNote?: { mediaId: string; durationSec: number } | null; housePhoto?: { mediaId: string } | null; deliveryNotes?: string | null;
};
export type AddressInput = {
  label: "Home" | "Work" | "Other"; line1: string; localityId: string; pincode: string; landmark: string; contactName: string; contactPhone: string;
  location: { lat: number; lng: number }; deliveryNotes?: string | null; makeDefault?: boolean;
};

export const listAddresses = () => api<Address[]>("GET", "/addresses").then(r => r.data);
export const createAddress = (a: AddressInput) => api<Address>("POST", "/addresses", a).then(r => r.data);
export const updateAddress = (id: string, a: Partial<AddressInput>) => api<Address>("PUT", `/addresses/${id}`, a).then(r => r.data);
export const deleteAddress = (id: string) => api("DELETE", `/addresses/${id}`);
export const setDefaultAddress = (id: string) => api<Address>("POST", `/addresses/${id}/default`).then(r => r.data);

/** One-line summary for lists and checkout. */
export const addressLine = (a: Address) => [a.line1, a.landmark, a.localityName, a.pincode].filter(Boolean).join(", ");
