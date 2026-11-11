/* Dev-only: three sample coupons next to WELCOME10, for every zone WELCOME10 covers. Safe to re-run (skips existing codes).
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-coupons.ts */
import mongoose, { Types } from "mongoose";

const SAMPLES = [
  { code: "SAVE50", type: "flat", value: 5000, maxDiscount: null, minOrder: 39900, description: "Flat ₹50 off on orders above ₹399", firstOrderOnly: false, perUserLimit: 3, totalLimit: 500 },
  { code: "FRESH15", type: "percent", value: 15, maxDiscount: 10000, minOrder: 29900, description: "15% off up to ₹100 on orders above ₹299", firstOrderOnly: false, perUserLimit: 2, totalLimit: 500 },
  { code: "FREEDEL", type: "free_delivery", value: 0, maxDiscount: null, minOrder: 19900, description: "Free delivery on orders above ₹199", firstOrderOnly: false, perUserLimit: 5, totalLimit: 1000 },
];
await mongoose.connect(process.env.MONGODB_URI!);
const col = mongoose.connection.collection("coupons");
const base = await col.findOne({ code: "WELCOME10" });
const zoneIds = (base?.zoneIds as string[] | undefined) ?? [];
const at = new Date();
for (const c of SAMPLES) {
  if (await col.findOne({ code: c.code })) { console.log("exists, skipped:", c.code); continue; }
  await col.insertOne({ _id: new Types.ObjectId().toHexString(), ...c, usedCount: 0, zoneIds, warehouseIds: [], startsAt: at, endsAt: null, isActive: true, createdAt: at, updatedAt: at } as never);
  console.log("coupon created:", c.code);
}
await mongoose.disconnect();
