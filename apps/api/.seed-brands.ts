/* Dev-only: creates a few brands with generated logos and gives every existing product a brand.
 * The brand names are made up for the demo store. Safe to re-run: brands that exist are reused, products that already have a brand are left alone.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-brands.ts */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";

// sharp lives in the pnpm store, not in this package; find it there (dev script only).
const pnpmDir = join(process.cwd(), "../../node_modules/.pnpm");
const sharpDir = readdirSync(pnpmDir).find(d => d.startsWith("sharp@"));
if (!sharpDir) throw new Error("sharp was not found in node_modules/.pnpm");
const sharp = createRequire(import.meta.url)(join(pnpmDir, sharpDir, "node_modules/sharp")) as typeof import("sharp");

interface BrandDef { name: string; initials: string; color: string; accent: string; products: string[] }
const BRANDS: BrandDef[] = [
  { name: "Cloud Forest Tea", initials: "CF", color: "#1f5c3a", accent: "#ffc933", products: ["Darjeeling First Flush Tea", "Darjeeling Second Flush Tea", "Organic Himalayan Green Tea", "Masala Chai Blend", "Darjeeling Tea Gift Box"] },
  { name: "Sherpa Pantry", initials: "SP", color: "#401815", accent: "#ffc933", products: ["Himalayan Millet Cookies", "Churpi Cheese Snack", "Whole Wheat Bread"] },
  { name: "Kanchenjunga Foods", initials: "KF", color: "#8a2c1f", accent: "#fff4d1", products: ["Sikkim Large Cardamom", "Whole Wheat Atta", "Toor Dal", "Basmati Rice", "Almonds", "Mango Pickle"] },
  { name: "Tenzing Farms", initials: "TF", color: "#2f7d32", accent: "#ffe08a", products: ["Tomato", "Red Onion", "Potato", "Carrot", "Cauliflower", "Spinach", "Broccoli", "Cucumber", "Fresh Coriander", "Ginger"] },
  { name: "Hill Harvest", initials: "HH", color: "#c2491d", accent: "#fff1c9", products: ["Banana", "Red Apple", "Darjeeling Orange", "Pomegranate", "Strawberry"] },
  { name: "Lepcha Dairy", initials: "LD", color: "#2e6fa6", accent: "#ffffff", products: ["Farm Eggs", "Fresh Paneer", "Fresh Milk", "Salted Butter"] },
  { name: "Mist & Mountain", initials: "MM", color: "#4a3f6b", accent: "#ffc933", products: ["Coffee Beans", "Orange Juice", "Pure Honey"] },
];

/** A square logo: a rounded tile in the brand colour with the initials, drawn from SVG so no image files are needed. */
async function logo(b: BrandDef): Promise<Buffer> {
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" rx="112" fill="${b.color}"/>
    <circle cx="256" cy="256" r="196" fill="none" stroke="${b.accent}" stroke-width="10" opacity="0.55"/>
    <text x="256" y="300" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="190" fill="${b.accent}">${b.initials}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  await mongoose.connect(process.env.MONGODB_URI);
  const media = createMediaModule({ connection: mongoose.connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection: mongoose.connection, media: media.catalogPort });
  const svc = catalog.service;
  const principal: Principal = { userId: new Types.ObjectId().toHexString(), kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };

  const existing = new Map((await svc.listBrands()).map(b => [b.name, b]));
  const ids = new Map<string, string>();
  let order = existing.size;
  for (const def of BRANDS) {
    let brand = existing.get(def.name);
    if (!brand) {
      brand = await svc.createBrand({ name: def.name, logoMediaId: null, sortOrder: order++ });
      console.log("brand created:", def.name);
    } else console.log("brand exists:", def.name);
    ids.set(def.name, brand.id);
    if (!brand.logoMediaId) {
      const bytes = await logo(def);
      const t = await media.service.requestUpload(principal, { kind: "brand_logo", contentType: "image/png", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "brand", id: brand.id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
      const form = new FormData();
      for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${def.name}.png`);
      const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
      if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
      await media.service.complete(principal, t.mediaId);
      await svc.updateBrand(brand.id, { logoMediaId: t.mediaId });
      console.log("  logo added");
    }
  }

  const byProduct = new Map<string, string>();
  for (const def of BRANDS) for (const p of def.products) byProduct.set(p, def.name);
  let assigned = 0;
  const unmatched: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await svc.listProducts({ limit: 100, ...(cursor ? { cursor } : {}) } as never) as { items: { id: string; name: string; brandId?: string | null; brand?: { id: string } | null }[]; nextCursor: string | null };
    for (const p of page.items) {
      if (p.brandId || p.brand) continue;
      const brandName = byProduct.get(p.name);
      if (!brandName) { unmatched.push(p.name); continue; }
      await svc.updateProduct(p.id, { brandId: ids.get(brandName)! } as never);
      assigned++;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  console.log(`products given a brand: ${assigned}`);
  if (unmatched.length) console.log("left without a brand:", unmatched.join(", "));
  await mongoose.disconnect();
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
