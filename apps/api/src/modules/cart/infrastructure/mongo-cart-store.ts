import type { Connection } from "mongoose";
import type { Cart } from "../domain/cart.js";
import type { CartStore, Quote } from "../application/ports.js";

type CartDoc = Omit<Cart, "userId"> & { _id: string };
type QuoteDoc = Omit<Quote, "id"> & { _id: string };

export function createMongoCartStore(connection: Connection): CartStore {
  const carts = () => connection.collection<CartDoc>("carts");
  const quotes = () => connection.collection<QuoteDoc>("quotes");
  return {
    async ensureIndexes() {
      // Quotes are kept a day after they expire so a late order can be told the quote has expired, then removed.
      await quotes().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });
      await quotes().createIndex({ userId: 1, createdAt: -1 });
      await carts().createIndex({ updatedAt: 1 });
    },
    async getCart(userId) { const doc = await carts().findOne({ _id: userId }); if (!doc) return null; const { _id, ...rest } = doc; return { userId: _id, ...rest }; },
    async saveCart(cart) { const { userId, ...rest } = cart; await carts().replaceOne({ _id: userId }, rest as never, { upsert: true }); },
    async clearCart(userId) { await carts().deleteOne({ _id: userId }); },
    async insertQuote(quote) { const { id, ...rest } = quote; await quotes().insertOne({ _id: id, ...rest }); },
    async getQuote(id) { const doc = await quotes().findOne({ _id: id }); if (!doc) return null; const { _id, ...rest } = doc; return { id: _id, ...rest }; },
    async claimQuote(id, groupId) {
      await quotes().updateOne({ _id: id, usedByGroupId: null }, { $set: { usedByGroupId: groupId } });
      return (await quotes().findOne({ _id: id }))?.usedByGroupId ?? groupId;
    },
  };
}
