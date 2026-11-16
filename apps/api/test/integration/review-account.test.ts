import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createRiderIdentity } from "../../src/modules/identity/accounts.public.js";
import { createConsumerRoutes } from "../../src/modules/identity/consumer.public.js";

const KEY = "a".repeat(64);
const CUSTOMER = "+919000000111", RIDER = "+919000000112", REAL = "+919000000113";
let mongo: MongoMemoryReplSet;
let db: mongoose.Connection;
let app: ReturnType<typeof createApp>;   // demo customer and rider, code 123456, no SMS provider at all
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(mongo.getUri("review_otp")).asPromise();
  app = createApp({ additionalRoutes: await createConsumerRoutes(db, KEY, { mode: "production", mockOTP: false, reviewAccount: { code: "123456", phones: { customer: CUSTOMER, rider: RIDER } } }) });
}, 120000);
afterAll(async () => { await db?.close(); await mongo?.stop(); });

const ask = (a: typeof app, phone: string, who: "customer" | "rider") => request(a).post("/api/v1/auth/request-otp").send({ phone, app: who });
const verify = (a: typeof app, phone: string, otp: string) => request(a).post("/api/v1/auth/verify-otp").send({ phone, otp });

describe("demo logins for store review", () => {
  it("signs the demo customer in with 123456 and no SMS, as often as needed", async () => {
    expect((await ask(app, CUSTOMER, "customer")).status).toBe(200);
    expect((await verify(app, CUSTOMER, "000000")).status).toBe(401);
    const first = await verify(app, CUSTOMER, "123456");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.user).toMatchObject({ phone: CUSTOMER, kind: "customer" });
    expect((await ask(app, CUSTOMER, "customer")).status).toBe(200);
    expect((await verify(app, CUSTOMER, "123456")).status).toBe(200);
    expect(await db.collection("users").countDocuments({ phone: CUSTOMER })).toBe(1);
    expect(await db.collection("users").findOne({ phone: CUSTOMER })).toMatchObject({ reviewAccount: true });
  });

  it("signs a registered demo rider in with 123456, but never creates riders", async () => {
    // A rider must already be registered by an admin; a demo number that is not registered is refused.
    expect((await ask(app, RIDER, "rider")).status).toBe(403);
    const made = await createRiderIdentity(db).register({ name: "Demo Rider", phone: RIDER });
    expect(made.ok).toBe(true);
    await db.collection("users").updateOne({ phone: RIDER, kind: "rider" }, { $set: { reviewAccount: true } });
    expect((await ask(app, RIDER, "rider")).status).toBe(200);
    const verified = await verify(app, RIDER, "123456");
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.data.user).toMatchObject({ phone: RIDER, kind: "rider" });
  });

  it("refuses the fixed code for a demo number that a real person already uses", async () => {
    const role = await db.collection("roles").findOne({ name: "customer" });
    await db.collection("users").insertOne({ kind: "customer", roleId: role!._id, phone: CUSTOMER.replace("111", "119"), name: "Real", status: "active", scope: { all: false, warehouseIds: [] }, credentialRevision: 0, createdAt: new Date(), updatedAt: new Date() });
    const real = createApp({ additionalRoutes: await createConsumerRoutes(db, KEY, { mode: "production", mockOTP: false, reviewAccount: { code: "123456", phones: { customer: CUSTOMER.replace("111", "119") } } }) });
    expect((await ask(real, CUSTOMER.replace("111", "119"), "customer")).status).toBe(403);
  });

  it("still needs real SMS for every other number, and is off unless configured", async () => {
    expect((await ask(app, REAL, "customer")).status).toBe(503);
    expect((await verify(app, REAL, "123456")).status).toBe(503);
    const plain = createApp({ additionalRoutes: await createConsumerRoutes(db, KEY, { mode: "production", mockOTP: false }) });
    expect((await ask(plain, CUSTOMER, "customer")).status).toBe(503);
  });
});
