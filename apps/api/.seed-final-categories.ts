/* Dev-only: replaces ALL categories with the final 30 (name + image from the numbered .webp files) and
 * hard-deletes every existing product, its offerings, stock/price history, and the old category/product images.
 * Orders are left untouched. Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-final-categories.ts <folder with 01_Name.webp files> */
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
  if (files.length !== 30) throw new Error(`expected 30 images, found ${files.length}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db!;
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection: mongoose.connection, media: media.catalogPort });
  await media.store.ensureIndexes(); await catalog.store.ensureIndexes();
  const svc = catalog.service;
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

  // 1. remove every product and what hangs off it
  const products = await db.collection("products").find({}).toArray();
  const ids = products.map(p => String(p._id));
  const productMedia = products.flatMap(p => ((p.images ?? []) as { mediaId: string }[]).map(i => i.mediaId));
  console.log(`deleting ${ids.length} products`);
  for (const col of ["warehouse_products", "stock_movements", "price_history"]) {
    const r = await db.collection(col).deleteMany({ productId: { $in: ids } });
    console.log(`  ${col}: ${r.deletedCount}`);
  }
  console.log("  carts emptied:", (await db.collection("carts").updateMany({}, { $set: { items: [] } })).modifiedCount);
  console.log("  products:", (await db.collection("products").deleteMany({})).deletedCount);
  for (const m of productMedia) await media.catalogPort.remove(m, "product_deleted").catch(e => console.log("  image not removed:", m, e instanceof Error ? e.message : e));

  // 2. remove every old category
  const old = await db.collection("categories").find({}).toArray();
  for (const c of old) if (c.imageMediaId) await media.catalogPort.remove(String(c.imageMediaId), "category_deleted").catch(e => console.log("  image not removed:", c.name, e instanceof Error ? e.message : e));
  console.log("old categories removed:", (await db.collection("categories").deleteMany({})).deletedCount);

  // 3. create the 30 new ones with images
  let order = 0;
  for (const f of files) {
    const name = f.replace(/^\d+_/, "").replace(/\.webp$/i, "").replace(/_/g, " ");
    const cat = await svc.createCategory({ name, parentId: null, imageMediaId: null, sortOrder: order++ });
    const bytes = readFileSync(join(dir, f));
    const t = await media.service.requestUpload(principal, { kind: "category_image", contentType: "image/webp", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "category", id: cat.id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
    const form = new FormData();
    for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
    form.append("file", new Blob([bytes], { type: "image/webp" }), f);
    const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
    if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    await media.service.complete(principal, t.mediaId);
    await svc.updateCategory(cat.id, { imageMediaId: t.mediaId });
    console.log("category added:", name);
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
