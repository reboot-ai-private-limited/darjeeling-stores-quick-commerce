import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import { DuplicateRiderError, type AuditEntry, type RiderStore } from "../application/ports.js";
import type { Rider, RiderStatus, Shift } from "../domain/rider.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules. The last position is a GeoJSON point.
type RiderDoc = Omit<Rider, "id" | "lastLocation"> & { _id: string; lastLocation: { type: "Point"; coordinates: [number, number] } | null };
type ShiftDoc = Omit<Shift, "id"> & { _id: string };
const point = (p: { lat: number; lng: number } | null | undefined): RiderDoc["lastLocation"] => (p ? { type: "Point", coordinates: [p.lng, p.lat] } : null);
const toRider = ({ _id, lastLocation, ...rest }: RiderDoc): Rider => ({ id: _id, ...rest, lastLocation: lastLocation ? { lat: lastLocation.coordinates[1], lng: lastLocation.coordinates[0] } : null });
const toRiderDoc = ({ id, lastLocation, ...rest }: Rider): RiderDoc => ({ _id: id, ...rest, lastLocation: point(lastLocation) });
const toShift = ({ _id, ...rest }: ShiftDoc): Shift => ({ id: _id, ...rest });
const toShiftDoc = ({ id, ...rest }: Shift): ShiftDoc => ({ _id: id, ...rest });
/** A patch as stored: the position becomes a GeoJSON point, and an id is never written. */
function patchDoc(patch: Partial<Rider>): Record<string, unknown> {
  const { id: _id, lastLocation, ...rest } = patch;
  return { ...rest, ...(lastLocation !== undefined && { lastLocation: point(lastLocation) }) };
}
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createMongoRiderStore(connection: Connection): RiderStore & { recordAudit(entry: AuditEntry): Promise<void> } {
  const riders = () => connection.collection<RiderDoc>("riders");
  const shifts = () => connection.collection<ShiftDoc>("rider_shifts");
  const writeAudit = createAuditWriter(connection);

  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await fn(session); });
      return result;
    } finally { await session.endSession(); }
  }

  return {
    async ensureIndexes() {
      await riders().createIndex({ userId: 1 }, { unique: true });
      await riders().createIndex({ phone: 1 }, { unique: true });
      await riders().createIndex({ zoneId: 1, status: 1, activeOrderCount: 1 });
      await riders().createIndex({ warehouseIds: 1 });
      await shifts().createIndex({ riderId: 1, startedAt: -1 });
      await shifts().createIndex({ warehouseId: 1, startedAt: -1 });
    },

    async insert(rider, audit) {
      try { await inTransaction(async session => { await riders().insertOne(toRiderDoc(rider), { session }); await writeAudit(audit, session); }); }
      catch (error) {
        const e = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
        if (e?.code === 11000) throw new DuplicateRiderError(e.keyPattern && "userId" in e.keyPattern ? "userId" : "phone");
        throw error;
      }
    },

    async get(id) { const doc = await riders().findOne({ _id: id }); return doc ? toRider(doc) : null; },
    async getByUserId(userId) { const doc = await riders().findOne({ userId }); return doc ? toRider(doc) : null; },
    async getMany(ids) { return ids.length === 0 ? [] : (await riders().find({ _id: { $in: [...ids] } }).toArray()).map(toRider); },

    async list(filters, limit) {
      const filter: Record<string, unknown> = {};
      if (filters.zoneId) filter.zoneId = filters.zoneId;
      if (filters.warehouseId) filter.warehouseIds = filters.warehouseId;
      if (filters.status === "deactivated") filter.isActive = false;
      else if (filters.status) { filter.status = filters.status; filter.isActive = true; }
      if (filters.q) filter.$or = [{ name: { $regex: escapeRegex(filters.q), $options: "i" } }, { phone: { $regex: escapeRegex(filters.q) } }];
      if (filters.scope) filter.warehouseIds = filters.warehouseId ? { $all: [filters.warehouseId], $in: [...filters.scope] } : { $in: [...filters.scope] };
      return (await riders().find(filter).sort({ name: 1, _id: 1 }).limit(limit).toArray()).map(toRider);
    },
    async listActive() { return (await riders().find({ isActive: true }).toArray()).map(toRider); },

    async update(id, patch, when, audit) {
      const filter = { _id: id, ...(when?.currentShiftId !== undefined && { currentShiftId: when.currentShiftId }), ...(when?.isActive !== undefined && { isActive: when.isActive }) };
      if (!audit) return (await riders().updateOne(filter, { $set: patchDoc(patch) })).matchedCount === 1;
      return inTransaction(async session => {
        const done = await riders().updateOne(filter, { $set: patchDoc(patch) }, { session });
        if (done.matchedCount === 1) await writeAudit(audit, session);
        return done.matchedCount === 1;
      });
    },

    async claimShift(riderId, shiftId, patch) {
      const doc = await riders().findOneAndUpdate({ _id: riderId, isActive: true, currentShiftId: null }, { $set: { ...patchDoc(patch), currentShiftId: shiftId } }, { returnDocument: "after" });
      return doc ? toRider(doc) : null;
    },

    async insertShift(shift) { await shifts().insertOne(toShiftDoc(shift)); },
    async getShift(id) { const doc = await shifts().findOne({ _id: id }); return doc ? toShift(doc) : null; },
    async updateShift(id, patch) { const { id: _id, ...rest } = patch; await shifts().updateOne({ _id: id }, { $set: rest }); },

    async listShifts(filters, beforeId, limit) {
      const filter: Record<string, unknown> = {};
      if (filters.riderId) filter.riderId = filters.riderId;
      if (filters.warehouseId) filter.warehouseId = filters.warehouseId;
      else if (filters.scope) filter.warehouseId = { $in: [...filters.scope] };
      if (filters.from || filters.to) filter.startedAt = { ...(filters.from && { $gte: filters.from }), ...(filters.to && { $lte: filters.to }) };
      if (beforeId) filter._id = { $lt: beforeId };
      return (await shifts().find(filter).sort({ _id: -1 }).limit(limit).toArray()).map(toShift);
    },

    async reserveCapacity(riderId, max, n = 1) {
      const done = await riders().updateOne({ _id: riderId, isActive: true, activeOrderCount: { $lte: max - n } }, { $inc: { activeOrderCount: n } });
      return done.modifiedCount === 1;
    },
    async releaseCapacity(riderId, n = 1) {
      await riders().updateOne({ _id: riderId, activeOrderCount: { $gte: n } }, { $inc: { activeOrderCount: -n } });
    },
    async setActiveCount(riderId, count) { await riders().updateOne({ _id: riderId }, { $set: { activeOrderCount: count } }); },

    async markStaleOffline(cutoff, at) {
      const live = ["online", "on_break"] as RiderStatus[];
      const filter = { isActive: true, status: { $in: live }, currentShiftId: { $ne: null }, lastLocationAt: { $lt: cutoff } };
      const stale = await riders().find(filter).toArray();
      if (stale.length > 0) await riders().updateMany({ _id: { $in: stale.map(r => r._id) }, status: { $in: live } }, { $set: { status: "offline", autoOffline: true, updatedAt: at } });
      return stale.map(toRider);
    },

    async recordAudit(entry) { await inTransaction(session => writeAudit(entry, session)); },
  };
}
