import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { createCatalogModule } from "./src/modules/catalog/catalog.public.js";
import { createMediaModule, storageFromEnv, type Principal } from "./src/modules/media/media.public.js";
import { createOfferingsModule, productDirectoryFrom } from "./src/modules/offerings/offerings.public.js";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI missing");

  await mongoose.connect(uri);
  const connection = mongoose.connection;
  const db = connection.db!;

  const sourceWarehouseId = "6af1bffe39f9e10320adafb8"; // Darjeeling Store
  const targetWarehouseId = "6af458b19808b9f0ab07bf4d"; // Bidhan Market Store (Siliguri)
  const targetZoneId = "6af4587f9808b9f0ab07bf40"; // Siliguri zone

  // Verify target warehouse
  const targetWh = await db.collection("warehouses").findOne({ _id: new Types.ObjectId(targetWarehouseId) });
  if (!targetWh) throw new Error("Target warehouse not found");
  console.log(`Target Warehouse: ${targetWh.name} (${targetWh.code}), Zone: ${targetWh.zoneId}`);

  // Setup modules
  const media = createMediaModule({ connection, storage: storageFromEnv(process.env) });
  const catalog = createCatalogModule({ connection, media: media.catalogPort });
  const offerings = createOfferingsModule({
    connection,
    products: productDirectoryFrom(catalog),
    warehouses: {
      get: async (id) => {
        const doc = await db.collection("warehouses").findOne({ _id: new Types.ObjectId(id) });
        return doc ? { id: String(doc._id), zoneId: String(doc.zoneId), isEnabled: doc.isEnabled } : null;
      },
    },
  });

  const userId = new Types.ObjectId().toHexString();
  const ctx = {
    actor: { userId, role: "owner", permissions: ["*"], scope: { all: true, warehouseIds: [targetWarehouseId] } },
    requestId: randomUUID(),
  };

  const darjeelingOfferings = await db.collection("warehouse_products").find({ warehouseId: sourceWarehouseId }).toArray();
  console.log(`Found ${darjeelingOfferings.length} products in Darjeeling warehouse to replicate into Siliguri.`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const o of darjeelingOfferings) {
    // Check if offering already exists in target warehouse
    const existing = await db.collection("warehouse_products").findOne({
      warehouseId: targetWarehouseId,
      productId: o.productId,
    });
    if (existing) {
      console.log(`Skipping already existing offering for product ${o.productId}`);
      skippedCount++;
      continue;
    }

    const masterProduct = await catalog.service.getProduct(o.productId);
    const pooled = masterProduct.stockMode === "pooled_weight";

    const variants = o.variants.map((v: any) => {
      const origRs = v.price / 100;
      const mrpRs = v.mrp / 100;

      let diffRs = 0;
      if (origRs >= 200) {
        diffRs = -Math.round(origRs * 0.06);
      } else if (origRs >= 100) {
        diffRs = -Math.round(origRs * 0.05);
      } else if (origRs >= 40) {
        diffRs = -Math.max(2, Math.round(origRs * 0.06));
      } else if (origRs >= 15) {
        diffRs = -Math.max(1, Math.round(origRs * 0.07));
      } else {
        diffRs = -1;
      }

      let newPriceRs = origRs + diffRs;
      if (newPriceRs <= 0) newPriceRs = 1;
      if (newPriceRs > mrpRs) newPriceRs = mrpRs;
      if (newPriceRs === origRs) newPriceRs = Math.max(1, origRs - 1);

      return {
        variantId: v.variantId,
        price: newPriceRs * 100,
        mrp: v.mrp,
        salePrice: null,
        saleStart: null,
        saleEnd: null,
        stock: pooled ? null : (v.stock ?? 40),
        maxQtyPerOrder: null,
      };
    });

    await offerings.offerings.create(ctx as never, {
      warehouseId: targetWarehouseId,
      productId: o.productId,
      stockGrams: pooled ? (o.stockGrams ?? 30000) : null,
      variants,
    });

    createdCount++;
    console.log(`[${createdCount}/${darjeelingOfferings.length}] Created Siliguri offering for "${masterProduct.name}" (${variants.map((x: any) => `₹${x.price/100}`).join(", ")})`);
  }

  console.log(`\nCOMPLETED: Created ${createdCount} offerings in Siliguri warehouse (Skipped: ${skippedCount}).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("SILIGURI SEED FAILED:", err);
  process.exit(1);
});
