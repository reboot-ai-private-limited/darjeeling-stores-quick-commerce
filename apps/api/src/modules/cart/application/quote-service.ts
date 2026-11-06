import { AppError, notFound, validation } from "../../catalog/catalog.public.js";
import { haversineMeters } from "../../riders/riders.public.js";
import { allocate, shares } from "../domain/cart.js";
import type { CartDeps, Quote, QuoteDelivery } from "./ports.js";

export interface QuoteInput {
  addressId?: string | null | undefined; couponCode?: string | null | undefined; paymentMethod: "cod" | "online";
  scheduledWindow?: { start: Date; end: Date } | null | undefined; acceptZoneChange: boolean;
}

/** Locks a server-priced bill and ETA for a few minutes. Orders are placed only from a quote. */
export function createQuoteService(deps: CartDeps) {
  const { store, lines, addresses, geography, pricing, travel, customers, hours, settings, now, newId } = deps;

  /** Works out a quote without saving it. Placing an order calls this again to see whether anything changed. */
  async function build(userId: string, input: QuoteInput): Promise<Quote> {
    const cart = await store.getCart(userId);
    if (!cart || cart.items.length === 0) throw validation("Your cart is empty", { field: "cart" });
    const addressId = input.addressId ?? cart.addressId;
    if (!addressId) throw validation("Choose a delivery address first", { field: "addressId" });
    const address = await addresses.forOrder(userId, addressId);
    if (!address) throw notFound("Address");
    if (!address.isDeliverable || !address.zoneId) throw new AppError("OUT_OF_ZONE", "We do not deliver to that address yet");
    const zoneId = address.zoneId;

    // A different zone than the cart was built in needs the customer's yes first.
    const changed = cart.zoneId !== null && cart.zoneId !== zoneId;
    if ((changed || cart.zoneChange) && !input.acceptZoneChange) {
      throw new AppError("ZONE_CHANGE_UNCONFIRMED", "Your cart prices changed for this address. Please confirm.", { zoneChange: cart.zoneChange ?? { fromZoneId: cart.zoneId, toZoneId: zoneId, removed: [], repriced: [] } });
    }

    const zone = await geography.zone(zoneId);
    if (!zone || !zone.isEnabled) throw new AppError("OUT_OF_ZONE", "We do not deliver to that address yet");
    if (zone.isPaused) throw new AppError("ZONE_PAUSED", "Deliveries are paused in this area for now", { message: "Deliveries are paused in this area for now", until: null });
    const at = now();
    const closed = await hours.closedReason(zoneId, at);
    if (closed) {
      throw new AppError(closed.code, closed.message, closed.code === "ZONE_PAUSED"
        ? { message: closed.message, until: closed.until?.toISOString() ?? null }
        : { opensAt: closed.opensAt?.toISOString() ?? null, preOrderAvailable: closed.preOrderAvailable });
    }
    const open = (await geography.warehousesOfZone(zoneId)).filter(w => w.isEnabled && w.isOpenNow);
    if (open.length === 0) throw new AppError("STORE_CLOSED", "We are closed right now", { opensAt: null, preOrderAvailable: false });

    const items = cart.items;
    const resolved = await lines.resolveLines({ zoneId, lines: items });
    const bad = items.flatMap((item, i) => {
      const r = resolved[i]!;
      const cap = Math.min(settings.maxQtyPerItem, r.maxQty ?? settings.maxQtyPerItem);
      return !r.sellable || item.qty > cap ? [{ productId: item.productId, variantId: item.variantId, name: r.name, reason: !r.sellable ? (r.reason ?? "not_sellable") : "max_qty" }] : [];
    });
    if (bad.length > 0) throw new AppError("ITEM_UNAVAILABLE", "Some items are not available", { lines: bad });

    const travelMinutes = new Map<string, number>();
    for (const w of open) travelMinutes.set(w.id, (await travel.minutes(w.location, address.location)) ?? Math.ceil(haversineMeters(w.location, address.location) / 1000 / 15 * 60));
    const openIds = new Set(open.map(w => w.id));
    const allocation = allocate(
      items.map((item, i) => ({ qty: item.qty, available: new Map(resolved[i]!.warehouses.filter(w => openIds.has(w.warehouseId)).map(w => [w.warehouseId, w.availableUnits])) })),
      open.map(w => ({ id: w.id, travelMinutes: travelMinutes.get(w.id)! })), settings.maxSplitsPerOrder,
    );
    if (!allocation.ok) {
      throw new AppError("ITEM_UNAVAILABLE", "These items cannot be delivered together", {
        lines: allocation.uncovered.map(i => ({ productId: items[i]!.productId, variantId: items[i]!.variantId, name: resolved[i]!.name, reason: "cannot_be_supplied_together" })),
      });
    }

    const quoteLines = items.map((item, i) => {
      const r = resolved[i]!;
      return { productId: item.productId, variantId: item.variantId, name: r.name, variantLabel: r.variantLabel, weightGrams: r.weightGrams, qty: item.qty, unitPrice: r.unitPrice!, lineTotal: r.unitPrice! * item.qty };
    });
    const subtotal = quoteLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const minOrder = (await pricing.minOrderFor(zoneId)) ?? settings.defaultMinOrder;
    if (subtotal < minOrder) throw new AppError("MIN_ORDER_NOT_MET", `The minimum order is ₹${minOrder / 100}`, { minOrder });

    const code = input.couponCode === undefined ? cart.couponCode : input.couponCode;
    const coupon = code ? await pricing.check(userId, code, { zoneId, subtotal, warehouseIds: allocation.groups.map(g => g.warehouseId) }) : null;
    const discount = coupon?.discount ?? 0;
    const bill = await pricing.bill({ zoneId, subtotal, discount, freeDelivery: coupon?.freeDelivery ?? false, deliveries: allocation.groups.length });
    const total = subtotal - discount + bill.total;

    const codAllowed = total <= settings.codMaxAmount && (await customers.codAllowed(userId));
    if (input.paymentMethod === "cod" && !codAllowed) throw new AppError("COD_NOT_ALLOWED", "Cash on delivery is not available for this order", { codMaxAmount: settings.codMaxAmount });

    const itemShare = allocation.groups.map(g => g.lines.reduce((sum, i) => sum + quoteLines[i]!.lineTotal, 0));
    const discountShares = shares(discount, itemShare);
    const chargeShares = bill.charges.map(c => shares(c.amount, itemShare));
    const deliveries: QuoteDelivery[] = [];
    for (const [g, group] of allocation.groups.entries()) {
      const warehouse = open.find(w => w.id === group.warehouseId)!;
      const eta = { packMinutes: settings.packMinutes, riderArrivalMinutes: settings.riderArrivalMinutes, travelMinutes: travelMinutes.get(group.warehouseId)!, extraMinutes: bill.extraMinutes };
      const minutes = eta.packMinutes + eta.riderArrivalMinutes + eta.travelMinutes + eta.extraMinutes;
      deliveries.push({
        warehouseId: group.warehouseId, warehouseName: warehouse.name, lines: group.lines.map(i => quoteLines[i]!), itemsSubtotal: itemShare[g]!,
        eta: { ...eta, promisedAt: new Date(at.getTime() + minutes * 60_000) },
        allocatedDiscount: discountShares[g]!, allocatedCharges: bill.charges.map((c, k) => ({ type: c.type, label: c.label, amount: chargeShares[k]![g]! })),
      });
    }
    return {
      id: newId(), userId, addressId: address.id, zoneId, split: deliveries.length > 1, allocation: deliveries,
      pricing: { subtotal, discount, charges: bill.charges, tax: 0, total, taxInclusive: settings.taxInclusive },
      payment: { codAllowed, codMaxAmount: settings.codMaxAmount, onlineAllowed: true },
      scheduledWindow: input.scheduledWindow ?? null, couponCode: coupon?.coupon.code ?? null, couponId: coupon?.coupon.id ?? null, paymentMethod: input.paymentMethod,
      expiresAt: new Date(at.getTime() + settings.quoteValiditySeconds * 1000), createdAt: at, usedByGroupId: null,
    };
  }

  const view = (q: Quote) => ({
    id: q.id, expiresAt: q.expiresAt.toISOString(), zoneId: q.zoneId, split: q.split,
    allocation: q.allocation.map(d => ({
      warehouseId: d.warehouseId, warehouseName: d.warehouseName,
      lines: d.lines.map(l => ({ productId: l.productId, variantId: l.variantId, name: l.name, variantLabel: l.variantLabel, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      itemsSubtotal: d.itemsSubtotal, eta: { ...d.eta, promisedAt: d.eta.promisedAt.toISOString() },
    })),
    pricing: { subtotal: q.pricing.subtotal, discount: q.pricing.discount, charges: q.pricing.charges.map(c => ({ type: c.type, label: c.label, amount: c.amount })), tax: q.pricing.tax, total: q.pricing.total, taxInclusive: q.pricing.taxInclusive },
    payment: q.payment, scheduledWindow: q.scheduledWindow ? { start: q.scheduledWindow.start.toISOString(), end: q.scheduledWindow.end.toISOString() } : null,
  });

  return {
    build, view,

    async create(userId: string, input: QuoteInput) {
      const quote = await build(userId, input);
      await store.insertQuote(quote);
      // The zone change is confirmed and the cart now belongs to the new zone.
      const cart = await store.getCart(userId);
      if (cart && (cart.zoneChange || cart.zoneId !== quote.zoneId)) await store.saveCart({ ...cart, zoneId: quote.zoneId, addressId: quote.addressId, zoneChange: null, updatedAt: now() });
      return view(quote);
    },

    /** A quote that is the customer's and still valid; 404 for anyone else's, 410 once it has expired. */
    async get(userId: string, id: string): Promise<Quote> {
      const quote = await store.getQuote(id);
      if (!quote || quote.userId !== userId) throw notFound("Quote");
      if (quote.expiresAt.getTime() <= now().getTime()) throw new AppError("QUOTE_EXPIRED", "This quote has expired. Please request a new one.");
      return quote;
    },
    async read(userId: string, id: string) { return view(await this.get(userId, id)); },
  };
}

export type QuoteService = ReturnType<typeof createQuoteService>;
