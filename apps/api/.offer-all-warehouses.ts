/* Dev-only: offers every active product in every enabled warehouse that does not sell it yet, copying the price and MRP of an existing offering
 * (so all warehouses show the same DEMO prices) with 40 units of stock per size (packaged) or 30 kg (loose). Safe to re-run: existing offerings are skipped.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .offer-all-warehouses.ts */
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv } from "./src/modules/media/media.public.js";
import { createOfferingsModule, productDirectoryFrom } from "./src/modules/offerings/offerings.public.js";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  await mongoose.connect(process.env.MONGODB_URI);
  const connection = mongoose.connection;
  const db = connection.db!;
  const media = createMediaModule({ connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection, media: media.catalogPort });

  const whDocs = await db.collection("warehouses").find({ isEnabled: true }).toArray();
  if (whDocs.length === 0) throw new Error("no enabled warehouse");
  const whById = new Map(whDocs.map(w => [String(w._id), { id: String(w._id), zoneId: String(w.zoneId), isEnabled: true }]));
  const offerings = createOfferingsModule({ connection, products: productDirectoryFrom(catalog), warehouses: { get: async id => whById.get(id) ?? null } });
  await offerings.store.ensureIndexes?.();
  const userId = new Types.ObjectId().toHexString();

  const products = await db.collection("products").find({ status: "active" }).toArray();
  const all = await db.collection("warehouse_products").find({}).toArray();
  let created = 0, skipped = 0;
  for (const wh of whById.values()) {
    const ctx = { actor: { userId, role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [wh.id] } }, requestId: randomUUID() };
    for (const p of products) {
      const pid = String(p._id);
      if (all.some(o => o.warehouseId === wh.id && o.productId === pid)) { skipped++; continue; }
      const template = all.find(o => o.productId === pid);
      if (!template) { console.log("no price to copy, skipped:", p.name); continue; }
      const loose = p.type === "loose";
      await offerings.offerings.create(ctx as never, {
        warehouseId: wh.id, productId: pid, stockGrams: loose ? 30000 : null,
        variants: (template.variants as { variantId: string; price: number; mrp: number }[]).map(v => ({ variantId: v.variantId, price: v.price, mrp: v.mrp, salePrice: null, saleStart: null, saleEnd: null, stock: loose ? null : 40, maxQtyPerOrder: null })),
      });
      created++;
      console.log("offered:", p.name, "->", [...whById.values()].length > 1 ? String(whDocs.find(w => String(w._id) === wh.id)?.name) : wh.id);
    }
  }
  console.log(`done: ${created} new offerings, ${skipped} already existed`);
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
