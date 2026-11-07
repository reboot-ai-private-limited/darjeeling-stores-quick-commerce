import type { Geography } from "../../../platform/geography.js";
import type { SettingsProvider } from "../../../platform/settings.js";
import type { Cart } from "../domain/cart.js";

export interface QuoteLine { productId: string; variantId: string; name: string; variantLabel: string; weightGrams: number; qty: number; unitPrice: number; lineTotal: number }
export interface QuoteCharge { type: string; label: string; amount: number; ruleId: string }
export interface QuoteDelivery {
  warehouseId: string; warehouseName: string; lines: QuoteLine[]; itemsSubtotal: number;
  eta: { packMinutes: number; riderArrivalMinutes: number; travelMinutes: number; extraMinutes: number; promisedAt: Date };
  /** This delivery's pro-rata share of the discount and of each charge, for refunds and invoices. They add up to the group totals. */
  allocatedDiscount: number; allocatedCharges: { type: string; label: string; amount: number }[];
}
export interface Quote {
  id: string; userId: string; addressId: string; zoneId: string; split: boolean; allocation: QuoteDelivery[];
  pricing: { subtotal: number; discount: number; charges: QuoteCharge[]; tax: number; total: number; taxInclusive: boolean };
  payment: { codAllowed: boolean; codMaxAmount: number; onlineAllowed: boolean };
  scheduledWindow: { start: Date; end: Date } | null; couponCode: string | null; couponId: string | null; paymentMethod: "cod" | "online";
  expiresAt: Date; createdAt: Date; usedByGroupId: string | null;
}

export interface CartStore {
  ensureIndexes(): Promise<void>;
  getCart(userId: string): Promise<Cart | null>;
  saveCart(cart: Cart): Promise<void>;
  clearCart(userId: string): Promise<void>;
  insertQuote(quote: Quote): Promise<void>;
  getQuote(id: string): Promise<Quote | null>;
  /** Marks the quote used by an order group, once. Returns the group that holds it (this one, or an earlier one). */
  claimQuote(id: string, groupId: string): Promise<string>;
}

export interface LineSource {
  resolveLines(input: { zoneId: string; lines: readonly { productId: string; variantId: string; qty: number }[] }): Promise<{
    productId: string; variantId: string; name: string; variantLabel: string; weightGrams: number; qty: number; unitPrice: number | null; maxQty: number | null; sellable: boolean;
    reason: "not_sold_in_zone" | "not_sellable" | null; warehouses: { warehouseId: string; availableUnits: number }[];
  }[]>;
}
export interface AddressSource {
  forOrder(userId: string, addressId: string): Promise<{ id: string; zoneId: string | null; isDeliverable: boolean; location: { lat: number; lng: number } } | null>;
}
export interface PricingSource {
  bill(input: { zoneId: string; subtotal: number; discount: number; freeDelivery?: boolean; deliveries?: number }): Promise<{
    charges: QuoteCharge[]; extraMinutes: number; total: number; feeShares: number[];
  }>;
  check(userId: string, code: string, ctx: { zoneId: string; subtotal: number; warehouseIds?: readonly string[] }): Promise<{
    coupon: { id: string; code: string; type: string }; discount: number; freeDelivery: boolean; description: string;
  }>;
  minOrderFor(zoneId: string): Promise<number | null>;
  freeDeliveryThreshold(zoneId: string): Promise<number | null>;
}
export interface TravelTime { minutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<number | null> }
/** Whether this customer may pay cash on delivery (a blocked or flagged account may not). */
export interface CustomerPolicy { codAllowed(userId: string): Promise<boolean> }
/** Hours and pre-order rules (F17). Without them a zone is open whenever one of its warehouses is open now. */
export interface HoursSource {
  /** Why orders cannot be taken at the moment, or null when they can. */
  closedReason(zoneId: string, at: Date): Promise<null | { code: "STORE_CLOSED" | "ZONE_PAUSED"; message: string; opensAt: Date | null; until: Date | null; preOrderAvailable: boolean }>;
  /** The warehouses that can supply a pre-order window. Throws when the zone is open, the slot is full or its booking time has passed. */
  forWindow(zoneId: string, window: { start: Date; end: Date }, at: Date): Promise<string[]>;
}

export interface CartSettings {
  quoteValiditySeconds: number; maxItemsPerOrder: number; maxQtyPerItem: number; maxSplitsPerOrder: number;
  packMinutes: number; riderArrivalMinutes: number; codMaxAmount: number; defaultMinOrder: number; taxInclusive: boolean;
  /** Rider tips added at checkout (paise). `tipPresets` are the quick amounts; `tipMaxAmount` is the most allowed. */
  tipsEnabled: boolean; tipMaxAmount: number; tipPresets: number[];
}
export const DEFAULT_CART_SETTINGS: CartSettings = {
  quoteValiditySeconds: 300, maxItemsPerOrder: 40, maxQtyPerItem: 10, maxSplitsPerOrder: 2, packMinutes: 5, riderArrivalMinutes: 5, codMaxAmount: 200_000, defaultMinOrder: 0, taxInclusive: true,
  tipsEnabled: true, tipMaxAmount: 20_000, tipPresets: [1000, 2000, 5000],
};

export interface CartDeps {
  store: CartStore; lines: LineSource; addresses: AddressSource; geography: Geography; pricing: PricingSource; travel: TravelTime; customers: CustomerPolicy;
  hours: HoursSource; settings: SettingsProvider<CartSettings>; now: () => Date; newId: () => string;
}
