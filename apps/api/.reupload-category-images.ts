/* Dev-only: uploads the 30 numbered category .webp files to the Cloudinary account in CLOUDINARY_URL and points each category at the new image.
 * Use it after changing the Cloudinary account (old images live in the old account). The old media rows are removed from the database.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .reupload-category-images.ts <folder with 01_Name.webp files> */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("pass the folder with the numbered .webp files");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  const files = readdirSync(dir).filter(f => /^\d+_.+\.webp$/i.test(f)).sort();

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db!;
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection: mongoose.connection, media: media.catalogPort });
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

  const categories = await db.collection("categories").find({}).toArray();
  let done = 0;
  for (const f of files) {
    const name = f.replace(/^\d+_/, "").replace(/\.webp$/i, "").replace(/_/g, " ");
    const cat = categories.find(c => c.name === name);
    if (!cat) { console.log("no such category, skipped:", name); continue; }
    const bytes = readFileSync(join(dir, f));
    const t = await media.service.requestUpload(principal, { kind: "category_image", contentType: "image/webp", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "category", id: String(cat._id) } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
    const form = new FormData();
    for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
    form.append("file", new Blob([bytes], { type: "image/webp" }), f);
    const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
    if (!up.ok) throw new Error(`Cloudinary upload failed for ${name} (${up.status}): ${(await up.text()).slice(0, 200)}`);
    await media.service.complete(principal, t.mediaId);
    await catalog.service.updateCategory(String(cat._id), { imageMediaId: t.mediaId });
    // The old image is in the old account: drop its record so nothing keeps pointing at (or trying to delete) a file that is not here.
    if (cat.imageMediaId && String(cat.imageMediaId) !== t.mediaId) await db.collection("media_files").deleteOne({ _id: cat.imageMediaId as never });
    console.log("category image uploaded:", name);
    done++;
  }
  console.log(`done: ${done} of ${files.length}`);
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
