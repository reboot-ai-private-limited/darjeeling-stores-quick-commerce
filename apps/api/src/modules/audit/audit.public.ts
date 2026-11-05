import type { ClientSession, Connection } from "mongoose";
import { z } from "zod";

const auditEvent = z.object({
  actorId: z.string().min(1).max(128),
  actorRole: z.string().min(1).max(128),
  action: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  entityId: z.string().min(1).max(128),
  requestId: z.string().uuid(),
  warehouseId: z.string().min(1).max(128).optional(),
}).strict();

export type AuditEvent = z.infer<typeof auditEvent>;

export function createAuditWriter(connection: Connection) {
  return async function writeAudit(event: AuditEvent, session: ClientSession): Promise<void> {
    const safe = auditEvent.parse(event);
    if (!session.inTransaction()) throw new Error("Audit writes require an active transaction");
    await connection.collection("audit_log").insertOne({ ...safe, at: new Date() }, { session });
  };
}
