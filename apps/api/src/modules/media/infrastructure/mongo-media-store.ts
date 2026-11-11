import type { Connection } from "mongoose";
import { DuplicateMediaError } from "../application/errors.js";
import type { MediaStore } from "../application/ports.js";
import type { MediaFile } from "../domain/media.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules.
type MediaDoc = Omit<MediaFile, "id"> & { _id: string };
const toFile = ({ _id, ...rest }: MediaDoc): MediaFile => ({ id: _id, ...rest });
const toDoc = ({ id, ...rest }: MediaFile): MediaDoc => ({ _id: id, ...rest });

export function createMongoMediaStore(connection: Connection): MediaStore {
  const files = () => connection.collection<MediaDoc>("media_files");

  return {
    async ensureIndexes() {
      await files().createIndex({ status: 1, deleteAfter: 1 });
      await files().createIndex({ status: 1, nextDeleteAt: 1 });
      await files().createIndex({ ownerType: 1, ownerId: 1 });
      await files().createIndex({ uploadedBy: 1, status: 1 });
      await files().createIndex({ status: 1, createdAt: 1 });
      // An address file can be copied onto an order once.
      await files().createIndex({ copiedFromId: 1, ownerId: 1 }, { unique: true, partialFilterExpression: { copiedFromId: { $type: "string" } } });
    },

    async insert(file) {
      try { await files().insertOne(toDoc(file)); }
      catch (error) { if ((error as { code?: number } | null)?.code === 11000) throw new DuplicateMediaError(); throw error; }
    },

    async get(id) { const doc = await files().findOne({ _id: id }); return doc ? toFile(doc) : null; },
    async getMany(ids) { return ids.length === 0 ? [] : (await files().find({ _id: { $in: [...ids] } }).toArray()).map(toFile); },

    async update(id, patch, options = {}) {
      const { id: _ignored, ...fields } = patch;
      const filter = { _id: id, ...(options.from && { status: { $in: [...options.from] } }) };
      return (await files().updateOne(filter, { $set: fields })).modifiedCount === 1;
    },

    countPending(userId, now) { return files().countDocuments({ uploadedBy: userId, status: "pending", uploadExpiresAt: { $gt: now } }); },

    async listByOwner(ownerType, ownerId, statuses) {
      return (await files().find({ ownerType, ownerId, status: { $in: [...statuses] } }).toArray()).map(toFile);
    },

    async findOrderCopy(sourceId, orderId) {
      const doc = await files().findOne({ copiedFromId: sourceId, ownerType: "order", ownerId: orderId });
      return doc ? toFile(doc) : null;
    },

    async setDeleteAfter(ownerType, ownerId, kinds, deleteAfter) {
      const done = await files().updateMany(
        { ownerType, ownerId, kind: { $in: [...kinds] }, status: { $in: ["pending", "processing", "ready"] } },
        { $set: { deleteAfter, updatedAt: new Date() } },
      );
      return done.modifiedCount;
    },

    async listDeleteDue(now, limit) {
      return (await files().find({ status: "ready", deleteAfter: { $lte: now } }).sort({ deleteAfter: 1 }).limit(limit).toArray()).map(toFile);
    },
    async listDeleteRetries(now, limit) {
      return (await files().find({ status: "deleting", nextDeleteAt: { $lte: now } }).sort({ nextDeleteAt: 1 }).limit(limit).toArray()).map(toFile);
    },
    async listFailedDeletions(limit) {
      return (await files().find({ status: "deleting", deleteAttempts: { $gte: 1 } }).sort({ deleteRequestedAt: 1 }).limit(limit).toArray()).map(toFile);
    },
    async listStale(cutoff, limit) {
      const filter = { $or: [
        { status: "pending" as const, createdAt: { $lt: cutoff } },
        { status: "failed" as const, updatedAt: { $lt: cutoff } },
        { status: "ready" as const, ownerId: null, createdAt: { $lt: cutoff } },
      ] };
      return (await files().find(filter).sort({ createdAt: 1 }).limit(limit).toArray()).map(toFile);
    },
  };
}
