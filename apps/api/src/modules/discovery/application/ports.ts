import type { Category, Product } from "../../catalog/catalog.public.js";
import type { Offering } from "../../offerings/offerings.public.js";

/** What discovery reads from the catalog module. */
export interface CatalogReader {
  getProducts(ids: readonly string[]): Promise<Product[]>;
  listCategories(): Promise<Category[]>;
}

/** What discovery reads from the offerings module: what a zone sells and which revision it is at. */
export interface ZoneOfferingsSource {
  zoneOfferings(query: { zoneId: string; productIds?: readonly string[]; activeOnly?: boolean }): Promise<Offering[]>;
  changedSince(zoneId: string, since: number, limit: number): Promise<Offering[]>;
  currentRevision(): Promise<number>;
}

export interface MediaUrls { urls(mediaIds: readonly string[]): Promise<Record<string, Record<string, string>>> }

export interface StoreSettingsValue {
  etaMinMinutes: number; etaMaxMinutes: number;
  /** Paise. */
  minOrder: number; freeDeliveryAbove: number | null; smallOrderFee: number;
  afterHoursMode: "closed" | "pre_order"; preOrderAvailable: boolean;
  opensAt: Date | null; closesAt: Date | null; pauseMessage: string | null;
  notices: { type: string; label: string; amount?: number; extraMinutes?: number }[];
}
/** Fees, hours and notices for a zone: hours (F17), fees and surcharges (F11) and the ETA (F20), all Dev 1's. */
export interface StoreSettings { forZone(zoneId: string): Promise<StoreSettingsValue> }

export interface Banner { id: string; title: string; imageMediaId: string | null; link: { type: "category" | "product" | "url"; id?: string; url?: string } | null }
/** Home banners for a zone (F12, Dev 1). */
export interface BannerSource { forZone(zoneId: string): Promise<Banner[]> }

export interface UserContacts { phoneOf(userId: string): Promise<string | null> }

export interface WaitlistEntry {
  id: string; userId: string | null; phone: string; location: { lat: number; lng: number } | null; localityId: string | null; areaKey: string; createdAt: Date;
}
export interface WaitlistStore {
  ensureIndexes(): Promise<void>;
  /** False when this phone is already waiting for this area. */
  add(entry: WaitlistEntry): Promise<boolean>;
}

export interface DiscoverySettings {
  /** Show products that are sold out (with Notify Me) in lists. */
  showOutOfStockItems: boolean;
  /** The most of one item a customer may add, on top of each offering's own limit. */
  maxQtyPerItem: number | null;
  /** More changed products than this since the customer's last visit and the app reloads everything instead. */
  maxChanges: number;
}
export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = { showOutOfStockItems: true, maxQtyPerItem: null, maxChanges: 500 };
