import type { ClientSession, Connection } from "mongoose";
import { z } from "zod";

const roleSnapshot = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/), name: z.string().max(64), permissions: z.array(z.string().max(128)).max(100), isSystem: z.boolean() }).strict();
const staffSnapshot = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/), roleId: z.string().regex(/^[a-fA-F0-9]{24}$/), status: z.string().max(32),
  scope: z.object({ all: z.boolean(), warehouseIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).max(100) }).strict() }).strict();
const auditEvent = z.object({
  actorId: z.string().min(1).max(128),
  actorRole: z.string().min(1).max(128),
  action: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  entityId: z.string().min(1).max(128),
  requestId: z.string().uuid(),
  warehouseId: z.string().min(1).max(128).optional(),
  roleChange: z.object({ before: roleSnapshot.nullable(), after: roleSnapshot.nullable() }).strict().optional(),
  staffChange: z.object({ before: staffSnapshot.nullable(), after: staffSnapshot }).strict().optional(),
}).strict();

export type AuditEvent = z.infer<typeof auditEvent>;

export function createAuditWriter(connection: Connection) {
  return async function writeAudit(event: AuditEvent, session: ClientSession): Promise<void> {
    const safe = auditEvent.parse(event);
    if (!session.inTransaction()) throw new Error("Audit writes require an active transaction");
    await connection.collection("audit_log").insertOne({ ...safe, at: new Date() }, { session });
  };
}
