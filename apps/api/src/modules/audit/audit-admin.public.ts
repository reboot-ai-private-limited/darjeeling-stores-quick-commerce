import type { Connection } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { createAuditReader } from "./audit-reader.js";
import { auditRoutes } from "./audit-routes.js";

/** The read-only audit search (F25). */
export function createAuditAdminModule(options: { connection: Connection; auth?: AuthResolver }) {
  const reader = createAuditReader(options.connection);
  /** The search filters by what was changed, who changed it, what was done and where; newest first. Call once after the database connects. */
  async function ensureIndexes() {
    const log = options.connection.collection("audit_log");
    await Promise.all([
      log.createIndex({ entityType: 1, entityId: 1, _id: -1 }), log.createIndex({ actorId: 1, _id: -1 }),
      log.createIndex({ action: 1, _id: -1 }), log.createIndex({ warehouseId: 1, _id: -1 }), log.createIndex({ at: -1 }),
    ]);
  }
  return { reader, ensureIndexes, routes: auditRoutes(reader, options.auth ?? denyAll) };
}
