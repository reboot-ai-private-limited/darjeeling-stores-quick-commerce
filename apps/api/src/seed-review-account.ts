import mongoose, { Types } from "mongoose";
import { loadConfig } from "./config/env.js";
import { createAccessStore } from "./modules/access/access.public.js";

/**
 * Creates the App Store / Play Store review customer: the phone in REVIEW_CUSTOMER_PHONE, which signs in with REVIEW_OTP and is never sent an SMS.
 * Safe to run again: it only creates the account, or re-activates one that is already marked as the review account.
 * It never takes over a real customer who happens to have that phone number.
 *   pnpm --filter @darjeeling/api seed:review
 */
async function main() {
  try {
    const config = loadConfig(process.env);
    const phone = config.REVIEW_CUSTOMER_PHONE;
    if (!phone || !config.REVIEW_OTP) throw new Error("Set REVIEW_OTP and REVIEW_CUSTOMER_PHONE in .env first");
    await mongoose.connect(config.MONGODB_URI);
    const access = createAccessStore(mongoose.connection);
    await access.initialize();
    const role = await mongoose.connection.collection("roles").findOne({ name: "customer", isSystem: true });
    if (!role) throw new Error("The customer role is missing");
    const users = mongoose.connection.collection("users");
    const existing = await users.findOne({ phone, kind: "customer" });
    if (existing && !existing.reviewAccount) throw new Error(`${phone} already belongs to a real customer. Pick another REVIEW_CUSTOMER_PHONE.`);
    const now = new Date();
    if (existing) {
      await users.updateOne({ _id: existing._id }, { $set: { status: "active", roleId: role._id, devMockAccount: false, updatedAt: now } });
      console.info(`Review customer already exists (${phone}); made sure it is active.`);
    } else {
      await users.insertOne({
        _id: new Types.ObjectId(), kind: "customer", roleId: role._id, phone, name: "App Review", status: "active",
        scope: { all: false, warehouseIds: [] }, devMockAccount: false, reviewAccount: true, credentialRevision: 0, createdAt: now, updatedAt: now,
      });
      console.info(`Review customer created: ${phone}`);
    }
    console.info(`Sign in on the customer app with ${phone.replace(/^\+91/, "")} and code ${config.REVIEW_OTP}.`);
  } catch (error) {
    console.error(`Seeding the review account failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
void main();
