import type { Connection } from "mongoose";
import { DuplicateSubscriptionError, type SubscriptionStore } from "../application/ports.js";
import type { BackInStockMessage, DemandRow, OutboxEntry, Subscription } from "../domain/subscription.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules.
type SubscriptionDoc = Omit<Subscription, "id"> & { _id: string };
type OutboxDoc = Omit<OutboxEntry, "subscriptionId"> & { _id: string };

const toSubscription = ({ _id, ...rest }: SubscriptionDoc): Subscription => ({ id: _id, ...rest });
const toSubscriptionDoc = ({ id, ...rest }: Subscription): SubscriptionDoc => ({ _id: id, ...rest });
const toOutbox = ({ _id, ...rest }: OutboxDoc): OutboxEntry => ({ subscriptionId: _id, ...rest });

export function createMongoSubscriptionStore(connection: Connection): SubscriptionStore {
  const subscriptions = () => connection.collection<SubscriptionDoc>("stock_subscriptions");
  const outbox = () => connection.collection<OutboxDoc>("back_in_stock_outbox");

  return {
    async ensureIndexes() {
      // One waiting subscription per customer, zone, product and size; closed ones do not count.
      await subscriptions().createIndex({ userId: 1, zoneId: 1, productId: 1, variantId: 1 }, { unique: true, partialFilterExpression: { status: "waiting" } });
      await subscriptions().createIndex({ zoneId: 1, productId: 1, status: 1 });
      await subscriptions().createIndex({ userId: 1, status: 1 });
      await outbox().createIndex({ status: 1, createdAt: 1 });
    },

    async insert(subscription) {
      try { await subscriptions().insertOne(toSubscriptionDoc(subscription)); }
      catch (error) { if ((error as { code?: number } | null)?.code === 11000) throw new DuplicateSubscriptionError(); throw error; }
    },

    async findWaiting(userId, zoneId, productId, variantId) {
      const doc = await subscriptions().findOne({ userId, zoneId, productId, variantId, status: "waiting" });
      return doc ? toSubscription(doc) : null;
    },

    async listWaitingForUser(userId) {
      return (await subscriptions().find({ userId, status: "waiting" }).sort({ createdAt: -1, _id: -1 }).limit(200).toArray()).map(toSubscription);
    },

    async cancel(userId, id, at) {
      const done = await subscriptions().updateOne({ _id: id, userId, status: "waiting" }, { $set: { status: "cancelled", cancelledAt: at, updatedAt: at } });
      if (done.modifiedCount === 1) return "cancelled";
      return (await subscriptions().countDocuments({ _id: id, userId }, { limit: 1 })) > 0 ? "unchanged" : "missing";
    },

    async demand(zoneIds, limit): Promise<DemandRow[]> {
      const rows = await subscriptions().aggregate<{ _id: { zoneId: string; productId: string; variantId: string | null }; waiting: number; oldest: Date }>([
        { $match: { status: "waiting", ...(zoneIds ? { zoneId: { $in: [...zoneIds] } } : {}) } },
        { $group: { _id: { zoneId: "$zoneId", productId: "$productId", variantId: "$variantId" }, waiting: { $sum: 1 }, oldest: { $min: "$createdAt" } } },
        { $sort: { waiting: -1, oldest: 1 } },
        { $limit: limit },
      ]).toArray();
      return rows.map(r => ({ zoneId: r._id.zoneId, productId: r._id.productId, variantId: r._id.variantId ?? null, waiting: r.waiting, oldestRequestAt: r.oldest }));
    },

    async listWaitingForItem({ zoneId, productId, variantIds, afterId, limit }) {
      const filter = { zoneId, productId, status: "waiting" as const, variantId: { $in: [...variantIds] }, ...(afterId !== undefined && { _id: { $gt: afterId } }) };
      return (await subscriptions().find(filter).sort({ _id: 1 }).limit(limit).toArray()).map(toSubscription);
    },

    async claimForNotification(subscription: Subscription, message: BackInStockMessage, at: Date) {
      const session = await connection.startSession();
      try {
        let claimed = false;
        await session.withTransaction(async () => {
          const done = await subscriptions().updateOne(
            { _id: subscription.id, status: "waiting" }, { $set: { status: "notified", notifiedAt: at, updatedAt: at } }, { session },
          );
          claimed = done.modifiedCount === 1;
          if (claimed) await outbox().insertOne({ _id: subscription.id, message, status: "pending", attempts: 0, lastError: null, createdAt: at, updatedAt: at }, { session });
        });
        return claimed;
      } finally { await session.endSession(); }
    },

    async pendingMessages(limit) {
      return (await outbox().find({ status: "pending" }).sort({ createdAt: 1, _id: 1 }).limit(limit).toArray()).map(toOutbox);
    },
    async markDelivered(subscriptionId, at) {
      await outbox().updateOne({ _id: subscriptionId }, { $set: { status: "delivered", updatedAt: at }, $inc: { attempts: 1 } });
    },
    async markFailed(subscriptionId, error, at) {
      await outbox().updateOne({ _id: subscriptionId }, { $set: { status: "pending", lastError: error.slice(0, 500), updatedAt: at }, $inc: { attempts: 1 } });
    },
  };
}
