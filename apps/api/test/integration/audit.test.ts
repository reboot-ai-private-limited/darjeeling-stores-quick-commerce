import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditWriter } from "../../src/modules/audit/audit.public.js";

const event = { actorId: "owner", actorRole: "admin", action: "staff.create", entityType: "staff", entityId: "staff-1", requestId: "00000000-0000-4000-8000-000000000001" };
let replica: MongoMemoryReplSet;
let db: mongoose.Connection;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(replica.getUri("audit_integration_test")).asPromise();
}, 120000);
afterAll(async () => { await db?.close(); await replica?.stop(); });

describe("transactional audit", () => {
  it("commits the mutation and allowlisted audit record together", async () => {
    const session = await db.startSession();
    try {
      await session.withTransaction(async () => {
        await db.collection("test_mutations").insertOne({ _id: new mongoose.Types.ObjectId(), name: "created" }, { session });
        await createAuditWriter(db)(event, session);
      });
      const audit = await db.collection("audit_log").findOne({ entityId: event.entityId });
      expect(audit).toMatchObject(event);
      expect(await db.collection("test_mutations").countDocuments({ name: "created" })).toBe(1);
    } finally { await session.endSession(); }
  });
  it("rejects unexpected secret fields and rolls the mutation back", async () => {
    const session = await db.startSession();
    try {
      await expect(session.withTransaction(async () => {
        await db.collection("test_mutations").insertOne({ name: "must-rollback" }, { session });
        await createAuditWriter(db)({ ...event, password: "secret" } as typeof event, session);
      })).rejects.toThrow();
      expect(await db.collection("test_mutations").countDocuments({ name: "must-rollback" })).toBe(0);
      expect(await db.collection("audit_log").countDocuments({ password: "secret" })).toBe(0);
    } finally { await session.endSession(); }
  });
  it("rejects audit writes outside an active transaction", async () => {
    const session = await db.startSession();
    try { await expect(createAuditWriter(db)(event, session)).rejects.toThrow("active transaction"); }
    finally { await session.endSession(); }
  });
});
