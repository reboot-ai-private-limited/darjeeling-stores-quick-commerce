import { Types, type Connection } from "mongoose";

export interface AuditQuery {
  entityType?: string | undefined; entityId?: string | undefined; actorId?: string | undefined; action?: string | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined;
  /** `null` means every warehouse; otherwise only records of these warehouses are visible. */
  warehouseIds: readonly string[] | null;
}
export interface AuditEntryView {
  id: string; actorId: string; actorRole: string; action: string; entityType: string; entityId: string;
  before: unknown; after: unknown; reason: string | null; requestId: string; at: string;
}
export interface AuditReader { search(query: AuditQuery): Promise<{ data: AuditEntryView[]; nextCursor: string | null }> }

const CHANGES = ["roleChange", "staffChange", "cityChange", "zoneChange", "localityChange", "warehouseChange", "settingChange", "customerChange"] as const;
const OBJECT_ID = /^[a-f0-9]{24}$/;

/** The before/after pair of whichever change an entry carries. */
export function changeOf(doc: Record<string, unknown>): { before: unknown; after: unknown } {
  for (const key of CHANGES) {
    const change = doc[key] as { before?: unknown; after?: unknown } | undefined;
    if (change && typeof change === "object") return { before: change.before ?? null, after: change.after ?? null };
  }
  return { before: null, after: null };
}

export function createAuditReader(connection: Connection): AuditReader {
  const log = () => connection.collection("audit_log");
  return {
    async search(query) {
      const filter: Record<string, unknown> = {};
      for (const key of ["entityType", "entityId", "actorId", "action"] as const) if (query[key]) filter[key] = query[key];
      if (query.from || query.to) filter.at = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
      // Scoped staff see only records tied to their own warehouses; records without a warehouse are all-scope only.
      if (query.warehouseIds) filter.warehouseId = { $in: [...query.warehouseIds] };
      if (query.cursor) {
        if (!OBJECT_ID.test(query.cursor)) return { data: [], nextCursor: null };
        filter._id = { $lt: new Types.ObjectId(query.cursor) };
      }
      const docs = await log().find(filter).sort({ _id: -1 }).limit(query.limit + 1).toArray();
      const page = docs.slice(0, query.limit);
      return {
        data: page.map(doc => ({
          id: String(doc._id), actorId: String(doc.actorId), actorRole: String(doc.actorRole), action: String(doc.action), entityType: String(doc.entityType), entityId: String(doc.entityId),
          ...changeOf(doc), reason: typeof doc.reason === "string" ? doc.reason : null, requestId: String(doc.requestId), at: (doc.at as Date).toISOString(),
        })),
        nextCursor: docs.length > query.limit ? String(page[page.length - 1]!._id) : null,
      };
    },
  };
}
