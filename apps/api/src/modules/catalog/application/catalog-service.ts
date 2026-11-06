import { AppError, conflict, notFound, validation } from "../domain/errors.js";
import {
  assertDistinctSkus, assertProductInfo, assertTypeMatchesStockMode, buildTree, nameKey, similarNames, slugify, toCsv, wouldCreateCycle,
  type Category, type CategoryNode, type Product, type ProductImage, type Variant,
} from "../domain/product.js";
import type { CatalogDeps, CatalogTx, Ctx } from "./ports.js";
import type {
  CategoryInput, CategoryPatch, ProductInput, ProductListQuery, ProductPatch, ProductView, VariantInput, VariantPatch,
} from "./types.js";

const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const id = Buffer.from(cursor, "base64url").toString();
  if (!/^[a-f0-9]{24}$/.test(id)) throw validation("Invalid cursor", { field: "cursor" });
  return id;
}

export function createCatalogService(deps: CatalogDeps) {
  const { store, media, usage, now, newId } = deps;

  async function view(product: Product): Promise<ProductView> {
    const urls = await media.urls(product.images.map(image => image.mediaId));
    const { nameKey: _unused, ...rest } = product;
    return { ...rest, images: product.images.map(image => ({ ...image, urls: urls[image.mediaId] ?? {} })) };
  }

  function requireProduct(product: Product | null): Product {
    if (!product) throw notFound("Product");
    return product;
  }

  async function assertSkusFree(tx: CatalogTx, skus: string[], excludeProductId?: string) {
    const owners = await tx.findSkuOwners(skus, excludeProductId);
    if (owners.length > 0) throw conflict(`SKU ${owners[0]!.sku} is already used by another product`, { field: "sku", sku: owners[0]!.sku });
  }

  /** Re-read the saved product, apply a change, bump delta-sync revisions afterwards. */
  async function changeProduct(id: string, change: (product: Product, tx: CatalogTx) => Promise<void> | void, ctx?: Ctx, audit?: { action: string }): Promise<Product> {
    const updated = await store.transaction(async tx => {
      const product = requireProduct(await tx.getProduct(id));
      await change(product, tx);
      product.updatedAt = now();
      await tx.saveProduct(product);
      if (ctx && audit) await tx.audit(ctx, { action: audit.action, entityType: "product", entityId: id });
      return product;
    });
    await usage.touchOfferings(id);
    return updated;
  }

  return {
    // ---------- categories ----------
    async categoryTree(): Promise<CategoryNode[]> { return buildTree(await store.listCategories()); },

    async createCategory(input: CategoryInput): Promise<Category> {
      const at = now();
      const category: Category = {
        id: newId(), name: input.name, slug: slugify(input.name), parentId: input.parentId,
        imageMediaId: input.imageMediaId, sortOrder: input.sortOrder, isActive: true, createdAt: at, updatedAt: at,
      };
      await store.transaction(async tx => {
        if (input.parentId && !(await tx.getCategory(input.parentId))) throw notFound("Parent category");
        await tx.insertCategory(category);
      });
      return category;
    },

    async updateCategory(id: string, patch: CategoryPatch): Promise<Category> {
      return store.transaction(async tx => {
        const category = await tx.getCategory(id);
        if (!category) throw notFound("Category");
        if (patch.parentId !== undefined && patch.parentId !== category.parentId) {
          if (patch.parentId !== null && !(await tx.getCategory(patch.parentId))) throw notFound("Parent category");
          if (wouldCreateCycle(await tx.listCategories(), id, patch.parentId)) throw validation("A category cannot be moved under itself", { field: "parentId" });
          category.parentId = patch.parentId;
        }
        if (patch.name !== undefined && patch.name !== category.name) { category.name = patch.name; category.slug = slugify(patch.name); }
        if (patch.imageMediaId !== undefined) category.imageMediaId = patch.imageMediaId;
        if (patch.sortOrder !== undefined) category.sortOrder = patch.sortOrder;
        if (patch.isActive !== undefined) category.isActive = patch.isActive;
        category.updatedAt = now();
        await tx.saveCategory(category);
        return category;
      });
    },

    async deleteCategory(ctx: Ctx, id: string): Promise<void> {
      await store.transaction(async tx => {
        if (!(await tx.getCategory(id))) throw notFound("Category");
        if ((await tx.countChildren(id)) > 0) throw conflict("The category still has sub-categories", { reason: "has_children" });
        if ((await tx.countProductsInCategory(id)) > 0) throw conflict("The category still has products", { reason: "has_products" });
        await tx.deleteCategory(id);
        await tx.audit(ctx, { action: "catalog.category.delete", entityType: "category", entityId: id });
      });
    },

    async reorderCategories(parentId: string | null, orderedIds: string[]): Promise<void> {
      await store.transaction(async tx => {
        const siblings = (await tx.listCategories()).filter(category => category.parentId === parentId).map(category => category.id);
        const same = orderedIds.length === siblings.length && new Set(orderedIds).size === orderedIds.length && orderedIds.every(id => siblings.includes(id));
        if (!same) throw validation("orderedIds must list every category under this parent exactly once", { field: "orderedIds" });
        await tx.setCategoryOrder(orderedIds.map((id, sortOrder) => ({ id, sortOrder })), now());
      });
    },

    // ---------- products ----------
    async createProduct(input: ProductInput): Promise<ProductView> {
      assertTypeMatchesStockMode(input.type, input.stockMode);
      assertDistinctSkus(input.variants);
      assertProductInfo(input);
      const at = now();
      const product: Product = {
        id: newId(), vendorId: null, name: input.name, nameKey: nameKey(input.name), slug: slugify(input.name),
        description: input.description, categoryId: input.categoryId, type: input.type, stockMode: input.stockMode,
        tags: input.tags, highlights: input.highlights, keyInfo: input.keyInfo, nutrition: input.nutrition, infoSections: input.infoSections,
        images: [], gstRate: input.gstRate, hsnCode: input.hsnCode, status: input.status, sortOrder: input.sortOrder,
        variants: input.variants.map(v => ({ id: newId(), label: v.label, weightGrams: v.weightGrams, sku: v.sku, barcode: v.barcode, isActive: true })),
        createdAt: at, updatedAt: at,
      };
      await store.transaction(async tx => {
        if (!(await tx.getCategory(input.categoryId))) throw notFound("Category");
        await assertSkusFree(tx, product.variants.map(v => v.sku));
        await tx.insertProduct(product);
      });
      return view(product);
    },

    async getProduct(id: string): Promise<ProductView> { return view(requireProduct(await store.getProduct(id))); },

    async listProducts(query: ProductListQuery): Promise<{ items: ProductView[]; nextCursor: string | null }> {
      const afterId = decodeCursor(query.cursor);
      const rows = await store.listProducts({
        limit: query.limit + 1,
        ...(query.q !== undefined && { q: query.q }), ...(query.categoryId !== undefined && { categoryId: query.categoryId }),
        ...(query.status !== undefined && { status: query.status }), ...(query.type !== undefined && { type: query.type }),
        ...(afterId !== undefined && { afterId }),
      });
      const page = rows.slice(0, query.limit);
      return { items: await Promise.all(page.map(view)), nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!.id) : null };
    },

    async updateProduct(id: string, patch: ProductPatch): Promise<ProductView> {
      const needsOfferingCheck = patch.type !== undefined || patch.stockMode !== undefined;
      const offered = needsOfferingCheck ? (await usage.offeringCount(id)) > 0 : false;
      const product = await changeProduct(id, async (current, tx) => {
        const type = patch.type ?? current.type;
        const stockMode = patch.stockMode ?? current.stockMode;
        if (type !== current.type || stockMode !== current.stockMode) {
          if (offered) throw conflict("Type and stock mode cannot change once a warehouse sells this product", { reason: "has_offerings" });
          assertTypeMatchesStockMode(type, stockMode);
          current.type = type; current.stockMode = stockMode;
        }
        if (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) {
          if (!(await tx.getCategory(patch.categoryId))) throw notFound("Category");
          current.categoryId = patch.categoryId;
        }
        if (patch.name !== undefined && patch.name !== current.name) { current.name = patch.name; current.nameKey = nameKey(patch.name); current.slug = slugify(patch.name); }
        if (patch.description !== undefined) current.description = patch.description;
        if (patch.tags !== undefined) current.tags = patch.tags;
        if (patch.highlights !== undefined) current.highlights = patch.highlights;
        if (patch.infoSections !== undefined) current.infoSections = patch.infoSections;
        if (patch.keyInfo !== undefined || patch.nutrition !== undefined) {
          const next = { keyInfo: patch.keyInfo ?? current.keyInfo, nutrition: patch.nutrition === undefined ? current.nutrition : patch.nutrition };
          assertProductInfo(next);
          current.keyInfo = next.keyInfo; current.nutrition = next.nutrition;
        }
        if (patch.gstRate !== undefined) current.gstRate = patch.gstRate;
        if (patch.hsnCode !== undefined) current.hsnCode = patch.hsnCode;
        if (patch.status !== undefined) {
          if (current.status === "archived") throw conflict("Restore the product before changing its status", { reason: "archived" });
          current.status = patch.status;
        }
        if (patch.sortOrder !== undefined) current.sortOrder = patch.sortOrder;
      });
      return view(product);
    },

    async archiveProduct(ctx: Ctx, id: string): Promise<ProductView> {
      return view(await changeProduct(id, product => { product.status = "archived"; }, ctx, { action: "catalog.product.archive" }));
    },

    async restoreProduct(id: string): Promise<ProductView> {
      return view(await changeProduct(id, product => {
        if (product.status !== "archived") throw conflict("The product is not archived", { reason: "not_archived" });
        product.status = "inactive";
      }));
    },

    /** Conservative on purpose: allowed only when `usage.canDelete` says the product was never offered or ordered. */
    async deleteProduct(ctx: Ctx, id: string): Promise<void> {
      if (!(await usage.canDelete(id))) throw conflict("This product cannot be deleted; archive it instead", { reason: "in_use_or_unverified" });
      let removed: Product;
      await store.transaction(async tx => {
        removed = requireProduct(await tx.getProduct(id));
        await tx.deleteProduct(id);
        await tx.audit(ctx, { action: "catalog.product.delete", entityType: "product", entityId: id });
      });
      await Promise.all(removed!.images.map(image => media.remove(image.mediaId, "product_deleted")));
    },

    // ---------- variants ----------
    async addVariant(id: string, input: VariantInput): Promise<ProductView> {
      return view(await changeProduct(id, async (product, tx) => {
        if (product.variants.some(v => v.sku === input.sku)) throw validation(`SKU ${input.sku} is used twice in this product`, { field: "sku" });
        await assertSkusFree(tx, [input.sku], id);
        product.variants.push({ id: newId(), label: input.label, weightGrams: input.weightGrams, sku: input.sku, barcode: input.barcode, isActive: true });
      }));
    },

    async updateVariant(id: string, variantId: string, patch: VariantPatch): Promise<ProductView> {
      const weightChanges = patch.weightGrams !== undefined;
      const offered = weightChanges ? (await usage.offeringCount(id)) > 0 : false;
      return view(await changeProduct(id, async (product, tx) => {
        const variant = product.variants.find(v => v.id === variantId);
        if (!variant) throw notFound("Variant");
        if (patch.weightGrams !== undefined && patch.weightGrams !== variant.weightGrams) {
          if (offered) throw conflict("Weight cannot change once a warehouse sells this product", { reason: "has_offerings" });
          variant.weightGrams = patch.weightGrams;
        }
        if (patch.sku !== undefined && patch.sku !== variant.sku) {
          if (product.variants.some(v => v.sku === patch.sku)) throw validation(`SKU ${patch.sku} is used twice in this product`, { field: "sku" });
          await assertSkusFree(tx, [patch.sku], id);
          variant.sku = patch.sku;
        }
        if (patch.label !== undefined) variant.label = patch.label;
        if (patch.barcode !== undefined) variant.barcode = patch.barcode;
        if (patch.isActive !== undefined) variant.isActive = patch.isActive;
      }));
    },

    /** Past orders keep their snapshot; the variant is only switched off. */
    async deactivateVariant(id: string, variantId: string): Promise<ProductView> {
      return view(await changeProduct(id, product => {
        const variant = product.variants.find(v => v.id === variantId);
        if (!variant) throw notFound("Variant");
        variant.isActive = false;
      }));
    },

    // ---------- images ----------
    async attachImage(id: string, input: { mediaId: string; alt: string }): Promise<ProductImage & { urls: Record<string, string> }> {
      requireProduct(await store.getProduct(id));
      const described = await media.describe(input.mediaId);
      if (!described) throw notFound("Media");
      await media.claim?.(input.mediaId, { type: "product", id });
      let image!: ProductImage;
      await changeProduct(id, product => {
        if (product.images.some(i => i.mediaId === input.mediaId)) throw conflict("This image is already attached", { field: "mediaId" });
        image = { mediaId: input.mediaId, alt: input.alt, sortOrder: product.images.reduce((max, i) => Math.max(max, i.sortOrder + 1), 0) };
        product.images.push(image);
      });
      return { ...image, urls: described.urls };
    },

    async reorderImages(id: string, orderedMediaIds: string[]): Promise<ProductView> {
      return view(await changeProduct(id, product => {
        const current = product.images.map(i => i.mediaId);
        const same = orderedMediaIds.length === current.length && new Set(orderedMediaIds).size === current.length && orderedMediaIds.every(m => current.includes(m));
        if (!same) throw validation("orderedMediaIds must list every image exactly once", { field: "orderedMediaIds" });
        product.images = orderedMediaIds.map((mediaId, sortOrder) => ({ ...product.images.find(i => i.mediaId === mediaId)!, sortOrder }));
      }));
    },

    // shortcut: if media.remove fails after the commit the file stays in storage; the media orphan sweep (F24) collects it.
    async removeImage(ctx: Ctx, id: string, mediaId: string): Promise<void> {
      await changeProduct(id, product => {
        if (!product.images.some(i => i.mediaId === mediaId)) throw notFound("Image");
        product.images = product.images.filter(i => i.mediaId !== mediaId).map((i, sortOrder) => ({ ...i, sortOrder }));
      }, ctx, { action: "catalog.product.image_remove" });
      await media.remove(mediaId, "product_image_removed");
    },

    // ---------- helpers for the admin UI ----------
    async checkDuplicate(input: { name: string; skus: string[] }): Promise<{ similar: { id: string; name: string; reason: "similar_name" | "sku_exists" }[] }> {
      const found = new Map<string, { id: string; name: string; reason: "similar_name" | "sku_exists" }>();
      const key = nameKey(input.name);
      for (const row of await store.listNameKeys()) if (similarNames(key, row.nameKey)) found.set(row.id, { id: row.id, name: row.name, reason: "similar_name" });
      const owners = await store.findSkuOwners(input.skus);
      if (owners.length > 0) {
        for (const product of await store.getProducts([...new Set(owners.map(o => o.productId))])) found.set(product.id, { id: product.id, name: product.name, reason: "sku_exists" });
      }
      return { similar: [...found.values()] };
    },

    async exportCsv(ctx: Ctx): Promise<string> {
      const [categories, products] = await Promise.all([store.listCategories(), store.listAllProducts()]);
      await store.transaction(tx => tx.audit(ctx, { action: "catalog.export", entityType: "catalog", entityId: "catalog" }));
      return toCsv(categories, products);
    },

    // ---------- reads for other modules ----------
    /** Used by the offerings module. */
    getProducts(ids: readonly string[]) { return store.getProducts(ids); },
    getProductEntity(id: string) { return store.getProduct(id); },
    getCategory(id: string) { return store.getCategory(id); },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
export type { Variant };
export { AppError };
