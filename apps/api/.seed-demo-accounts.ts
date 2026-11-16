/* Creates the two demo accounts used for store review (Google Play): a customer and a rider. Pair it with these settings in the API's .env:
 *   REVIEW_OTP=123456  REVIEW_CUSTOMER_PHONE=+919000000111  REVIEW_RIDER_PHONE=+919000000112
 * With them set, those two phones always accept the code 123456 and are never sent an SMS; every other number still gets a real SMS code.
 * Safe to re-run. It never touches a phone that a real person already uses (such an account is skipped with a message).
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-demo-accounts.ts */
import mongoose, { Types } from "mongoose";
import { createRiderIdentity } from "./src/modules/identity/accounts.public.js";

const CUSTOMER = process.env.REVIEW_CUSTOMER_PHONE ?? "+919000000111";
const RIDER = process.env.REVIEW_RIDER_PHONE ?? "+919000000112";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db!;
  const users = db.collection("users");
  const now = new Date();

  // ---- demo customer ----
  const customerRole = await db.collection("roles").findOne({ name: "customer", isSystem: true });
  if (!customerRole) throw new Error("The customer role is missing; start the API once so the roles are created");
  const existingCustomer = await users.findOne({ phone: CUSTOMER, kind: "customer" });
  if (existingCustomer && !existingCustomer.reviewAccount) console.log(`customer ${CUSTOMER}: a real customer already uses this number, skipped. Pick another REVIEW_CUSTOMER_PHONE.`);
  else if (existingCustomer) console.log(`customer ${CUSTOMER}: already there`);
  else {
    await users.insertOne({ _id: new Types.ObjectId(), kind: "customer", roleId: customerRole._id, phone: CUSTOMER, name: "Demo Customer", status: "active", scope: { all: false, warehouseIds: [] }, reviewAccount: true, credentialRevision: 0, createdAt: now, updatedAt: now });
    console.log(`customer ${CUSTOMER}: created (Demo Customer)`);
  }

  // ---- demo rider: a login plus a rider record at the first enabled warehouse ----
  const warehouse = await db.collection("warehouses").findOne({ isEnabled: true });
  if (!warehouse) throw new Error("No enabled warehouse to attach the demo rider to");
  const existingRider = await users.findOne({ phone: RIDER, kind: "rider" });
  if (existingRider && !existingRider.reviewAccount) { console.log(`rider ${RIDER}: a real rider already uses this number, skipped. Pick another REVIEW_RIDER_PHONE.`); }
  else {
    let userId: string;
    if (existingRider) userId = String(existingRider._id);
    else {
      const made = await createRiderIdentity(mongoose.connection).register({ name: "Demo Rider", phone: RIDER });
      if (!made.ok) throw new Error(`Could not create the demo rider login (${made.reason})`);
      userId = made.userId;
    }
    await users.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { reviewAccount: true } });
    if (await db.collection("riders").findOne({ phone: RIDER })) console.log(`rider ${RIDER}: already there`);
    else {
      await db.collection("riders").insertOne({
        _id: new Types.ObjectId().toHexString() as never, userId, name: "Demo Rider", phone: RIDER, zoneId: String(warehouse.zoneId), warehouseIds: [String(warehouse._id)],
        currentWarehouseId: null, vehicle: "Scooter", photoMediaId: null, status: "offline", isActive: true, activeOrderCount: 0, lastLocation: null,
        lastLocationAt: null, lastAssignedAt: null, currentShiftId: null, autoOffline: false, appVersion: null, pendingSyncCount: 0, createdAt: now, updatedAt: now,
      });
      console.log(`rider ${RIDER}: created (Demo Rider at ${String(warehouse.name ?? warehouse._id)})`);
    }
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
