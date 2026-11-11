/* Dev-only: adds fresh produce, dairy, bakery, staples, beverages, dry fruits and pickles with real, freely licensed photos
 * (Wikimedia Commons; credit kept in each image's alt text), and offers them in the first warehouse so the apps show them.
 * Safe to re-run: products that already exist are skipped. A product whose photo is missing from the folder is skipped too.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-fresh.ts <folder with imgs/ and manifest.json> */
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";
import { createOfferingsModule, productDirectoryFrom } from "./src/modules/offerings/offerings.public.js";

type Food = "veg" | "non_veg" | "egg" | "vegan" | "not_applicable";
type Badge = "bestseller" | "trending" | "new_launch" | "imported" | "organic" | null;
/** variant: [label, grams, sku, price in rupees, mrp in rupees] */
interface Prod { name: string; img: string; cat: string; desc: string; type: "packaged" | "loose"; food: Food; gst: number; hsn: string; badge: Badge; tags: string[]; highlights: string[]; shelf: string; storage: string; returnable: boolean; variants: [string, number, string, number, number][] }

const CATS: { name: string; sub: string[] }[] = [
  { name: "Fresh", sub: ["Vegetables", "Fruits", "Herbs"] },
  { name: "Dairy & Eggs", sub: [] },
  { name: "Bakery", sub: [] },
  { name: "Staples", sub: [] },
  { name: "Beverages", sub: [] },
  { name: "Dry Fruits", sub: [] },
  { name: "Pickles & Preserves", sub: [] },
];

