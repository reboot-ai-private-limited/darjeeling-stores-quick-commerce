/* Dev-only: adds the 39 "Darjeeling Store" products (biscuits, crackers, wafers, sweets, fruit drinks, breakfast) to the existing categories,
 * and offers each in the first enabled warehouse. PRICES, SIZES, GST AND STOCK ARE PLACEHOLDERS: edit them in admin.
 * Optional second argument: a folder holding `<NN>.jpg|png|webp` (NN = the product's number 01..39); a product with a matching file gets it as its photo.
 * Safe to re-run: a product that exists is skipped, and a photo is only added to a product that has none.
 * Run: pnpm -C apps/api exec tsx --env-file=../../.env .seed-store-39.ts [folder with 01.jpg ... 39.jpg] */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";
import { createOfferingsModule, productDirectoryFrom } from "./src/modules/offerings/offerings.public.js";

type Food = "veg" | "egg";
/** variant: [label, grams, sku suffix, price in rupees, mrp in rupees] */
interface Item { n: string; name: string; cat: string; food?: Food; desc: string; gst: number; hsn: string; tags: string[]; variants: [string, number, string, number, number][] }

const BIS = "Biscuits", SNK = "Snacks", SWT = "Sweets", BEV = "Beverages", BRK = "Breakfast";
const I = (n: string, name: string, cat: string, desc: string, variants: Item["variants"], o: Partial<Item> = {}): Item =>
  ({ n, name, cat, desc, gst: 5, hsn: "1905", tags: [], variants, ...o });
const bis = (n: string, name: string, desc: string, price = 35, mrp = 40, grams = 150, o: Partial<Item> = {}) => I(n, name, BIS, desc, [[`${grams} g`, grams, `${grams}`, price, mrp]], { tags: ["biscuit", ...name.toLowerCase().split(" ").slice(0, 2)], ...o });

