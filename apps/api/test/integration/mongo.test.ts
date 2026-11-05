import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;

describe("isolated MongoDB adapter behavior", () => {
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    // The URI comes exclusively from a newly spawned local server, never the environment.
    connection = await mongoose.createConnection(replica.getUri("darjeeling_integration_test"), { serverSelectionTimeoutMS: 5000 }).asPromise();
  }, 120000);
  afterAll(async () => {
    await connection?.close();
    await replica?.stop();
  });
  it("writes and reads documents with a unique index", async () => {
    const collection = connection.collection("index_checks");
    await collection.createIndex({ key: 1 }, { unique: true });
    await collection.insertOne({ key: "one" });
    expect(await collection.findOne({ key: "one" })).toMatchObject({ key: "one" });
    await expect(collection.insertOne({ key: "one" })).rejects.toMatchObject({ code: 11000 });
  });
  it("supports transactions and rolls back aborted writes", async () => {
    const session = await connection.startSession();
    try {
      session.startTransaction();
      await connection.collection("transaction_checks").insertOne({ key: "rollback" }, { session });
      await session.abortTransaction();
      expect(await connection.collection("transaction_checks").findOne({ key: "rollback" })).toBeNull();
    } finally { await session.endSession(); }
  });
});
