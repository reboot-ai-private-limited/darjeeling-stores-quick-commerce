import { Types, type ClientSession, type Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import { conflict } from "../../catalog/catalog.public.js";
import type { HistoryRow, SettingsStore, StoredSetting } from "../application/ports.js";
import type { ScopeRef, ScopeType } from "../domain/registry.js";

interface SettingDoc { _id: string; group: string; key: string; scopeType: ScopeType; scopeId: string | null; value: unknown; version: number; updatedBy: string; updatedAt: Date }
interface HistoryDoc { group: string; key: string; scopeType: ScopeType; scopeId: string | null; oldValue: unknown; newValue: unknown; version: number; by: string; at: Date }

const docId = (group: string, key: string, scope: ScopeRef) => `${group}.${key}|${scope.type}|${scope.id ?? ""}`;
const clash = () => conflict("Settings were changed at the same time; reload and try again");
const isObjectId = (value: string) => /^[a-f0-9]{24}$/.test(value);

export function createMongoSettingsStore(connection: Connection): SettingsStore {
  const settings = () => connection.collection<SettingDoc>("settings");
  const history = () => connection.collection<HistoryDoc>("settings_history");
  const writeAudit = createAuditWriter(connection);
  async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try { let result!: T; await session.withTransaction(async () => { result = await fn(session); }); return result; }
    finally { await session.endSession(); }
  }

  return {
    async ensureIndexes() {
      await settings().createIndex({ group: 1, scopeType: 1, scopeId: 1 });
      await history().createIndex({ group: 1, key: 1, at: -1 });
      await history().createIndex({ scopeId: 1, at: -1 });
    },

    async layers(group, chain) {
      if (chain.length === 0) return [];
      const docs = await settings().find({ group, $or: chain.map(s => ({ scopeType: s.type, scopeId: s.id })) }).toArray();
      return docs.map((d): StoredSetting => ({ key: d.key, scope: d.scopeType, value: d.value, version: d.version }));
    },

    async apply({ group, scope, changes, by, at, audit }) {
      await inTransaction(async session => {
        for (const change of changes) {
          const id = docId(group, change.key, scope);
          const current = await settings().findOne({ _id: id }, { session });
          const before = current?.value ?? null;
          const version = (current?.version ?? 0) + 1;
          if (change.value === null) {
            if (!current) continue;
            await settings().deleteOne({ _id: id }, { session });
          } else {
            // The version doubles as a write fence: two concurrent writers cannot both move the same version forward.
            const result = await settings().updateOne(
              { _id: id, version: current?.version ?? { $exists: false } as never },
              { $set: { group, key: change.key, scopeType: scope.type, scopeId: scope.id, value: change.value, version, updatedBy: by, updatedAt: at } },
              { upsert: current === null, session },
            ).catch(error => { if ((error as { code?: number } | null)?.code === 11000) throw clash(); throw error; });
            if (!current && result.upsertedCount === 0) throw clash();
            if (current && result.matchedCount === 0) throw clash();
          }
          await history().insertOne({ group, key: change.key, scopeType: scope.type, scopeId: scope.id, oldValue: before, newValue: change.value, version, by, at }, { session });
          await writeAudit(audit({ key: change.key, before: before === null ? null : before, after: change.value }), session);
        }
      });
    },

    async history(query) {
      const filter: Record<string, unknown> = {};
      if (query.group) filter.group = query.group;
      if (query.key) filter.key = query.key;
      if (query.scopeId) filter.scopeId = query.scopeId;
      if (query.from || query.to) filter.at = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
      // Scoped staff see only their own warehouses' overrides, never zone or global changes.
      if (query.warehouseIds) { filter.scopeType = "warehouse"; filter.scopeId = query.scopeId ? (query.warehouseIds.includes(query.scopeId) ? query.scopeId : { $in: [] }) : { $in: [...query.warehouseIds] }; }
      if (query.cursor) {
        if (!isObjectId(query.cursor)) return { rows: [], nextCursor: null };
        filter._id = { $lt: new Types.ObjectId(query.cursor) };
      }
      const docs = await connection.collection("settings_history").find(filter).sort({ _id: -1 }).limit(query.limit + 1).toArray();
      const page = docs.slice(0, query.limit);
      return {
        rows: page.map((d): HistoryRow => ({ group: d.group, key: d.key, scope: { type: d.scopeType, id: d.scopeId }, oldValue: d.oldValue, newValue: d.newValue, by: d.by, at: d.at })),
        nextCursor: docs.length > query.limit ? String(page[page.length - 1]!._id) : null,
      };
    },

    async zoneOf(warehouseId) {
      if (!isObjectId(warehouseId)) return null;
      const doc = await connection.collection("warehouses").findOne({ _id: new Types.ObjectId(warehouseId) }, { projection: { zoneId: 1 } });
      return doc ? String(doc.zoneId) : null;
    },
    async zoneExists(zoneId) {
      return isObjectId(zoneId) && (await connection.collection("zones").countDocuments({ _id: new Types.ObjectId(zoneId) }, { limit: 1 })) > 0;
    },
  };
}