const ITEMS: Item[] = [
  bis("01", "Colada Grand Butter Crackers", "Light, crisp crackers with a rich buttery taste.", 40, 45, 200),
  bis("02", "Samudra Lemon Cream Sandwich Biscuits", "Crunchy biscuits filled with tangy lemon cream.", 40, 45, 190),
  bis("03", "Samudra Chocolate Cream Sandwich Biscuits", "Crunchy biscuits filled with smooth chocolate cream.", 40, 45, 190),
  bis("04", "Sapphire Original Vege Crackers", "Crisp vegetable crackers, lightly salted.", 45, 50, 200),
  bis("05", "Gaodian Choice Black Sesame Soda Crackers", "Thin soda crackers topped with black sesame.", 45, 50, 200),
  bis("06", "Gaodian Choice Milk Salt Soda Crackers", "Thin, crisp soda crackers with a hint of milk and salt.", 45, 50, 200),
  bis("07", "Samudra Cheese Cream Sandwich Biscuits", "Crunchy biscuits filled with savoury cheese cream.", 40, 45, 190),
  bis("08", "Deluxe Cheese Sandwich Crackers", "Crackers sandwiched with a creamy cheese filling.", 35, 40, 180),
  bis("09", "Deluxe Chocolate Sandwich Crackers", "Crackers sandwiched with a chocolate filling.", 35, 40, 180),
  bis("10", "Deluxe Peanut Butter Sandwich Crackers", "Crackers sandwiched with a peanut butter filling.", 35, 40, 180),
  bis("11", "Lipo Cream Egg Cookies Original", "Soft egg cookies with a sweet cream filling.", 60, 70, 200, { food: "egg" }),
  bis("12", "Lipo Chocolate Cream Egg Cookies", "Egg cookies with a chocolate cream filling.", 60, 70, 200, { food: "egg" }),
  bis("13", "Lipo Coconut Cream Egg Cookies", "Egg cookies with a coconut cream filling.", 60, 70, 200, { food: "egg" }),
  bis("14", "Kokola Olezz Cheese Choco Crackers", "Crackers filled with cheese and chocolate cream.", 40, 45, 180),
  bis("15", "Kokola Olezz Choco Party Crackers", "Party pack of crackers with chocolate cream.", 40, 45, 180),
  bis("16", "Gery Sweet Cheese Crackers", "Sweet and savoury crackers with a cheese filling.", 45, 50, 200),
  bis("17", "Malkist Cheese Crackers", "Light, crisp crackers with a cheese flavour.", 45, 50, 120),
  I("18", "Milk Classic Melon Rice Snack", SNK, "Crunchy rice snack with a milky melon flavour.", [["100 g", 100, "100", 35, 40]], { hsn: "1904", tags: ["rice snack", "melon"] }),
  I("19", "Vetrue Klassic Cheese Rice Crackers", SNK, "Crisp rice crackers with a cheese flavour.", [["100 g", 100, "100", 40, 45]], { hsn: "1904", tags: ["rice crackers", "cheese"] }),
  bis("20", "Godinn Bicoff Almond Biscuits", "Crisp biscuits with a nutty almond taste.", 50, 55, 150),
  bis("21", "Godinn Bicoff Caramel Biscuits", "Crisp biscuits with a sweet caramel taste.", 50, 55, 150),
  bis("22", "Godinn Bicoff Butter Cookies", "Rich, buttery cookies.", 50, 55, 150),
  bis("23", "Shoon Fatt Cream Crackers", "Classic cream crackers, light and flaky.", 40, 45, 200),
  bis("24", "GPR Classic Butter Cookies", "Classic butter cookies in a tin-style pack.", 90, 100, 200),
  bis("25", "Deluxe Vegetable Crackers", "Crisp crackers made with vegetables.", 35, 40, 180),
  bis("26", "Tiffany Crunch n Cream Hazelnut Wafers", "Crispy wafers layered with hazelnut cream.", 40, 45, 100),
  bis("27", "Tiffany Crunch n Cream Orange Wafers", "Crispy wafers layered with orange cream.", 40, 45, 100),
  bis("28", "Tiffany Crunch n Cream Vanilla Wafers", "Crispy wafers layered with vanilla cream.", 40, 45, 100),
  I("29", "Uttam Soan Papdi", SWT, "Flaky, melt-in-the-mouth soan papdi sweet.", [["250 g", 250, "250", 120, 135]], { hsn: "2106", tags: ["soan papdi", "mithai"] }),
  I("30", "Prabhuji Elaichi Soan Papdi", SWT, "Soan papdi flavoured with cardamom.", [["250 g", 250, "250", 130, 145]], { hsn: "2106", tags: ["soan papdi", "elaichi", "mithai"] }),
  I("31", "Bhikharam Chandmal Bikaneri Rasgulla", SWT, "Soft, spongy Bikaneri rasgullas in sugar syrup.", [["500 g", 500, "500", 140, 155]], { hsn: "2106", tags: ["rasgulla", "mithai"] }),
  I("32", "Bhikharam Chandmal Gulab Jamun", SWT, "Soft gulab jamuns in sugar syrup.", [["500 g", 500, "500", 150, 165]], { hsn: "2106", tags: ["gulab jamun", "mithai"] }),
  I("33", "Alo Frut Litchi Fruit Drink", BEV, "Sweet litchi fruit drink.", [["250 ml", 250, "250", 40, 45]], { gst: 12, hsn: "2202", tags: ["litchi", "juice", "fruit drink"] }),
  I("34", "Alo Frut Guava Fruit Drink", BEV, "Refreshing guava fruit drink.", [["250 ml", 250, "250", 40, 45]], { gst: 12, hsn: "2202", tags: ["guava", "juice", "fruit drink"] }),
  I("35", "Alo Frut Mango Fruit Drink", BEV, "Sweet mango fruit drink.", [["250 ml", 250, "250", 40, 45]], { gst: 12, hsn: "2202", tags: ["mango", "juice", "fruit drink"] }),
  I("36", "Alo Frut Kiwi Fruit Drink", BEV, "Tangy kiwi fruit drink.", [["250 ml", 250, "250", 40, 45]], { gst: 12, hsn: "2202", tags: ["kiwi", "juice", "fruit drink"] }),
  I("37", "Healthy Tasty Wheat Flakes", BRK, "Crunchy wheat flakes for a quick, wholesome breakfast.", [["300 g", 300, "300", 95, 110], ["600 g", 600, "600", 180, 210]], { hsn: "1904", tags: ["wheat flakes", "cereal"] }),
  I("38", "Hulas Chiura", BRK, "Flattened rice (chiura) for poha and snacks.", [["500 g", 500, "500", 55, 60], ["1 kg", 1000, "1000", 105, 115]], { hsn: "1904", tags: ["chiura", "poha", "flattened rice"] }),
  I("39", "DiSano Whole Grain Oats", BRK, "Whole grain rolled oats for porridge and baking.", [["500 g", 500, "500", 110, 125], ["1 kg", 1000, "1000", 210, 240]], { hsn: "1104", tags: ["oats", "cereal"] }),
];

