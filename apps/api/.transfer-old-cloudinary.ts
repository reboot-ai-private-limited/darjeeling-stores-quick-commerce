/* Dev-only: copies banner and brand-logo images from the OLD Cloudinary account (still reachable by its public links) to the account in CLOUDINARY_URL,
 * and points each banner/brand at its new image. The old media rows are removed from the database; the old files are left where they are.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .transfer-old-cloudinary.ts <old cloud name> */
import mongoose, { Types } from "mongoose";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

const OLD = process.argv[2];
async function main() {
  if (!OLD) throw new Error("pass the old Cloudinary cloud name");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db!;
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

  const jobs = [
    { collection: "banners", field: "imageMediaId", kind: "banner", owner: "banner" },
    { collection: "brands", field: "logoMediaId", kind: "brand_logo", owner: "brand" },
  ] as const;
  for (const job of jobs) {
    let done = 0, failed = 0;
    for (const doc of await db.collection(job.collection).find({}).toArray()) {
      const oldId = doc[job.field] as string | null;
      if (!oldId) continue;
      const old = await db.collection("media_files").findOne({ _id: oldId as never });
      if (!old) { console.log(`${job.collection} ${doc.name ?? doc.title}: media row missing, skipped`); failed++; continue; }
      // A large JPEG copy of the old image (Cloudinary makes it on the fly from the original).
      const res = await fetch(`https://res.cloudinary.com/${OLD}/image/upload/c_limit,w_1600,f_jpg,q_90/${old.storage.key}`);
      if (!res.ok) { console.log(`${job.collection} ${doc.name ?? doc.title}: old image not reachable (${res.status}), skipped`); failed++; continue; }
      const bytes = Buffer.from(await res.arrayBuffer());
      const t = await media.service.requestUpload(principal, { kind: job.kind, contentType: "image/jpeg", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: job.owner, id: String(doc._id) } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
      const form = new FormData();
      for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
      form.append("file", new Blob([bytes], { type: "image/jpeg" }), `${doc.name ?? doc.title ?? "image"}.jpg`);
      const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
      if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
      await media.service.complete(principal, t.mediaId);
      await db.collection(job.collection).updateOne({ _id: doc._id }, { $set: { [job.field]: t.mediaId, updatedAt: new Date() } });
      await db.collection("media_files").deleteOne({ _id: oldId as never });
      console.log(`${job.collection} moved: ${doc.name ?? doc.title}`);
      done++;
    }
    console.log(`${job.collection}: ${done} moved, ${failed} skipped`);
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
