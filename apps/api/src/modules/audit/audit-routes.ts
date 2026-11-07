import { z } from "zod";
import type { Route } from "../../platform/routes.js";
import { guarded, parse, sendData, type AuthResolver } from "../catalog/catalog.public.js";
import type { AuditReader } from "./audit-reader.js";

const text = z.string().trim().min(1).max(128);
const query = z.object({
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(), entityId: text.optional(), actorId: text.optional(),
  action: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(64).optional(),
}).strict();

/** GET /admin/audit (F25). Read-only; there is no way to change or delete an audit record. */
export function auditRoutes(reader: AuditReader, auth: AuthResolver): Route[] {
  return [{ method: "get", path: "/admin/audit", handler: guarded(auth, "audit:view", async (ctx, req, res) => {
    const q = parse(query, req.query);
    const { actor } = ctx;
    const result = await reader.search({ ...q, warehouseIds: actor.scope.all ? null : actor.scope.warehouseIds });
    sendData(res, result.data, 200, { nextCursor: result.nextCursor });
  }) }];
}
