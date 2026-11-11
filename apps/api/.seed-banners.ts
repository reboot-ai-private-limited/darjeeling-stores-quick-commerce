/* Dev-only: creates four home banners (picture + link to a category) for every zone. Safe to re-run: banners with the same title are skipped.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-banners.ts <folder with banner1.jpg ... banner4.jpg> */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

const BANNERS = [
  { file: "banner1.jpg", title: "Darjeeling tea, fresh from the hills", category: "Tea" },
  { file: "banner2.jpg", title: "Farm-fresh vegetables daily", category: "Fresh" },
  { file: "banner3.jpg", title: "Sweet hill oranges and fresh fruit", category: "Fruits" },
  { file: "banner4.jpg", title: "Gift boxes for every occasion", category: "Gift Boxes" },
];

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("pass the folder with the banner pictures");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  await mongoose.connect(process.env.MONGODB_URI);
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection: mongoose.connection, media: media.catalogPort });
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };
  const flat: { id: string; name: string }[] = [];
  const walk = (nodes: { id: string; name: string; children?: unknown[] }[]) => { for (const n of nodes) { flat.push(n); walk((n.children ?? []) as never); } };
  walk((await catalog.service.categoryTree()) as never);
  const col = mongoose.connection.collection("banners");
  await col.createIndex({ isActive: 1, sortOrder: 1 });

  let order = 0;
  for (const b of BANNERS) {
    order++;
    if (await col.findOne({ title: b.title })) { console.log("exists, skipped:", b.title); continue; }
    const category = flat.find(c => c.name === b.category);
    const id = new Types.ObjectId().toHexString();
    const bytes = readFileSync(join(dir, b.file));
    const t = await media.service.requestUpload(principal, { kind: "banner", contentType: "image/jpeg", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "banner", id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
    const form = new FormData();
    for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), b.file);
    const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
    if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    await media.service.complete(principal, t.mediaId);
    await media.service.claimOwned({ mediaId: t.mediaId, userId: principal.userId, kind: "banner", owner: { type: "banner", id } });
    const at = new Date();
    await col.insertOne({ _id: id, title: b.title, imageMediaId: t.mediaId, link: category ? { type: "category", id: category.id } : null, zoneId: null, sortOrder: order, startsAt: null, endsAt: null, isActive: true, createdAt: at, updatedAt: at } as never);
    console.log("banner created:", b.title, "->", b.category);
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
