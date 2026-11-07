import type { Connection } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { createAuditReader } from "./audit-reader.js";
import { auditRoutes } from "./audit-routes.js";

/** The read-only audit search (F25). */
export function createAuditAdminModule(options: { connection: Connection; auth?: AuthResolver }) {
  const reader = createAuditReader(options.connection);
  return { reader, routes: auditRoutes(reader, options.auth ?? denyAll) };
}
