import { assertWarehouseScope, conflict, forbidden, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { CHANNELS, deepLinkFor, type Channel, type Subscription } from "../domain/subscription.js";
import { DuplicateSubscriptionError, type AvailabilityDeps } from "./ports.js";

const DEMAND_LIMIT = 500;
const PAGE = 200;

export interface SubscribeInput { zoneId: string; productId: string; variantId: string | null; channels: Channel[] }

const view = (s: Subscription) => ({
  id: s.id, zoneId: s.zoneId, productId: s.productId, variantId: s.variantId, channels: s.channels, status: s.status, createdAt: s.createdAt.toISOString(),
});

/** Back-in-stock alerts (F07). */
export function createNotifyService(deps: AvailabilityDeps) {
  const { store, zones, products, warehouses, now, newId } = deps;

  return {
    async subscribe(userId: string, input: SubscribeInput) {
      const [product] = await products.getMany([input.productId]);
      if (!product || product.status !== "active") throw notFound("Product");
      if (input.variantId !== null && !product.variants.some(v => v.id === input.variantId && v.isActive)) throw notFound("Variant");
      const stock = await zones.check(input.zoneId, input.productId);
      if (!stock.sold) throw notFound("Product");
      const inStock = input.variantId !== null ? (stock.unitsByVariant[input.variantId] ?? 0) > 0 : Object.values(stock.unitsByVariant).some(units => units > 0);
      if (inStock) throw validation("This item is in stock. Add it to the cart instead.", { reason: "in_stock" });

      const existing = await store.findWaiting(userId, input.zoneId, input.productId, input.variantId);
      if (existing) throw conflict("You are already waiting for this item", { subscription: view(existing) });
      const at = now();
      const subscription: Subscription = {
        id: newId(), userId, zoneId: input.zoneId, productId: input.productId, variantId: input.variantId,
        channels: CHANNELS.filter(c => input.channels.includes(c)), status: "waiting", notifiedAt: null, cancelledAt: null, createdAt: at, updatedAt: at,
      };
      try { await store.insert(subscription); }
      catch (error) {
        if (!(error instanceof DuplicateSubscriptionError)) throw error;
        const winner = await store.findWaiting(userId, input.zoneId, input.productId, input.variantId);
        throw conflict("You are already waiting for this item", winner ? { subscription: view(winner) } : undefined);
      }
      return view(subscription);
    },

    async listMine(userId: string) {
      const waiting = await store.listWaitingForUser(userId);
      const info = new Map((await products.getMany([...new Set(waiting.map(s => s.productId))])).map(p => [p.id, p]));
      return waiting.map(s => {
        const product = info.get(s.productId);
        return {
          id: s.id, zoneId: s.zoneId, productId: s.productId, variantId: s.variantId, name: product?.name ?? "",
          variantLabel: s.variantId === null ? null : product?.variants.find(v => v.id === s.variantId)?.label ?? null,
          channels: s.channels, status: s.status, createdAt: s.createdAt.toISOString(),
        };
      });
    },

    /** Only the customer's own subscription can be cancelled. Cancelling twice, or after a notification, changes nothing. */
    async cancel(userId: string, id: string): Promise<void> {
      if ((await store.cancel(userId, id, now())) === "missing") throw notFound("Subscription");
    },

    /** Who is waiting for what, most wanted first. Scoped staff see only the zones of their warehouses. */
    async demand(ctx: Ctx, filters: { zoneId?: string | undefined; warehouseId?: string | undefined }) {
      let allowed: Set<string> | null = null;
      if (!ctx.actor.scope.all) {
        allowed = new Set();
        for (const id of ctx.actor.scope.warehouseIds) { const w = await warehouses.get(id); if (w) allowed.add(w.zoneId); }
      }
      let wanted: Set<string> | null = allowed;
      if (filters.warehouseId !== undefined) {
        assertWarehouseScope(ctx.actor, filters.warehouseId);
        const warehouse = await warehouses.get(filters.warehouseId);
        if (!warehouse) throw notFound("Warehouse");
        wanted = new Set([warehouse.zoneId]);
      }
      if (filters.zoneId !== undefined) {
        if (allowed && !allowed.has(filters.zoneId)) throw forbidden("This zone is outside your scope");
        wanted = wanted && !wanted.has(filters.zoneId) ? new Set() : new Set([filters.zoneId]);
      }
      if (wanted && wanted.size === 0) return [];
      const rows = await store.demand(wanted ? [...wanted] : null, DEMAND_LIMIT);
      const info = new Map((await products.getMany([...new Set(rows.map(r => r.productId))])).map(p => [p.id, p]));
      return rows.map(r => {
        const product = info.get(r.productId);
        return {
          zoneId: r.zoneId, productId: r.productId, name: product?.name ?? "", variantId: r.variantId,
          variantLabel: r.variantId === null ? null : product?.variants.find(v => v.id === r.variantId)?.label ?? null,
          waiting: r.waiting, oldestRequestAt: r.oldestRequestAt.toISOString(),
        };
      });
    },

    /**
     * An item went from sold out to available in a whole zone (the `stock.zone_availability_changed` event).
     * Each waiting customer for that size, or for any size, is marked notified and gets a message queued in the same
     * transaction, so a repeated event cannot message anyone twice.
     */
    async onZoneAvailabilityChanged(event: { zoneId: string; productId: string; variantId: string }): Promise<{ notified: number }> {
      const [product] = await products.getMany([event.productId]);
      if (!product || product.status !== "active") return { notified: 0 };
      let notified = 0;
      for (let afterId: string | undefined; ;) {
        const page = await store.listWaitingForItem({
          zoneId: event.zoneId, productId: event.productId, variantIds: [event.variantId, null], limit: PAGE, ...(afterId !== undefined && { afterId }),
        });
        if (page.length === 0) break;
        for (const subscription of page) {
          const variantLabel = subscription.variantId === null ? null : product.variants.find(v => v.id === subscription.variantId)?.label ?? null;
          const claimed = await store.claimForNotification(subscription, {
            subscriptionId: subscription.id, userId: subscription.userId, zoneId: subscription.zoneId, productId: subscription.productId,
            variantId: subscription.variantId, productName: product.name, variantLabel, imageMediaId: product.imageMediaId,
            channels: subscription.channels, deepLink: deepLinkFor(subscription.productId),
          }, now());
          if (claimed) notified++;
        }
        afterId = page[page.length - 1]!.id;
        if (page.length < PAGE) break;
      }
      return { notified };
    },

    /** For the notifications job (F23): queued messages not yet delivered, oldest first. */
    pendingMessages(limit = 100) { return store.pendingMessages(limit); },
    markDelivered(subscriptionId: string) { return store.markDelivered(subscriptionId, now()); },
    markFailed(subscriptionId: string, error: string) { return store.markFailed(subscriptionId, error, now()); },
  };
}

export type NotifyService = ReturnType<typeof createNotifyService>;
