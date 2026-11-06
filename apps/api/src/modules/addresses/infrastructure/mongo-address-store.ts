import type { ClientSession, Connection } from "mongoose";
import type { AddressStore } from "../application/ports.js";
import type { Address } from "../domain/address.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules. The place is stored as a GeoJSON point.
type AddressDoc = Omit<Address, "id" | "location"> & { _id: string; location: { type: "Point"; coordinates: [number, number] } };
const toAddress = ({ _id, location, ...rest }: AddressDoc): Address => ({ id: _id, ...rest, location: { lat: location.coordinates[1], lng: location.coordinates[0] } });
const toDoc = ({ id, location, ...rest }: Address): AddressDoc => ({ _id: id, ...rest, location: { type: "Point", coordinates: [location.lng, location.lat] } });

export function createMongoAddressStore(connection: Connection): AddressStore {
  const addresses = () => connection.collection<AddressDoc>("addresses");

  /**
   * Two devices making different addresses the default at the same moment can each see "no default yet" and both try to write one;
   * the unique index refuses the second. That refusal is expected, so the step is simply run again and sees the first one's result.
   */
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = await connection.startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => { result = await fn(session); });
        return result;
      } catch (error) {
        if ((error as { code?: number } | null)?.code === 11000 && attempt < 4) continue;
        throw error;
      } finally { await session.endSession(); }
    }
  }

  return {
    async ensureIndexes() {
      await addresses().createIndex({ userId: 1, isDefault: -1, createdAt: -1 });
      // The database itself refuses a second default for one customer.
      await addresses().createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { isDefault: true }, name: "one_default_per_user" });
      await addresses().createIndex({ location: "2dsphere" });
    },

    count(userId) { return addresses().countDocuments({ userId }); },
    async list(userId) { return (await addresses().find({ userId }).sort({ isDefault: -1, createdAt: -1, _id: -1 }).toArray()).map(toAddress); },
    async get(userId, id) { const doc = await addresses().findOne({ _id: id, userId }); return doc ? toAddress(doc) : null; },

    insert(address, makeDefault) {
      return inTransaction(async session => {
        const first = (await addresses().countDocuments({ userId: address.userId }, { session })) === 0;
        const isDefault = makeDefault || first;
        if (isDefault) await addresses().updateMany({ userId: address.userId, isDefault: true }, { $set: { isDefault: false } }, { session });
        const saved = { ...address, isDefault };
        await addresses().insertOne(toDoc(saved), { session });
        return saved;
      });
    },

    async save(address) {
      // The default flag is only ever changed by setDefault and delete, so a plain edit cannot undo it.
      const { isDefault: _kept, ...fields } = toDoc(address);
      await addresses().updateOne({ _id: address.id, userId: address.userId }, { $set: fields });
    },

    setDefault(userId, id, at) {
      return inTransaction(async session => {
        if (!(await addresses().findOne({ _id: id, userId }, { session }))) return false;
        await addresses().updateMany({ userId, isDefault: true, _id: { $ne: id } }, { $set: { isDefault: false } }, { session });
        await addresses().updateOne({ _id: id, userId }, { $set: { isDefault: true, updatedAt: at } }, { session });
        return true;
      });
    },

    delete(userId, id, at) {
      return inTransaction(async session => {
        const doc = await addresses().findOneAndDelete({ _id: id, userId }, { session });
        if (!doc) return { deleted: null, promoted: null };
        let promoted: string | null = null;
        if (doc.isDefault) {
          const next = await addresses().find({ userId }, { session }).sort({ createdAt: -1, _id: -1 }).limit(1).toArray();
          if (next[0]) { await addresses().updateOne({ _id: next[0]._id }, { $set: { isDefault: true, updatedAt: at } }, { session }); promoted = next[0]._id; }
        }
        return { deleted: toAddress(doc), promoted };
      });
    },

    async deleteAll(userId) {
      const docs = await addresses().find({ userId }).toArray();
      await addresses().deleteMany({ userId });
      return docs.map(toAddress);
    },
  };
}