const FRESH_STORE = "Keep in the fridge and use within 2 to 3 days. Wash before use.";
const P = (o: Partial<Prod> & Pick<Prod, "name" | "img" | "cat" | "desc" | "variants">): Prod => ({
  type: "loose", food: "veg", gst: 0, hsn: "0709", badge: null, tags: [], highlights: [], shelf: "2-3 days", storage: FRESH_STORE, returnable: false, ...o,
});
const PRODUCTS: Prod[] = [
  P({ name: "Tomato", img: "Tomato", cat: "Vegetables", desc: "Ripe, juicy tomatoes for curries, salads and chutneys.", tags: ["tomato", "vegetable"], highlights: ["Farm fresh", "Sorted by hand"], variants: [["250 g", 250, "FRV-TOM-250", 14, 18], ["500 g", 500, "FRV-TOM-500", 26, 32], ["1 kg", 1000, "FRV-TOM-1000", 48, 60]] }),
  P({ name: "Red Onion", img: "Onion", cat: "Vegetables", desc: "Firm red onions with a sharp, sweet bite.", tags: ["onion", "vegetable"], highlights: ["Long lasting"], shelf: "2 weeks", storage: "Keep in a cool, dry, airy place.", variants: [["500 g", 500, "FRV-ONI-500", 22, 28], ["1 kg", 1000, "FRV-ONI-1000", 40, 50], ["2 kg", 2000, "FRV-ONI-2000", 78, 96]] }),
  P({ name: "Potato", img: "Potato", cat: "Vegetables", desc: "All-purpose potatoes for fries, curries and parathas.", tags: ["potato", "vegetable"], highlights: ["Everyday staple"], shelf: "2 weeks", storage: "Keep in a cool, dark, dry place.", badge: "bestseller", variants: [["500 g", 500, "FRV-POT-500", 20, 25], ["1 kg", 1000, "FRV-POT-1000", 36, 45], ["2 kg", 2000, "FRV-POT-2000", 70, 85]] }),
  P({ name: "Carrot", img: "Carrot", cat: "Vegetables", desc: "Crunchy, sweet orange carrots, good raw or cooked.", tags: ["carrot", "vegetable"], highlights: ["Sweet and crunchy"], variants: [["250 g", 250, "FRV-CAR-250", 16, 20], ["500 g", 500, "FRV-CAR-500", 30, 38], ["1 kg", 1000, "FRV-CAR-1000", 56, 70]] }),
  P({ name: "Cauliflower", img: "Cauliflower", cat: "Vegetables", desc: "Tight white heads of cauliflower from hill farms.", tags: ["cauliflower", "vegetable"], highlights: ["Fresh heads"], variants: [["500 g", 500, "FRV-CAU-500", 30, 38], ["1 kg", 1000, "FRV-CAU-1000", 56, 70]] }),
  P({ name: "Spinach", img: "Spinach", cat: "Vegetables", desc: "Tender green spinach leaves, rich in iron.", tags: ["spinach", "leafy", "palak"], highlights: ["Tender leaves"], shelf: "1-2 days", variants: [["250 g", 250, "FRV-SPI-250", 18, 22], ["500 g", 500, "FRV-SPI-500", 34, 42]] }),
  P({ name: "Broccoli", img: "Broccoli", cat: "Vegetables", desc: "Dense green broccoli crowns for steaming, stir-fries and soups.", tags: ["broccoli", "vegetable"], highlights: ["Rich in vitamin C"], badge: "new_launch", variants: [["250 g", 250, "FRV-BRO-250", 45, 55], ["500 g", 500, "FRV-BRO-500", 85, 105]] }),
  P({ name: "Cucumber", img: "Cucumber", cat: "Vegetables", desc: "Cool, crisp cucumbers for salads and raita.", tags: ["cucumber", "salad"], highlights: ["Crisp and cool"], variants: [["500 g", 500, "FRV-CUC-500", 24, 30], ["1 kg", 1000, "FRV-CUC-1000", 44, 55]] }),
  P({ name: "Fresh Coriander", img: "Fresh_Coriander", cat: "Herbs", desc: "A fragrant bunch of coriander leaves to finish any dish.", tags: ["coriander", "dhania", "herb"], highlights: ["Strong aroma"], shelf: "1-2 days", variants: [["100 g", 100, "FRH-COR-100", 12, 15], ["250 g", 250, "FRH-COR-250", 28, 35]] }),
  P({ name: "Ginger", img: "Ginger", cat: "Herbs", desc: "Fresh, pungent ginger root for chai and cooking.", tags: ["ginger", "adrak"], highlights: ["Strong and spicy"], shelf: "1-2 weeks", variants: [["100 g", 100, "FRH-GIN-100", 14, 18], ["250 g", 250, "FRH-GIN-250", 32, 40]] }),
  P({ name: "Banana", img: "Banana", cat: "Fruits", desc: "Sweet ripe bananas, a quick and filling snack.", hsn: "0803", tags: ["banana", "fruit"], highlights: ["Naturally sweet"], badge: "bestseller", shelf: "2-3 days", variants: [["500 g", 500, "FRF-BAN-500", 28, 35], ["1 kg", 1000, "FRF-BAN-1000", 52, 65]] }),
  P({ name: "Red Apple", img: "Apple", cat: "Fruits", desc: "Crisp, juicy red apples.", hsn: "0808", tags: ["apple", "fruit"], highlights: ["Crisp and juicy"], shelf: "1 week", variants: [["500 g", 500, "FRF-APP-500", 80, 100], ["1 kg", 1000, "FRF-APP-1000", 150, 185]] }),
  P({ name: "Darjeeling Orange", img: "Darjeeling_Orange", cat: "Fruits", desc: "Sweet and tangy hill oranges, easy to peel.", hsn: "0805", tags: ["orange", "mandarin", "darjeeling"], highlights: ["Grown in the hills"], badge: "trending", shelf: "1 week", variants: [["500 g", 500, "FRF-ORA-500", 70, 90], ["1 kg", 1000, "FRF-ORA-1000", 130, 165]] }),
  P({ name: "Pomegranate", img: "Pomegranate", cat: "Fruits", desc: "Ruby-red pomegranates packed with sweet seeds.", hsn: "0810", tags: ["pomegranate", "anar", "fruit"], highlights: ["Sweet red seeds"], shelf: "1 week", variants: [["500 g", 500, "FRF-POM-500", 95, 120], ["1 kg", 1000, "FRF-POM-1000", 180, 220]] }),
  P({ name: "Strawberry", img: "Strawberry", cat: "Fruits", desc: "Sweet, fragrant strawberries, picked ripe.", hsn: "0810", tags: ["strawberry", "fruit"], highlights: ["Picked ripe"], badge: "new_launch", shelf: "1-2 days", variants: [["250 g", 250, "FRF-STR-250", 75, 95], ["500 g", 500, "FRF-STR-500", 140, 175]] }),
  P({ name: "Farm Eggs", img: "Eggs", cat: "Dairy & Eggs", desc: "Fresh brown farm eggs.", type: "packaged", food: "egg", hsn: "0407", gst: 0, tags: ["eggs", "anda"], highlights: ["Farm fresh", "High protein"], shelf: "2 weeks", storage: "Keep in the fridge.", variants: [["6 eggs", 330, "DRY-EGG-6", 55, 62], ["12 eggs", 660, "DRY-EGG-12", 105, 120], ["30 eggs (tray)", 1650, "DRY-EGG-30", 250, 280]] }),
  P({ name: "Fresh Paneer", img: "Paneer", cat: "Dairy & Eggs", desc: "Soft, fresh cottage cheese for curries and snacks.", type: "packaged", hsn: "0406", gst: 5, tags: ["paneer", "cheese"], highlights: ["Soft and fresh", "High protein"], shelf: "5 days", storage: "Keep refrigerated.", variants: [["200 g", 200, "DRY-PAN-200", 85, 95], ["500 g", 500, "DRY-PAN-500", 205, 230]] }),
  P({ name: "Fresh Milk", img: "Fresh_Milk", cat: "Dairy & Eggs", desc: "Pasteurised full-cream cow milk.", type: "packaged", hsn: "0401", gst: 0, tags: ["milk", "dairy"], highlights: ["Full cream"], shelf: "2 days", storage: "Keep refrigerated and boil before use.", variants: [["500 ml", 520, "DRY-MLK-500", 30, 32], ["1 L", 1040, "DRY-MLK-1000", 58, 62]] }),
  P({ name: "Salted Butter", img: "Butter", cat: "Dairy & Eggs", desc: "Creamy salted table butter.", type: "packaged", hsn: "0405", gst: 12, tags: ["butter", "dairy"], highlights: ["Rich and creamy"], shelf: "6 months", storage: "Keep refrigerated.", returnable: true, variants: [["100 g", 100, "DRY-BUT-100", 56, 60], ["500 g", 500, "DRY-BUT-500", 265, 285]] }),
  P({ name: "Whole Wheat Bread", img: "Bread", cat: "Bakery", desc: "Soft, sliced whole wheat bread baked fresh.", type: "packaged", hsn: "1905", gst: 0, tags: ["bread", "bakery"], highlights: ["Baked fresh", "Whole grain"], shelf: "3 days", storage: "Keep in a cool, dry place and finish within 3 days.", variants: [["400 g loaf", 400, "BAK-BRD-400", 45, 50]] }),
  P({ name: "Whole Wheat Atta", img: "Whole_Wheat_Atta", cat: "Staples", desc: "Stone-ground whole wheat flour for soft rotis.", type: "packaged", hsn: "1101", gst: 0, tags: ["atta", "flour", "wheat"], highlights: ["Stone ground"], shelf: "3 months", storage: "Store in an airtight container.", returnable: true, variants: [["1 kg", 1000, "STP-ATA-1", 55, 62], ["5 kg", 5000, "STP-ATA-5", 255, 290]] }),
  P({ name: "Toor Dal", img: "Toor_Dal", cat: "Staples", desc: "Split pigeon peas, the base of everyday dal.", type: "packaged", hsn: "0713", gst: 0, tags: ["dal", "toor", "lentils"], highlights: ["Cleaned and sorted"], shelf: "12 months", storage: "Store in an airtight container.", returnable: true, variants: [["500 g", 500, "STP-TOO-500", 85, 95], ["1 kg", 1000, "STP-TOO-1000", 165, 185]] }),
  P({ name: "Basmati Rice", img: "Basmati_Rice", cat: "Staples", desc: "Long-grain aromatic basmati rice.", type: "packaged", hsn: "1006", gst: 5, tags: ["rice", "basmati"], highlights: ["Long grains", "Aromatic"], shelf: "12 months", storage: "Store in an airtight container.", returnable: true, variants: [["1 kg", 1000, "STP-RIC-1", 120, 135], ["5 kg", 5000, "STP-RIC-5", 575, 650]] }),
  P({ name: "Coffee Beans", img: "Coffee_Beans", cat: "Beverages", desc: "Medium-roast whole coffee beans.", type: "packaged", hsn: "0901", gst: 5, tags: ["coffee", "beans"], highlights: ["Medium roast"], shelf: "9 months", storage: "Keep sealed in a cool, dry place.", returnable: true, variants: [["250 g", 250, "BEV-COF-250", 320, 380], ["500 g", 500, "BEV-COF-500", 610, 720]] }),
  P({ name: "Orange Juice", img: "Orange_Juice", cat: "Beverages", desc: "Refreshing orange juice, no added sugar.", type: "packaged", hsn: "2009", gst: 12, tags: ["juice", "orange"], highlights: ["No added sugar"], shelf: "6 months", storage: "Refrigerate after opening.", returnable: true, variants: [["1 L", 1050, "BEV-OJ-1000", 110, 125]] }),
  P({ name: "Almonds", img: "Almonds", cat: "Dry Fruits", desc: "Crunchy, protein-rich almonds.", hsn: "0802", gst: 5, tags: ["almonds", "badam", "dry fruit"], highlights: ["Rich in protein"], shelf: "6 months", storage: "Store in an airtight container.", returnable: true, variants: [["100 g", 100, "DRF-ALM-100", 95, 115], ["250 g", 250, "DRF-ALM-250", 230, 275], ["500 g", 500, "DRF-ALM-500", 450, 540]] }),
  P({ name: "Mango Pickle", img: "Mango_Pickle", cat: "Pickles & Preserves", desc: "Spicy, tangy raw-mango pickle in mustard oil.", type: "packaged", hsn: "2001", gst: 12, tags: ["pickle", "achar", "mango"], highlights: ["Tangy and spicy"], shelf: "12 months", storage: "Keep the lid tight; use a dry spoon.", returnable: true, variants: [["400 g", 400, "PKL-MNG-400", 140, 160]] }),
  P({ name: "Pure Honey", img: "Honey", cat: "Pickles & Preserves", desc: "Natural honey, unheated and unprocessed.", type: "packaged", hsn: "0409", gst: 5, tags: ["honey", "shahad"], highlights: ["Natural", "Unprocessed"], shelf: "24 months", storage: "Store at room temperature.", returnable: true, variants: [["250 g", 250, "PKL-HON-250", 180, 210], ["500 g", 500, "PKL-HON-500", 340, 400]] }),
];

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("pass the folder with imgs/ and manifest.json");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { name: string; file: string; license: string; author: string }[];
  const photo = (key: string) => manifest.find(m => m.name.replace(/\W+/g, "_") === key || m.name === key);

  await mongoose.connect(process.env.MONGODB_URI);
  const connection = mongoose.connection;
  const media = createMediaModule({ connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection, media: media.catalogPort });
  await media.store.ensureIndexes(); await catalog.store.ensureIndexes();
  const svc = catalog.service;
  const warehouseDoc = await connection.db!.collection("warehouses").findOne({ isEnabled: true });
  if (!warehouseDoc) throw new Error("no enabled warehouse to offer the products in");
  const warehouseId = String(warehouseDoc._id), zoneId = String(warehouseDoc.zoneId);
  const offerings = createOfferingsModule({
    connection, products: productDirectoryFrom(catalog),
    warehouses: { get: async id => (id === warehouseId ? { id, zoneId, isEnabled: true } : null) },
  });
  await offerings.store.ensureIndexes?.();
  const userId = new Types.ObjectId().toHexString();
  const principal: Principal = { userId, kind: "staff", role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [] } };
  const ctx = { actor: { userId, role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [warehouseId] } }, requestId: randomUUID() };

  const byName = new Map<string, string>();
  const walk = (nodes: { id: string; name: string; children?: unknown[] }[]) => { for (const n of nodes) { byName.set(n.name, n.id); walk((n.children ?? []) as never); } };
  walk((await svc.categoryTree()) as never);
  let order = byName.size;
  for (const c of CATS) {
    if (!byName.has(c.name)) byName.set(c.name, (await svc.createCategory({ name: c.name, parentId: null, imageMediaId: null, sortOrder: order++ })).id);
    let so = 0;
    for (const s of c.sub) if (!byName.has(s)) byName.set(s, (await svc.createCategory({ name: s, parentId: byName.get(c.name)!, imageMediaId: null, sortOrder: so++ })).id);
  }
  console.log("categories ready:", [...byName.keys()].join(", "));

  let sort = 100, created = 0;
  for (const p of PRODUCTS) {
    sort++;
    const m = photo(p.img);
    if (!m || !existsSync(join(dir, m.file))) { console.log("no photo, skipped:", p.name); continue; }
    const dup = await svc.checkDuplicate({ name: p.name, skus: p.variants.map(v => v[2]) });
    if (dup.similar.length) { console.log("exists, skipped:", p.name); continue; }
    const loose = p.type === "loose";
    const product = await svc.createProduct({
      name: p.name, description: p.desc, categoryId: byName.get(p.cat)!, type: p.type, stockMode: loose ? "pooled_weight" : "per_variant", tags: p.tags,
      highlights: p.highlights, keyInfo: [{ label: "Shelf life", value: p.shelf }], nutrition: null, infoSections: [{ title: "Storage", body: p.storage }],
      variants: p.variants.map(([label, weightGrams, sku]) => ({ label, weightGrams, sku, barcode: null, attributes: [] })),
      gstRate: p.gst, hsnCode: p.hsn, status: "active", sortOrder: sort, brandId: null, foodType: p.food, extraCategoryIds: [], badge: p.badge, isReturnable: p.returnable,
    });
    const bytes = readFileSync(join(dir, m.file));
    const t = await media.service.requestUpload(principal, { kind: "product_image", contentType: "image/jpeg", sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "product", id: product.id } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
    const form = new FormData();
    for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), `${p.name}.jpg`);
    const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
    if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    await media.service.complete(principal, t.mediaId);
    const credit = `${p.name}. ${m.author ? m.author + ", " : ""}${m.license}, Wikimedia Commons`.slice(0, 190);
    await svc.attachImage(product.id, { mediaId: t.mediaId, alt: credit });

    const full = (await svc.getProduct(product.id)) as unknown as { variants: { id: string; sku: string }[] };
    const idOf = (sku: string) => full.variants.find(v => v.sku === sku)!.id;
    await offerings.offerings.create(ctx as never, {
      warehouseId, productId: product.id, stockGrams: loose ? 30000 : null,
      variants: p.variants.map(([, , sku, price, mrp]) => ({ variantId: idOf(sku), price: price * 100, mrp: mrp * 100, salePrice: null, saleStart: null, saleEnd: null, stock: loose ? null : 40, maxQtyPerOrder: null })),
    });
    created++;
    console.log("created + offered:", p.name, `(${p.cat}, ${p.variants.length} sizes)`);
  }
  console.log(`done: ${created} new products`);
  await mongoose.disconnect();
}
main().catch(e => { console.error("SEED FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
