import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import type { CatalogReads, CatalogStore, CatalogTx, ProductQuery } from "../application/ports.js";
import { conflict } from "../domain/errors.js";
import { nameKey, type Category, type Product } from "../domain/product.js";

// Ids are 24-character hex strings stored as strings (not ObjectId) so this module never converts ids.
type CategoryDoc = Omit<Category, "id"> & { _id: string };
type InfoFields = "highlights" | "keyInfo" | "nutrition" | "infoSections";
/** Products saved before the information fields existed do not have them stored. */
type ProductDoc = Omit<Product, "id" | InfoFields> & Partial<Pick<Product, InfoFields>> & { _id: string };

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toCategory = ({ _id, ...rest }: CategoryDoc): Category => ({ id: _id, ...rest });
// Products saved before the information fields existed read back with empty values, so callers never see a missing field.
const toProduct = ({ _id, highlights, keyInfo, nutrition, infoSections, ...rest }: ProductDoc): Product => ({
  id: _id, ...rest, highlights: highlights ?? [], keyInfo: keyInfo ?? [], nutrition: nutrition ?? null, infoSections: infoSections ?? [],
});
const toCategoryDoc = ({ id, ...rest }: Category): CategoryDoc => ({ _id: id, ...rest });
const toProductDoc = ({ id, ...rest }: Product): ProductDoc => ({ _id: id, ...rest });

/** Turns a unique-index violation into a CONFLICT the API can report; anything else is rethrown. */
function mapDuplicate(error: unknown): never {
  const e = error as { code?: number; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> } | null;
  if (e?.code === 11000) {
    const key = Object.keys(e.keyPattern ?? {})[0] ?? "";
    if (key === "slug") throw conflict("An item with this name already exists", { field: "slug" });
    if (key === "variants.sku") throw conflict("A SKU is already used by another product", { field: "sku", sku: e.keyValue?.["variants.sku"] });
    throw conflict("Duplicate value", { field: key });
  }
  throw error;
}

export function createMongoCatalogStore(connection: Connection): CatalogStore {
  const categories = () => connection.collection<CategoryDoc>("categories");
  const products = () => connection.collection<ProductDoc>("products");
  const writeAudit = createAuditWriter(connection);

  function reads(session?: ClientSession): CatalogReads {
    const opts = session ? { session } : {};
    return {
      async getCategory(id) { const doc = await categories().findOne({ _id: id }, opts); return doc ? toCategory(doc) : null; },
      async listCategories() { return (await categories().find({}, opts).toArray()).map(toCategory); },
      countChildren(id) { return categories().countDocuments({ parentId: id }, opts); },
      countProductsInCategory(id) { return products().countDocuments({ categoryId: id }, opts); },
      async getProduct(id) { const doc = await products().findOne({ _id: id }, opts); return doc ? toProduct(doc) : null; },
      async getProducts(ids) { return (await products().find({ _id: { $in: [...ids] } }, opts).toArray()).map(toProduct); },
      async listProducts(query: ProductQuery) {
        const filter: Record<string, unknown> = {};
        if (query.status) filter.status = query.status;
        if (query.type) filter.type = query.type;
        if (query.categoryId) filter.categoryId = query.categoryId;
        if (query.afterId) filter._id = { $gt: query.afterId };
        if (query.q) {
          const key = nameKey(query.q);
          filter.$or = [{ "variants.sku": query.q.toUpperCase() }, ...(key ? [{ nameKey: { $regex: escapeRegex(key) } }] : [])];
        }
        return (await products().find(filter, opts).sort({ _id: 1 }).limit(query.limit).toArray()).map(toProduct);
      },
      async listAllProducts() { return (await products().find({}, opts).sort({ _id: 1 }).toArray()).map(toProduct); },
      async listNameKeys() {
        const docs = await products().find({}, { ...opts, projection: { name: 1, nameKey: 1 } }).toArray();
        return docs.map(doc => ({ id: doc._id, name: doc.name, nameKey: doc.nameKey }));
      },
      async findSkuOwners(skus, excludeProductId) {
        if (skus.length === 0) return [];
        const filter: Record<string, unknown> = { "variants.sku": { $in: [...skus] } };
        if (excludeProductId) filter._id = { $ne: excludeProductId };
        const owners: { sku: string; productId: string }[] = [];
        for (const doc of await products().find(filter, opts).toArray()) {
          for (const variant of doc.variants) if (skus.includes(variant.sku)) owners.push({ sku: variant.sku, productId: doc._id });
        }
        return owners;
      },
    };
  }

  function tx(session: ClientSession): CatalogTx {
    return {
      ...reads(session),
      async insertCategory(category) { try { await categories().insertOne(toCategoryDoc(category), { session }); } catch (e) { mapDuplicate(e); } },
      async saveCategory(category) { try { await categories().replaceOne({ _id: category.id }, toCategoryDoc(category), { session }); } catch (e) { mapDuplicate(e); } },
      async deleteCategory(id) { await categories().deleteOne({ _id: id }, { session }); },
      async setCategoryOrder(updates, at) {
        for (const { id, sortOrder } of updates) await categories().updateOne({ _id: id }, { $set: { sortOrder, updatedAt: at } }, { session });
      },
      async insertProduct(product) { try { await products().insertOne(toProductDoc(product), { session }); } catch (e) { mapDuplicate(e); } },
      async saveProduct(product) { try { await products().replaceOne({ _id: product.id }, toProductDoc(product), { session }); } catch (e) { mapDuplicate(e); } },
      async deleteProduct(id) { await products().deleteOne({ _id: id }, { session }); },
      async audit(ctx, entry) {
        await writeAudit({
          actorId: ctx.actor.userId, actorRole: ctx.actor.role, action: entry.action, entityType: entry.entityType,
          entityId: entry.entityId, requestId: ctx.requestId, ...(entry.warehouseId !== undefined && { warehouseId: entry.warehouseId }),
        }, session);
      },
    };
  }

  return {
    ...reads(),
    async ensureIndexes() {
      await categories().createIndex({ slug: 1 }, { unique: true });
      await categories().createIndex({ parentId: 1, sortOrder: 1 });
      await products().createIndex({ slug: 1 }, { unique: true });
      // Multikey unique index: a SKU can appear in only one product (duplicates inside one product are rejected by the service).
      await products().createIndex({ "variants.sku": 1 }, { unique: true });
      await products().createIndex({ categoryId: 1, status: 1 });
      await products().createIndex({ nameKey: 1 });
    },
    async transaction<T>(fn: (t: CatalogTx) => Promise<T>): Promise<T> {
      const session = await connection.startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => { result = await fn(tx(session)); });
        return result;
      } finally { await session.endSession(); }
    },
  };
}
