import { AppError, notFound, validation } from "../../catalog/catalog.public.js";
import { mergeItems, type Cart, type CartItem, type Correction, type ZoneChange } from "../domain/cart.js";
import type { CartDeps } from "./ports.js";

export interface CartInput { clientRev: number; addressId?: string | null | undefined; zoneId?: string | null | undefined; items: CartItem[] }

/** The server cart: lines are priced live, never stored with a price. */
export function createCartService(deps: CartDeps) {
  const { store, lines, addresses, geography, pricing, settings, now } = deps;

  async function view(cart: Cart | null) {
    const items = cart?.items ?? [];
    const zoneId = cart?.zoneId ?? null;
    const resolved = zoneId && items.length > 0 ? await lines.resolveLines({ zoneId, lines: items }) : [];
    const priced = items.map((item, i) => {
      const r = resolved[i];
      const unitPrice = r?.sellable ? r.unitPrice : null;
      return {
        productId: item.productId, variantId: item.variantId, qty: item.qty, name: r?.name ?? "", variantLabel: r?.variantLabel ?? "",
        unitPrice, lineTotal: unitPrice === null ? null : unitPrice * item.qty,
        maxQty: r ? Math.min(settings.maxQtyPerItem, r.maxQty ?? settings.maxQtyPerItem) : settings.maxQtyPerItem,
        available: Boolean(r?.sellable && (r.warehouses.some(w => w.availableUnits >= item.qty))), imageUrl: null as string | null,
      };
    });
    const itemsSubtotal = priced.reduce((sum, p) => sum + (p.lineTotal ?? 0), 0);
    const threshold = zoneId ? await pricing.freeDeliveryThreshold(zoneId) : null;
    return {
      zoneId, addressId: cart?.addressId ?? null, couponCode: cart?.couponCode ?? null, clientRev: cart?.clientRev ?? 0, items: priced, itemsSubtotal,
      freeDelivery: threshold === null ? null : { threshold, remaining: Math.max(0, threshold - itemsSubtotal) },
    };
  }
  const empty = (userId: string): Cart => ({ userId, zoneId: null, addressId: null, couponCode: null, clientRev: 0, items: [], zoneChange: null, updatedAt: now(), reminderSentAt: null });

  return {
    view,

    async get(userId: string) {
      const cart = await store.getCart(userId);
      return { cart: await view(cart), corrections: [] as Correction[], zoneChange: cart?.zoneChange ?? null };
    },

    /** Replaces the whole cart from the device. Lines the server cannot honour are trimmed and reported. */
    async put(userId: string, input: CartInput) {
      const current = await store.getCart(userId);
      // An older copy from a slow phone never overwrites a newer one.
      if (current && input.clientRev < current.clientRev) return { cart: await view(current), corrections: [] as Correction[], zoneChange: current.zoneChange, stale: true as const };

      let zoneId = current?.zoneId ?? null;
      let addressId = current?.addressId ?? null;
      if (input.addressId) {
        const address = await addresses.forOrder(userId, input.addressId);
        if (!address) throw notFound("Address");
        if (!address.isDeliverable || !address.zoneId) throw new AppError("OUT_OF_ZONE", "We do not deliver to that address yet");
        zoneId = address.zoneId; addressId = address.id;
      } else if (input.zoneId) {
        if (!(await geography.zone(input.zoneId))) throw validation("That zone does not exist", { field: "zoneId" });
        zoneId = input.zoneId;
      }
      if (!zoneId) throw validation("Choose a delivery address first", { field: "addressId" });

      const wanted = mergeItems(input.items);
      if (wanted.length > settings.maxItemsPerOrder) throw validation(`A cart holds at most ${settings.maxItemsPerOrder} different items`, { field: "items" });
      const resolved = wanted.length > 0 ? await lines.resolveLines({ zoneId, lines: wanted }) : [];

      const corrections: Correction[] = [];
      const kept: CartItem[] = [];
      wanted.forEach((item, i) => {
        const r = resolved[i]!;
        if (!r.sellable) { corrections.push({ productId: item.productId, variantId: item.variantId, reason: r.reason === "not_sold_in_zone" ? "not_sold_in_zone" : "out_of_stock", qty: 0 }); return; }
        const cap = Math.min(settings.maxQtyPerItem, r.maxQty ?? settings.maxQtyPerItem);
        const stock = Math.max(...r.warehouses.map(w => w.availableUnits), 0);
        let qty = item.qty;
        if (qty > cap) { qty = cap; corrections.push({ productId: item.productId, variantId: item.variantId, reason: "max_qty", qty }); }
        if (qty > stock) { qty = stock; corrections.push({ productId: item.productId, variantId: item.variantId, reason: "out_of_stock", qty }); }
        if (qty > 0) kept.push({ productId: item.productId, variantId: item.variantId, qty });
      });

      // The address is in another zone than the cart was built in: every line is priced again there, and the customer must confirm.
      let zoneChange: ZoneChange | null = current?.zoneChange ?? null;
      if (current?.zoneId && current.zoneId !== zoneId && wanted.length > 0) {
        const before = await lines.resolveLines({ zoneId: current.zoneId, lines: wanted });
        zoneChange = {
          fromZoneId: current.zoneId, toZoneId: zoneId,
          removed: wanted.flatMap((w, i) => (!resolved[i]!.sellable ? [{ productId: w.productId, variantId: w.variantId, name: resolved[i]!.name || before[i]!.name, reason: "not_sold_in_zone" as const }] : [])),
          repriced: wanted.flatMap((w, i) => {
            const was = before[i]!.unitPrice; const now_ = resolved[i]!.unitPrice;
            return resolved[i]!.sellable && was !== null && now_ !== null && was !== now_ ? [{ productId: w.productId, variantId: w.variantId, oldUnitPrice: was, newUnitPrice: now_ }] : [];
          }),
        };
      } else if (current?.zoneId === zoneId && !current.zoneChange) zoneChange = null;
      else if (current?.zoneId && current.zoneId !== zoneId && wanted.length === 0) zoneChange = null;

      const cart: Cart = { ...(current ?? empty(userId)), zoneId, addressId, clientRev: input.clientRev, items: kept, zoneChange, updatedAt: now() };
      await store.saveCart(cart);
      return { cart: await view(cart), corrections, zoneChange };
    },

    async applyCoupon(userId: string, code: string) {
      const cart = await store.getCart(userId);
      if (!cart?.zoneId || cart.items.length === 0) throw validation("Add items to the cart first", { field: "code" });
      const shown = await view(cart);
      const checked = await pricing.check(userId, code, { zoneId: cart.zoneId, subtotal: shown.itemsSubtotal });
      const next = { ...cart, couponCode: checked.coupon.code, updatedAt: now() };
      await store.saveCart(next);
      return { cart: await view(next), coupon: { code: checked.coupon.code, type: checked.coupon.type, description: checked.description } };
    },

    async removeCoupon(userId: string) {
      const cart = await store.getCart(userId);
      if (!cart) return { cart: await view(null) };
      const next = { ...cart, couponCode: null, updatedAt: now() };
      await store.saveCart(next);
      return { cart: await view(next) };
    },

    /** Replaces the lines with those of a past order, at today's prices and stock. Nothing is ordered. */
    async reorder(userId: string, items: CartItem[]) {
      const current = await store.getCart(userId);
      if (!current?.zoneId) throw validation("Choose a delivery address first", { field: "addressId" });
      return this.put(userId, { clientRev: (current.clientRev ?? 0) + 1, items: mergeItems([...current.items, ...items]) });
    },
  };
}

export type CartService = ReturnType<typeof createCartService>;
