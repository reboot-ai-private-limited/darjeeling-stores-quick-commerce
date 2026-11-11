/* Dev-only seed: test categories, products, variants and images. Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-catalog.ts */
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

// ---- tiny PNG generator (gradient + soft circles), no dependencies ----
function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]!) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
type RGB = [number, number, number];
function png(size: number, top: RGB, bottom: RGB, accent: RGB, variant: number): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size * (variant ? 0.62 : 0.5), cy = size * 0.52, r = size * (variant ? 0.26 : 0.32);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = y / size;
      let px: RGB = [0, 1, 2].map(i => top[i]! + (bottom[i]! - top[i]!) * t) as RGB;
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) { const a = d > r - 3 ? 0.7 : 0.95; px = px.map((v, i) => v * (1 - a) + accent[i]! * a) as RGB; }
      else if (d < r + size * 0.05) px = px.map((v, i) => v * 0.8 + accent[i]! * 0.2) as RGB;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = px[0]!; raw[o + 1] = px[1]!; raw[o + 2] = px[2]!;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- data ----
interface Prod { name: string; cat: string; desc: string; type: "packaged" | "loose"; food: "veg" | "not_applicable"; gst: number; hsn: string; badge: "bestseller" | "new_launch" | "organic" | null; tags: string[]; highlights: string[]; palette: [RGB, RGB, RGB]; variants: [string, number, string][] }
const CATS = [
  { name: "Tea", sub: ["Black Tea", "Green Tea"] },
  { name: "Snacks", sub: [] },
  { name: "Spices", sub: [] },
  { name: "Gift Boxes", sub: [] },
];
const PRODUCTS: Prod[] = [
  { name: "Darjeeling First Flush Tea", cat: "Black Tea", desc: "Delicate spring-harvest Darjeeling with a bright, muscatel finish.", type: "packaged", food: "veg", gst: 5, hsn: "0902", badge: "bestseller", tags: ["tea", "darjeeling", "first flush"], highlights: ["Hand-picked leaves", "Single estate"], palette: [[232, 190, 110], [140, 90, 40], [255, 244, 214]], variants: [["100 g", 100, "TEA-FF-100"], ["250 g", 250, "TEA-FF-250"], ["500 g", 500, "TEA-FF-500"]] },
  { name: "Darjeeling Second Flush Tea", cat: "Black Tea", desc: "Full-bodied summer harvest with rich amber liquor.", type: "packaged", food: "veg", gst: 5, hsn: "0902", badge: null, tags: ["tea", "second flush"], highlights: ["Rich amber cup", "Muscatel notes"], palette: [[214, 140, 80], [110, 56, 30], [255, 232, 196]], variants: [["100 g", 100, "TEA-SF-100"], ["250 g", 250, "TEA-SF-250"]] },
  { name: "Organic Himalayan Green Tea", cat: "Green Tea", desc: "Lightly steamed organic green tea from high-altitude gardens.", type: "packaged", food: "vegan", gst: 5, hsn: "0902", badge: "organic", tags: ["tea", "green", "organic"], highlights: ["Certified organic", "Fresh and grassy"], palette: [[170, 214, 150], [50, 100, 60], [236, 250, 224]], variants: [["50 g", 50, "TEA-GR-050"], ["100 g", 100, "TEA-GR-100"]] },
  { name: "Masala Chai Blend", cat: "Black Tea", desc: "Strong CTC tea blended with cardamom, ginger and cinnamon.", type: "packaged", food: "veg", gst: 5, hsn: "0902", badge: "new_launch", tags: ["chai", "masala"], highlights: ["Ready to brew", "Warming spices"], palette: [[200, 120, 70], [90, 40, 25], [255, 226, 190]], variants: [["200 g", 200, "TEA-MC-200"], ["500 g", 500, "TEA-MC-500"]] },
  { name: "Himalayan Millet Cookies", cat: "Snacks", desc: "Crunchy butter cookies made with finger millet.", type: "packaged", food: "veg", gst: 12, hsn: "1905", badge: null, tags: ["cookies", "millet"], highlights: ["Baked in small batches"], palette: [[236, 200, 150], [160, 110, 60], [255, 240, 214]], variants: [["150 g", 150, "SNK-MC-150"], ["300 g", 300, "SNK-MC-300"]] },
  { name: "Churpi Cheese Snack", cat: "Snacks", desc: "Traditional dried yak-milk cheese, a chewy high-protein snack.", type: "packaged", food: "veg", gst: 12, hsn: "0406", badge: null, tags: ["churpi", "cheese"], highlights: ["High protein", "Long shelf life"], palette: [[240, 232, 210], [170, 150, 110], [255, 252, 238]], variants: [["100 g", 100, "SNK-CH-100"]] },
  { name: "Sikkim Large Cardamom", cat: "Spices", desc: "Aromatic black cardamom pods from Sikkim.", type: "loose", food: "not_applicable", gst: 5, hsn: "0908", badge: null, tags: ["cardamom", "spice"], highlights: ["Smoky aroma"], palette: [[120, 80, 60], [50, 30, 22], [226, 190, 160]], variants: [["50 g", 50, "SPC-CD-050"], ["100 g", 100, "SPC-CD-100"]] },
  { name: "Darjeeling Tea Gift Box", cat: "Gift Boxes", desc: "A boxed trio of first flush, second flush and green tea.", type: "packaged", food: "veg", gst: 5, hsn: "0902", badge: "bestseller", tags: ["gift", "tea"], highlights: ["Three teas", "Gift-ready box"], palette: [[190, 70, 70], [90, 25, 30], [255, 214, 120]], variants: [["Small (3 x 25 g)", 75, "GFT-TB-S"], ["Large (3 x 100 g)", 300, "GFT-TB-L"]] },
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  await mongoose.connect(process.env.MONGODB_URI);
  const connection = mongoose.connection;
  const media = createMediaModule({ connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection, media: media.catalogPort });
  await media.store.ensureIndexes(); await catalog.store.ensureIndexes();
  const svc = catalog.service;
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

  // categories (skip existing by name)
  const byName = new Map<string, string>();
  const walk = (nodes: { id: string; name: string; children?: unknown[] }[]) => { for (const n of nodes) { byName.set(n.name, n.id); walk((n.children ?? []) as never); } };
  walk((await svc.categoryTree()) as never);
  let order = 0;
  for (const c of CATS) {
    if (!byName.has(c.name)) byName.set(c.name, (await svc.createCategory({ name: c.name, parentId: null, imageMediaId: null, sortOrder: order })).id);
    order++;
    let so = 0;
    for (const s of c.sub) if (!byName.has(s)) byName.set(s, (await svc.createCategory({ name: s, parentId: byName.get(c.name)!, imageMediaId: null, sortOrder: so++ })).id);
  }
  console.log("categories ready:", [...byName.keys()].join(", "));

  let sort = 0;
  for (const p of PRODUCTS) {
    sort++;
    const dup = await svc.checkDuplicate({ name: p.name, skus: p.variants.map(v => v[2]) });
    if (dup.similar.length) { console.log("skip (exists):", p.name); continue; }
    const product = await svc.createProduct({
      name: p.name, description: p.desc, categoryId: byName.get(p.cat)!, type: p.type, stockMode: p.type === "loose" ? "pooled_weight" : "per_variant", tags: p.tags,
      highlights: p.highlights, keyInfo: [{ label: "Shelf life", value: "12 months" }], nutrition: null, infoSections: [{ title: "Storage", body: "Store in a cool, dry place away from sunlight." }],
      variants: p.variants.map(([label, weightGrams, sku]) => ({ label, weightGrams, sku, barcode: null, attributes: [] })),
      gstRate: p.gst, hsnCode: p.hsn, status: "active", sortOrder: sort, brandId: null, foodType: p.food, extraCategoryIds: [], badge: p.badge, isReturnable: true,
    });
    for (let i = 0; i < 2; i++) {
      const bytes = png(800, p.palette[0], p.palette[1], p.palette[2], i);
      const t = await media.service.requestUpload(principal, { kind: "product_image", contentType: "image/png", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "product", id: product.id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
      const form = new FormData();
      for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
      form.append("file", new Blob([bytes], { type: "image/png" }), `${p.name}-${i + 1}.png`);
      const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
      if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
      await media.service.complete(principal, t.mediaId);
      await svc.attachImage(product.id, { mediaId: t.mediaId, alt: `${p.name} photo ${i + 1}` });
    }
    console.log("created:", p.name, `(${p.variants.length} variants, 2 images)`);
  }
  void randomUUID;
  await mongoose.disconnect();
}
main().catch(e => { console.error("SEED FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
