/* Dev-only: replaces the generated placeholder pictures of the seeded products with real, freely licensed photos (Wikimedia Commons).
 * Credits are kept in each image's alt text. Safe to re-run: products that already have a Commons photo are skipped.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-real-images.ts <folder with img-NN.jpg and manifest.json> */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

/** product name -> picture numbers from the downloaded folder (see manifest.json for source, licence and author) */
const PLAN: Record<string, number[]> = {
  "Darjeeling First Flush Tea": [1, 4],
  "Darjeeling Second Flush Tea": [2],
  "Organic Himalayan Green Tea": [5, 6],
  "Masala Chai Blend": [7, 8],
  "Himalayan Millet Cookies": [9],
  "Churpi Cheese Snack": [12],
  "Sikkim Large Cardamom": [13, 14],
  // "Darjeeling Tea Gift Box": no suitable free photo found, keeps its placeholder.
};

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("pass the folder with the downloaded pictures");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { file: string; license: string; author: string }[];
  const meta = (n: number) => { const f = `img-${String(n).padStart(2, "0")}`; const m = manifest.find(x => x.file.startsWith(f)); if (!m) throw new Error("not in manifest: " + f); return m; };

  await mongoose.connect(process.env.MONGODB_URI);
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection: mongoose.connection, media: media.catalogPort });
  const svc = catalog.service;
  const userId = new Types.ObjectId().toHexString();
  const principal: Principal = { userId, kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };
  const ctx = { actor: { userId, role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } }, requestId: randomUUID() };

  const all = new Map<string, { id: string; name: string }>();
  let cursor: string | undefined;
  do {
    const page = await svc.listProducts({ limit: 100, ...(cursor ? { cursor } : {}) } as never);
    for (const p of page.items) all.set(p.name, { id: p.id, name: p.name });
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  for (const [name, picks] of Object.entries(PLAN)) {
    const found = all.get(name);
    if (!found) { console.log("not found, skipped:", name); continue; }
    const before = (await svc.getProduct(found.id)) as unknown as { images: { mediaId: string; alt: string }[] };
    if (before.images.some(i => i.alt.includes("Wikimedia Commons"))) { console.log("already has real photos, skipped:", name); continue; }
    const added: string[] = [];
    for (const [i, n] of picks.entries()) {
      const m = meta(n);
      const bytes = readFileSync(join(dir, m.file));
      const t = await media.service.requestUpload(principal, { kind: "product_image", contentType: "image/jpeg", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "product", id: found.id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
      const form = new FormData();
      for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
      form.append("file", new Blob([bytes], { type: "image/jpeg" }), `${name}-${i + 1}.jpg`);
      const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
      if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
      await media.service.complete(principal, t.mediaId);
      const credit = `${name} photo ${i + 1}. ${m.author ? m.author + ", " : ""}${m.license}, Wikimedia Commons`.slice(0, 190);
      await svc.attachImage(found.id, { mediaId: t.mediaId, alt: credit });
      added.push(t.mediaId);
    }
    // only after the new pictures are attached, drop the old placeholders
    for (const old of before.images) if (!added.includes(old.mediaId)) await svc.removeImage(ctx as never, found.id, old.mediaId);
    console.log("updated:", name, `(${picks.length} real photo${picks.length > 1 ? "s" : ""}, ${before.images.length} placeholder${before.images.length > 1 ? "s" : ""} removed)`);
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
