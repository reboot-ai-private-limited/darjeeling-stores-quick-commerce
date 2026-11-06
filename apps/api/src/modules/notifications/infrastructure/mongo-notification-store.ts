import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import {
  DuplicateNotificationError, DuplicateTemplateError, type AuditEntry, type LogFilters, type NotificationStore,
} from "../application/ports.js";
import { moveForward, type Notification, type Prefs, type Template } from "../domain/notification.js";

// Ids are 24-character hex strings stored as strings, like the other Dev 2 modules.
type TemplateDoc = Omit<Template, "id"> & { _id: string };
type NotificationDoc = Omit<Notification, "id"> & { _id: string };
type PrefsDoc = Prefs & { _id: string; updatedAt: Date };
const toTemplate = ({ _id, ...rest }: TemplateDoc): Template => ({ id: _id, ...rest });
const toTemplateDoc = ({ id, ...rest }: Template): TemplateDoc => ({ _id: id, ...rest });
const toNotification = ({ _id, ...rest }: NotificationDoc): Notification => ({ id: _id, ...rest });
const toNotificationDoc = ({ id, ...rest }: Notification): NotificationDoc => ({ _id: id, ...rest });
const isDuplicate = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

export function createMongoNotificationStore(connection: Connection): NotificationStore {
  const templates = () => connection.collection<TemplateDoc>("notification_templates");
  const notifications = () => connection.collection<NotificationDoc>("notifications");
  const prefs = () => connection.collection<PrefsDoc>("notification_prefs");
  const writeAudit = createAuditWriter(connection);

  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await fn(session); });
      return result;
    } finally { await session.endSession(); }
  }

  function filterFor(filters: LogFilters): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.channel) filter.channel = filters.channel;
    if (filters.userId) filter.userId = filters.userId;
    if (filters.orderId) filter.orderId = filters.orderId;
    if (filters.from || filters.to) filter.createdAt = { ...(filters.from && { $gte: filters.from }), ...(filters.to && { $lte: filters.to }) };
    return filter;
  }

  return {
    async ensureIndexes() {
      await templates().createIndex({ key: 1, channel: 1 }, { unique: true });
      await notifications().createIndex({ userId: 1, createdAt: -1 });
      await notifications().createIndex({ status: 1, createdAt: -1 });
      await notifications().createIndex({ providerMessageId: 1 }, { sparse: true });
      await notifications().createIndex({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
    },

    async seedTemplates(defaults, newId, at) {
      for (const t of defaults) {
        await templates().updateOne({ key: t.key, channel: t.channel }, { $setOnInsert: { _id: newId(), ...t, createdAt: at, updatedAt: at } }, { upsert: true });
      }
    },

    async listTemplates() { return (await templates().find({}).toArray()).map(toTemplate); },
    async getTemplate(id) { const doc = await templates().findOne({ _id: id }); return doc ? toTemplate(doc) : null; },
    async templatesFor(key) { return (await templates().find({ key }).toArray()).map(toTemplate); },

    async insertTemplate(template, audit) {
      try { await inTransaction(async session => { await templates().insertOne(toTemplateDoc(template), { session }); await writeAudit(audit, session); }); }
      catch (error) { if (isDuplicate(error)) throw new DuplicateTemplateError(); throw error; }
    },
    async saveTemplate(template, audit) {
      try { await inTransaction(async session => { await templates().replaceOne({ _id: template.id }, toTemplateDoc(template), { session }); await writeAudit(audit, session); }); }
      catch (error) { if (isDuplicate(error)) throw new DuplicateTemplateError(); throw error; }
    },

    async getPrefs(userId) {
      const doc = await prefs().findOne({ _id: userId });
      return doc ? { promoPush: doc.promoPush, promoWhatsApp: doc.promoWhatsApp, cartReminders: doc.cartReminders } : null;
    },
    async getPrefsMany(userIds) {
      if (userIds.length === 0) return new Map();
      const docs = await prefs().find({ _id: { $in: [...userIds] } }).toArray();
      return new Map(docs.map(d => [d._id, { promoPush: d.promoPush, promoWhatsApp: d.promoWhatsApp, cartReminders: d.cartReminders }]));
    },
    async savePrefs(userId, value, at) { await prefs().updateOne({ _id: userId }, { $set: { ...value, updatedAt: at } }, { upsert: true }); },

    async insert(notification) {
      try { await notifications().insertOne(toNotificationDoc(notification)); }
      catch (error) { if (isDuplicate(error)) throw new DuplicateNotificationError(); throw error; }
    },
    async get(id) { const doc = await notifications().findOne({ _id: id }); return doc ? toNotification(doc) : null; },

    async claim(id, now, until) {
      const doc = await notifications().findOneAndUpdate(
        { _id: id, status: "queued", $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
        { $set: { lockedUntil: until, updatedAt: now }, $inc: { attempts: 1 } }, { returnDocument: "after" },
      );
      return doc ? toNotification(doc) : null;
    },
    async markSent(id, providerMessageId, at) {
      await notifications().updateOne({ _id: id, status: "queued" }, { $set: { status: "sent", providerMessageId, sentAt: at, error: null, lockedUntil: null, updatedAt: at } });
    },
    async markFailed(id, error, at) {
      await notifications().updateOne({ _id: id, status: "queued" }, { $set: { status: "failed", error: error.slice(0, 500), lockedUntil: null, updatedAt: at } });
    },
    async release(id, error, at) {
      await notifications().updateOne({ _id: id, status: "queued" }, { $set: { error: error.slice(0, 500), lockedUntil: null, updatedAt: at } });
    },
    async requeue(id, at, audit) {
      return inTransaction(async session => {
        const done = await notifications().updateOne({ _id: id, status: "failed" }, { $set: { status: "queued", error: null, attempts: 0, lockedUntil: null, updatedAt: at } }, { session });
        if (done.modifiedCount === 1) await writeAudit(audit, session);
        return done.modifiedCount === 1;
      });
    },

    async list(filters, beforeId, limit) {
      const filter = { ...filterFor(filters), ...(beforeId !== undefined && { _id: { $lt: beforeId } }) };
      return (await notifications().find(filter).sort({ _id: -1 }).limit(limit).toArray()).map(toNotification);
    },
    failedCount(filters) { return notifications().countDocuments({ ...filterFor({ ...filters, status: undefined }), status: "failed" }); },

    async applyProviderStatus(providerMessageId, next, error, at) {
      const doc = await notifications().findOne({ providerMessageId });
      if (!doc) return false;
      const status = moveForward(doc.status, next);
      if (status === doc.status && (next !== "failed" || doc.status === "failed")) return false;
      await notifications().updateOne({ _id: doc._id }, { $set: { status, error: status === "failed" ? error ?? "Delivery failed" : doc.error, updatedAt: at } });
      return true;
    },

    async recordAudit(entry: AuditEntry) { await inTransaction(session => writeAudit(entry, session)); },
  };
}
