import type { ClientSession, Connection } from "mongoose";
import { z } from "zod";

const roleSnapshot = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/), name: z.string().max(64), permissions: z.array(z.string().max(128)).max(100), isSystem: z.boolean() }).strict();
const staffSnapshot = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/), roleId: z.string().regex(/^[a-fA-F0-9]{24}$/), status: z.string().max(32),
  scope: z.object({ all: z.boolean(), warehouseIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).max(100) }).strict() }).strict();
const citySnapshot = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/), name: z.string().min(1).max(100), state: z.string().min(1).max(100), isActive: z.boolean() }).strict();
const zoneSnapshot = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  cityId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  name: z.string().min(1).max(100),
  isEnabled: z.boolean(),
  pause: z.object({
    active: z.boolean(),
    message: z.string().max(500),
    until: z.string().max(64).nullable().optional(),
  }).nullable().optional(),
}).strict();
const localitySnapshot = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  cityId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  name: z.string().min(1).max(100),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  zoneId: z.string().regex(/^[a-fA-F0-9]{24}$/).nullable().optional(),
  travelMinutes: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
}).strict();
const warehouseSnapshot = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/),
  zoneId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  name: z.string().min(1).max(100),
  code: z.string().min(2).max(20),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  address: z.string().min(3).max(500),
  isEnabled: z.boolean(),
  priority: z.number().int().min(1),
  packMinutes: z.number().int().min(0),
  riderArrivalMinutes: z.number().int().min(0),
  defaultTravelMinutes: z.number().int().min(0),
  punchInRadiusMeters: z.number().int().min(0),
  pause: z.object({
    active: z.boolean(),
    message: z.string().max(500),
    until: z.string().max(64).nullable().optional(),
  }).nullable().optional(),
}).strict();
const settingSnapshot = z.object({
  group: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/), key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/),
  scope: z.object({ type: z.enum(["global", "zone", "warehouse"]), id: z.string().max(64).nullable() }).strict(), value: z.unknown(),
}).strict();
const customerSnapshot = z.object({ status: z.string().max(32), codAllowed: z.boolean(), noteAdded: z.boolean().optional() }).strict();
const auditEvent = z.object({
  actorId: z.string().min(1).max(128),
  actorRole: z.string().min(1).max(128),
  action: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  entityId: z.string().min(1).max(128),
  requestId: z.string().uuid(),
  warehouseId: z.string().min(1).max(128).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  settingChange: z.object({ before: settingSnapshot.nullable(), after: settingSnapshot.nullable() }).strict().optional(),
  customerChange: z.object({ before: customerSnapshot.nullable(), after: customerSnapshot }).strict().optional(),
  roleChange: z.object({ before: roleSnapshot.nullable(), after: roleSnapshot.nullable() }).strict().optional(),
  staffChange: z.object({ before: staffSnapshot.nullable(), after: staffSnapshot }).strict().optional(),
  cityChange: z.object({ before: citySnapshot.nullable(), after: citySnapshot.nullable() }).strict().optional(),
  zoneChange: z.object({ before: zoneSnapshot.nullable(), after: zoneSnapshot.nullable() }).strict().optional(),
  localityChange: z.object({ before: localitySnapshot.nullable(), after: localitySnapshot.nullable() }).strict().optional(),
  warehouseChange: z.object({ before: warehouseSnapshot.nullable(), after: warehouseSnapshot.nullable() }).strict().optional(),
}).strict();

export type AuditEvent = z.infer<typeof auditEvent>;

export { createAuditReader, type AuditReader, type AuditQuery, type AuditEntryView } from "./audit-reader.js";

export function createAuditWriter(connection: Connection) {
  return async function writeAudit(event: AuditEvent, session: ClientSession): Promise<void> {
    const safe = auditEvent.parse(event);
    if (!session.inTransaction()) throw new Error("Audit writes require an active transaction");
    await connection.collection("audit_log").insertOne({ ...safe, at: new Date() }, { session });
  };
}
