import type { Connection } from "mongoose";
import type { WaitlistEntry, WaitlistStore } from "../application/ports.js";

type WaitlistDoc = {
  _id: string; userId: string | null; phone: string; localityId: string | null; areaKey: string; createdAt: Date;
  location: { type: "Point"; coordinates: [number, number] } | null;
};

export function createMongoWaitlistStore(connection: Connection): WaitlistStore {
  const entries = () => connection.collection<WaitlistDoc>("waitlist");
  return {
    async ensureIndexes() {
      await entries().createIndex({ phone: 1, areaKey: 1 }, { unique: true });
      await entries().createIndex({ createdAt: -1 });
    },
    async add(entry: WaitlistEntry) {
      try {
        await entries().insertOne({
          _id: entry.id, userId: entry.userId, phone: entry.phone, localityId: entry.localityId, areaKey: entry.areaKey, createdAt: entry.createdAt,
          location: entry.location ? { type: "Point", coordinates: [entry.location.lng, entry.location.lat] } : null,
        });
        return true;
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000) return false;
        throw error;
      }
    },
  };
}
