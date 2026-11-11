/* Dev-only: gives every category a real, freely licensed photo (Wikimedia Commons; credit in the manifest).
 * Safe to re-run: categories that already have a photo are skipped.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-category-images.ts <folder with category-manifest.json> */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

/** category name -> { file relative to the folder, licence, author } */
type Entry = { category: string; file: string; license: string; author: string };

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("pass the folder with category-manifest.json");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  const entries = JSON.parse(readFileSync(join(dir, "category-manifest.json"), "utf8")) as Entry[];

  await mongoose.connect(process.env.MONGODB_URI);
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection: mongoose.connection, media: media.catalogPort });
  const svc = catalog.service;
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

  const flat: { id: string; name: string; imageMediaId: string | null }[] = [];
  const walk = (nodes: { id: string; name: string; imageMediaId: string | null; children?: unknown[] }[]) => { for (const n of nodes) { flat.push(n); walk((n.children ?? []) as never); } };
  walk((await svc.categoryTree()) as never);

  for (const e of entries) {
    const cat = flat.find(c => c.name === e.category);
    if (!cat) { console.log("no such category, skipped:", e.category); continue; }
    if (cat.imageMediaId) { console.log("already has a photo, skipped:", e.category); continue; }
    const bytes = readFileSync(join(dir, e.file));
    const t = await media.service.requestUpload(principal, { kind: "category_image", contentType: "image/jpeg", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "category", id: cat.id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
    const form = new FormData();
    for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), `${e.category}.jpg`);
    const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
    if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    await media.service.complete(principal, t.mediaId);
    await svc.updateCategory(cat.id, { imageMediaId: t.mediaId });
    console.log("photo added:", e.category, `(${e.license}${e.author ? ", " + e.author : ""})`);
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
