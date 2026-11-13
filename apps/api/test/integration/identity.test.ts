import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIdentityStore } from "../../src/modules/identity/identity.public.js";

let replica: MongoMemoryReplSet;
let connection: mongoose.Connection;
let store: ReturnType<typeof createIdentityStore>;
const roleId = new mongoose.Types.ObjectId().toHexString();

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  connection = await mongoose.createConnection(replica.getUri("identity_integration_test")).asPromise();
  store = createIdentityStore(connection);
  await store.initialize();
  await connection.collection("roles").insertOne({ _id: new mongoose.Types.ObjectId(roleId), name: "identity_fixture", permissions: [], isSystem: false });
}, 120000);
afterAll(async () => { await connection?.close(); await replica?.stop(); });

describe("identity persistence", () => {
  it("normalizes identifiers and returns only safe account fields", async () => {
    const user = await store.createUser({ kind: "staff", roleId, email: "  OWNER@EXAMPLE.COM  ", name: "Owner" });
    expect(user).toMatchObject({ kind: "staff", roleId, email: "owner@example.com", status: "active" });
    expect(user.id).toMatch(/^[a-f0-9]{24}$/);
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("_id");
    await expect(store.createUser({ kind: "staff", roleId, email: "OWNER@example.com" })).rejects.toMatchObject({ code: 11000 });
  });

  it("allows absent optional identifiers without unique-index collisions", async () => {
    await store.createUser({ kind: "customer", roleId, phone: "+919800000001" });
    await store.createUser({ kind: "customer", roleId, phone: "+919800000002" });
    await store.createUser({ kind: "staff", roleId, email: "first@example.com" });
    await store.createUser({ kind: "staff", roleId, email: "second@example.com" });
  });

  it("permits only one concurrent claimant of a normalized phone", async () => {
    const results = await Promise.allSettled([
      store.createUser({ kind: "customer", roleId, phone: "+91 98000-00003" }),
      store.createUser({ kind: "customer", roleId, phone: "+919800000003" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: 11000 });
  });

  it("lets one phone number hold one account of each kind", async () => {
    await store.createUser({ kind: "customer", roleId, phone: "+919800000004" });
    await store.createUser({ kind: "rider", roleId, phone: "+919800000004" });
    await expect(store.createUser({ kind: "rider", roleId, phone: "+919800000004" })).rejects.toMatchObject({ code: 11000 });
  });

  it("rejects missing identifiers, malformed references and client-controlled authority", async () => {
    for (const input of [
      { kind: "staff", roleId },
      { kind: "customer", roleId, email: "customer@example.com" },
      { kind: "rider", roleId, phone: "9800000000" },
      { kind: "customer", roleId: "bad", phone: "+919800000004" },
      { kind: "customer", roleId, phone: null },
      { kind: "customer", roleId, phone: "+919800000004", scope: { all: true } },
      { kind: "customer", roleId, phone: "+919800000004", status: "active", passwordHash: "injected" },
    ]) await expect(store.createUser(input)).rejects.toThrow();
  });

  it("persists account kind separately from role and starts with no warehouse grants", async () => {
    const user = await store.createUser({ kind: "rider", roleId, phone: "+919800000005" });
    const stored = await connection.collection("users").findOne({ _id: new mongoose.Types.ObjectId(user.id) });
    expect(stored).toMatchObject({ kind: "rider", scope: { all: false, warehouseIds: [] } });
    expect(stored?.roleId.toString()).toBe(roleId);
    expect(stored?.createdAt).toBeInstanceOf(Date);
  });
});
