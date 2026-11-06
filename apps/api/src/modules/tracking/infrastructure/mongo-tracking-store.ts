import type { Connection } from "mongoose";
import type { StoredEta, StoredPoint, TrackingStore } from "../application/ports.js";

interface PointDoc extends StoredPoint { receivedAt: Date }
interface EtaDoc { _id: string; riderId: string; minutes: number; etaAt: Date; updatedAt: Date }

export function createMongoTrackingStore(connection: Connection): TrackingStore {
  const points = () => connection.collection<PointDoc>("rider_locations");
  const etas = () => connection.collection<EtaDoc>("order_etas");
  const revoked = () => connection.collection<{ _id: string; at: Date }>("tracking_revoked");
  return {
    async ensureIndexes() {
      await points().createIndex({ riderId: 1, at: -1 }, { unique: true });
      // Position history is kept for 30 days.
      await points().createIndex({ receivedAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
      await etas().createIndex({ riderId: 1 });
    },
    async insertPoints(list) {
      if (list.length === 0) return 0;
      const receivedAt = new Date();
      try {
        const result = await points().insertMany(list.map(p => ({ ...p, receivedAt })), { ordered: false });
        return result.insertedCount;
      } catch (error) {
        // A replayed point is skipped; the rest of the batch is still kept.
        const e = error as { code?: number; result?: { insertedCount?: number }; insertedCount?: number; writeErrors?: { code?: number }[] };
        const only11000 = (e.writeErrors ?? []).every(w => w.code === 11000) && (e.writeErrors?.length ?? 0) > 0;
        if (e.code === 11000 || only11000) return e.result?.insertedCount ?? e.insertedCount ?? 0;
        throw error;
      }
    },
    async recentPoints(riderId, limit) {
      return (await points().find({ riderId }).sort({ at: -1 }).limit(limit).toArray()).map(({ receivedAt: _r, ...p }) => { const { _id: _i, ...rest } = p as typeof p & { _id?: unknown }; return rest; });
    },
    async getEta(orderId) {
      const doc = await etas().findOne({ _id: orderId });
      return doc ? { orderId, riderId: doc.riderId, minutes: doc.minutes, etaAt: doc.etaAt, updatedAt: doc.updatedAt } : null;
    },
    async saveEta(eta: StoredEta) {
      await etas().updateOne({ _id: eta.orderId }, { $set: { riderId: eta.riderId, minutes: eta.minutes, etaAt: eta.etaAt, updatedAt: eta.updatedAt } }, { upsert: true });
    },
    async clearEta(orderId) { await etas().deleteOne({ _id: orderId }); },
    async revoke(orderId, at) { await revoked().updateOne({ _id: orderId }, { $setOnInsert: { at } }, { upsert: true }); },
    async isRevoked(orderId) { return (await revoked().countDocuments({ _id: orderId })) > 0; },
  };
}