async function main() {
  const photoDir = process.argv[2];
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
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

  const catIds = new Map<string, string>();
  const walk = (nodes: { id: string; name: string; children?: unknown[] }[]) => { for (const n of nodes) { catIds.set(n.name, n.id); walk((n.children ?? []) as never); } };
  walk((await svc.categoryTree()) as never);
  for (const c of [BIS, SNK, SWT, BEV, BRK]) if (!catIds.has(c)) throw new Error(`category missing: ${c}`);

  let created = 0, photos = 0;
  let sort = 200;
  for (const it of ITEMS) {
    sort++;
    const skus = it.variants.map(v => `STR-${it.n}-${v[2]}`);
    let productId: string;
    const dup = await svc.checkDuplicate({ name: it.name, skus });
    if (dup.similar.length) {
      productId = dup.similar[0]!.id;
      console.log("exists:", it.name);
    } else {
      const product = await svc.createProduct({
        name: it.name, description: it.desc, categoryId: catIds.get(it.cat)!, type: "packaged", stockMode: "per_variant", tags: it.tags,
        highlights: [], keyInfo: [{ label: "Shelf life", value: "6 months" }], nutrition: null, infoSections: [{ title: "Storage", body: "Store in a cool, dry place. Keep the pack sealed after opening." }],
        variants: it.variants.map(([label, weightGrams], i) => ({ label, weightGrams, sku: skus[i]!, barcode: null, attributes: [] })),
        gstRate: it.gst, hsnCode: it.hsn, status: "active", sortOrder: sort, brandId: null, foodType: it.food ?? "veg", extraCategoryIds: [], badge: null, isReturnable: true,
      });
      productId = product.id;
      const full = (await svc.getProduct(productId)) as unknown as { variants: { id: string; sku: string }[] };
      await offerings.offerings.create(ctx as never, {
        warehouseId, productId, stockGrams: null,
        variants: it.variants.map(([, , , price, mrp], i) => ({ variantId: full.variants.find(v => v.sku === skus[i])!.id, price: price * 100, mrp: mrp * 100, salePrice: null, saleStart: null, saleEnd: null, stock: 40, maxQtyPerOrder: null })),
      });
      created++;
      console.log("created + offered:", it.name, `(${it.cat})`);
    }
    // Photo, when a file for this number was supplied and the product has none yet.
    const ext = photoDir ? ["jpg", "jpeg", "png", "webp"].find(e => existsSync(join(photoDir, `${it.n}.${e}`))) : undefined;
    const file = photoDir && ext ? join(photoDir, `${it.n}.${ext}`) : null;
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    if (file && existsSync(file)) {
      const current = (await svc.getProduct(productId)) as unknown as { images: unknown[] };
      if (current.images.length === 0) {
        const bytes = readFileSync(file);
        const t = await media.service.requestUpload(principal, { kind: "product_image", contentType: mime, sizeBytes: bytes.length, durationSec: null, ownerRef: { type: "product", id: productId } } as never) as { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } };
        const form = new FormData();
        for (const [k, v] of Object.entries(t.upload.fields ?? {})) form.append(k, v);
        form.append("file", new Blob([bytes], { type: mime }), `${it.name}.${ext}`);
        const up = await fetch(t.upload.url, { method: t.upload.method || "POST", body: form });
        if (!up.ok) throw new Error(`Cloudinary upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
        await media.service.complete(principal, t.mediaId);
        await svc.attachImage(productId, { mediaId: t.mediaId, alt: it.name });
        photos++;
        console.log("  photo added:", it.name);
      }
    }
  }
  console.log(`done: ${created} new products, ${photos} photos`);
  await mongoose.disconnect();
}
main().catch(e => { console.error("SEED FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
