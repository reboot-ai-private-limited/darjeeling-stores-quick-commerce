/* One-time cleanup after the audit log and staff 2FA were removed from the API.
 *  - takes the retired "audit:view" permission out of every role (a role that still lists it can no longer be managed)
 *  - removes the leftover 2FA fields (secrets, recovery hashes) from user records and deletes pending staff-auth challenges
 *  - reports how many old audit records exist; they are NOT deleted unless you pass --drop-audit-log (irreversible)
 * Safe to run more than once.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .migrate-remove-audit-2fa.ts [--drop-audit-log] */
import mongoose from "mongoose";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  const dropLog = process.argv.includes("--drop-audit-log");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db!;

  const roles = await db.collection("roles").updateMany({ permissions: "audit:view" }, { $pull: { permissions: "audit:view" } as never });
  console.log(`roles cleaned of audit:view: ${roles.modifiedCount}`);

  const users = await db.collection("users").updateMany({ twoFactor: { $exists: true } }, { $unset: { twoFactor: "" } });
  console.log(`users with 2FA fields removed: ${users.modifiedCount}`);

  const challenges = await db.collection("staff_auth_challenges").deleteMany({});
  console.log(`pending staff sign-in challenges deleted: ${challenges.deletedCount}`);

  const exists = (await db.listCollections({ name: "audit_log" }).toArray()).length > 0;
  if (!exists) console.log("no audit_log collection");
  else if (dropLog) { await db.collection("audit_log").drop(); console.log("audit_log collection dropped"); }
  else console.log(`audit_log still holds ${await db.collection("audit_log").countDocuments()} old record(s); nothing reads or writes it now. Re-run with --drop-audit-log to delete them.`);
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
