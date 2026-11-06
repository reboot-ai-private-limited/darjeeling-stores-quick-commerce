import type { Connection } from "mongoose";
import type { JobStore } from "../application/ports.js";
import type { Job } from "../domain/job.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules.
type JobDoc = Omit<Job, "id"> & { _id: string };
interface ScheduleDoc { _id: string; intervalMs: number; nextRunAt: Date }
const toJob = ({ _id, ...rest }: JobDoc): Job => ({ id: _id, ...rest });

export function createMongoJobStore(connection: Connection): JobStore {
  const jobs = () => connection.collection<JobDoc>("jobs");
  const schedules = () => connection.collection<ScheduleDoc>("job_schedules");

  return {
    async ensureIndexes() {
      await jobs().createIndex({ status: 1, runAt: 1 });
      await jobs().createIndex({ status: 1, lockedUntil: 1 });
      await jobs().createIndex({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
      // Finished jobs are kept for a while for debugging, then removed.
      await jobs().createIndex({ completedAt: 1 }, { expireAfterSeconds: 14 * 86_400, partialFilterExpression: { status: { $in: ["done", "cancelled"] } } });
    },

    async insert(job) {
      try { await jobs().insertOne({ _id: job.id, ...withoutId(job) }); return { job, duplicate: false }; }
      catch (error) {
        if ((error as { code?: number } | null)?.code !== 11000 || job.dedupeKey === null) throw error;
        const existing = await jobs().findOne({ dedupeKey: job.dedupeKey });
        if (!existing) throw error;
        return { job: toJob(existing), duplicate: true };
      }
    },

    async get(id) { const doc = await jobs().findOne({ _id: id }); return doc ? toJob(doc) : null; },

    async claimNext(now, leaseMs, workerId, types) {
      if (types.length === 0) return null;
      const doc = await jobs().findOneAndUpdate(
        { type: { $in: [...types] }, $or: [{ status: "pending", runAt: { $lte: now } }, { status: "running", lockedUntil: { $lte: now } }] },
        { $set: { status: "running", lockedUntil: new Date(now.getTime() + leaseMs), lockedBy: workerId, updatedAt: now }, $inc: { attempts: 1 } },
        { sort: { runAt: 1 }, returnDocument: "after" },
      );
      return doc ? toJob(doc) : null;
    },

    async complete(id, workerId, result, at) {
      const done = await jobs().updateOne(
        { _id: id, status: "running", lockedBy: workerId },
        { $set: { status: "done", result, completedAt: at, updatedAt: at, lockedUntil: null, lockedBy: null, lastError: null } },
      );
      return done.modifiedCount === 1;
    },

    async fail(id, workerId, error, retryAt, at) {
      const set = retryAt
        ? { status: "pending" as const, runAt: retryAt, lastError: error, updatedAt: at, lockedUntil: null, lockedBy: null }
        : { status: "failed" as const, lastError: error, updatedAt: at, completedAt: at, lockedUntil: null, lockedBy: null };
      const done = await jobs().updateOne({ _id: id, status: "running", lockedBy: workerId }, { $set: set });
      return done.modifiedCount === 1;
    },

    async cancel(idOrDedupeKey, at) {
      const done = await jobs().updateOne(
        { status: "pending", $or: [{ _id: idOrDedupeKey }, { dedupeKey: idOrDedupeKey }] },
        { $set: { status: "cancelled", completedAt: at, updatedAt: at } },
      );
      return done.modifiedCount === 1;
    },

    async counts() {
      const rows = await jobs().aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
      return Object.fromEntries(rows.map(r => [r._id, r.n]));
    },

    async claimSchedule(name, now, intervalMs) {
      const before = await schedules().findOneAndUpdate({ _id: name, nextRunAt: { $lte: now } }, { $set: { nextRunAt: new Date(now.getTime() + intervalMs), intervalMs } }, { returnDocument: "before" });
      return before ? before.nextRunAt : null;
    },

    async ensureSchedule(name, intervalMs, firstRunAt) {
      await schedules().updateOne({ _id: name }, { $set: { intervalMs }, $setOnInsert: { nextRunAt: firstRunAt } }, { upsert: true });
    },
  };
}

function withoutId({ id: _id, ...rest }: Job) { return rest; }
