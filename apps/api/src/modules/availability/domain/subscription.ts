export type Channel = "push" | "whatsapp";
export const CHANNELS: readonly Channel[] = ["push", "whatsapp"];
export type SubscriptionStatus = "waiting" | "notified" | "cancelled";

/** One customer waiting for one item (or any size of it) to come back in stock in one zone. */
export interface Subscription {
  id: string; userId: string; zoneId: string; productId: string;
  /** `null` means any size. */
  variantId: string | null; channels: Channel[]; status: SubscriptionStatus;
  notifiedAt: Date | null; cancelledAt: Date | null; createdAt: Date; updatedAt: Date;
}

/** What the notifications module (F23) needs to tell the customer. */
export interface BackInStockMessage {
  subscriptionId: string; userId: string; zoneId: string; productId: string; variantId: string | null;
  productName: string; variantLabel: string | null; imageMediaId: string | null; channels: Channel[];
  /** The apps open `product/<productId>`. */
  deepLink: string;
}

export interface OutboxEntry {
  subscriptionId: string; message: BackInStockMessage; status: "pending" | "delivered";
  attempts: number; lastError: string | null; createdAt: Date; updatedAt: Date;
}

export interface DemandRow { zoneId: string; productId: string; variantId: string | null; waiting: number; oldestRequestAt: Date }

export const deepLinkFor = (productId: string) => `product/${productId}`;
