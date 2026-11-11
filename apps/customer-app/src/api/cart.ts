import type { Correction, Line, ServerLine } from "../state/cart";
import { api } from "./http";

export type ServerCart = {
  zoneId: string; addressId?: string | null; couponCode: string | null; clientRev: number;
  items: { productId: string; variantId: string; qty: number; unitPrice: number; lineTotal: number; maxQty: number; available: boolean }[];
  itemsSubtotal: number;
  freeDelivery: { threshold: number; remaining: number } | null;
};
export type CartResult = { cart: ServerCart; corrections: Correction[]; zoneChange: unknown };

/** The server caps clientRev at 2,000,000,000, so count from the current time in seconds (and keep counting up). */
let rev = Math.floor(Date.now() / 1000);
/** Sends the whole cart; the server prices it and trims what it can't sell. Needs a signed-in customer. */
export const syncCart = (lines: Line[], addressId?: string | null) =>
  api<CartResult>("PUT", "/cart", { clientRev: ++rev, ...(addressId ? { addressId } : {}), items: lines.map(l => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })) }).then(r => r.data);

export const toServerLines = (cart: ServerCart): ServerLine[] => cart.items.map(i => ({ variantId: i.variantId, unitPrice: i.unitPrice, maxQty: i.maxQty, available: i.available }));

export type StoreStatus = {
  accepting: boolean; open: boolean; paused: boolean; pauseMessage: string | null; opensAt: string | null; preOrderAvailable?: boolean;
  eta: { minMinutes: number; maxMinutes: number }; minOrder: number; freeDeliveryAbove: number | null; smallOrderFee: number;
  notices: { type: string; label: string }[];
};
export const getStoreStatus = (zoneId: string) => api<StoreStatus>("GET", `/store/status?zoneId=${zoneId}`, undefined, { auth: false }).then(r => r.data);

export const REASONS: Record<string, string> = {
  out_of_stock: "is out of stock and was removed",
  max_qty: "was reduced to the most you can order",
  price_changed: "has a new price",
  not_sold_in_zone: "isn't available in your area and was removed",
};
