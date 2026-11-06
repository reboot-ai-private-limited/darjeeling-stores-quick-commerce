import type { BackInStockMessage, DemandRow, OutboxEntry, Subscription } from "../domain/subscription.js";

export class DuplicateSubscriptionError extends Error { constructor() { super("Already waiting for this item"); this.name = "DuplicateSubscriptionError"; } }

export interface SubscriptionStore {
  ensureIndexes(): Promise<void>;
  /** Throws DuplicateSubscriptionError when the customer is already waiting for the same zone, product and size. */
  insert(subscription: Subscription): Promise<void>;
  findWaiting(userId: string, zoneId: string, productId: string, variantId: string | null): Promise<Subscription | null>;
  listWaitingForUser(userId: string): Promise<Subscription[]>;
  /** `unchanged` when the subscription is the customer's but no longer waiting. */
  cancel(userId: string, id: string, at: Date): Promise<"cancelled" | "unchanged" | "missing">;
  demand(zoneIds: readonly string[] | null, limit: number): Promise<DemandRow[]>;
  /** Waiting subscriptions for an item, in id order, for the given sizes (`null` = subscribed to any size). */
  listWaitingForItem(query: { zoneId: string; productId: string; variantIds: readonly (string | null)[]; afterId?: string; limit: number }): Promise<Subscription[]>;
  /** Marks the subscription `notified` and queues its message in one transaction. False when someone else got there first. */
  claimForNotification(subscription: Subscription, message: BackInStockMessage, at: Date): Promise<boolean>;
  pendingMessages(limit: number): Promise<OutboxEntry[]>;
  markDelivered(subscriptionId: string, at: Date): Promise<void>;
  markFailed(subscriptionId: string, error: string, at: Date): Promise<void>;
}

export interface ZoneAvailabilityPort { check(zoneId: string, productId: string): Promise<{ sold: boolean; unitsByVariant: Record<string, number> }> }
export interface ProductLookup {
  getMany(ids: readonly string[]): Promise<{
    id: string; name: string; status: "active" | "inactive" | "archived"; imageMediaId: string | null;
    variants: { id: string; label: string; isActive: boolean }[];
  }[]>;
}
export interface WarehouseZones { get(warehouseId: string): Promise<{ zoneId: string } | null> }

export interface AvailabilityDeps {
  store: SubscriptionStore; zones: ZoneAvailabilityPort; products: ProductLookup; warehouses: WarehouseZones;
  now: () => Date; newId: () => string;
}
