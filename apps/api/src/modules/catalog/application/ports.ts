import type { Brand, Category, FoodType, Product, ProductStatus, ProductType } from "../domain/product.js";

export interface Actor {
  userId: string; role: string; permissions: readonly string[];
  scope: { all: boolean; warehouseIds: readonly string[] };
}
/** Who is acting and for which request. `requestId` must be a UUID because the audit log requires it. */
export interface Ctx { actor: Actor; requestId: string }
export interface AuditEntry { action: string; entityType: string; entityId: string; warehouseId?: string }

export interface ProductQuery { q?: string; categoryId?: string; brandId?: string; foodType?: FoodType; status?: ProductStatus; type?: ProductType; afterId?: string; limit: number }

export interface CatalogReads {
  getCategory(id: string): Promise<Category | null>;
  listCategories(): Promise<Category[]>;
  countChildren(id: string): Promise<number>;
  countProductsInCategory(id: string): Promise<number>;
  getBrand(id: string): Promise<Brand | null>;
  getBrands(ids: readonly string[]): Promise<Brand[]>;
  listBrands(): Promise<Brand[]>;
  countProductsOfBrand(id: string): Promise<number>;
  getProduct(id: string): Promise<Product | null>;
  getProducts(ids: readonly string[]): Promise<Product[]>;
  listProducts(query: ProductQuery): Promise<Product[]>;
  listAllProducts(): Promise<Product[]>;
  listNameKeys(): Promise<{ id: string; name: string; nameKey: string }[]>;
  findSkuOwners(skus: readonly string[], excludeProductId?: string): Promise<{ sku: string; productId: string }[]>;
}

/** Writes run inside one MongoDB transaction together with their audit record. A duplicate slug or SKU surfaces as a CONFLICT AppError. */
export interface CatalogTx extends CatalogReads {
  insertCategory(category: Category): Promise<void>;
  saveCategory(category: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  insertBrand(brand: Brand): Promise<void>;
  saveBrand(brand: Brand): Promise<void>;
  deleteBrand(id: string): Promise<void>;
  setCategoryOrder(updates: readonly { id: string; sortOrder: number }[], at: Date): Promise<void>;
  insertProduct(product: Product): Promise<void>;
  saveProduct(product: Product): Promise<void>;
  deleteProduct(id: string): Promise<void>;
  audit(ctx: Ctx, entry: AuditEntry): Promise<void>;
}

export interface CatalogStore extends CatalogReads {
  ensureIndexes(): Promise<void>;
  transaction<T>(fn: (tx: CatalogTx) => Promise<T>): Promise<T>;
}

/** Provided by the media module (F24). Until it exists, composition supplies a stand-in. */
export interface MediaPort {
  describe(mediaId: string): Promise<{ urls: Record<string, string> } | null>;
  urls(mediaIds: readonly string[]): Promise<Record<string, Record<string, string>>>;
  /** Ask for every stored size of the file to be deleted. */
  remove(mediaId: string, reason: string): Promise<void>;
  /** Record that the file now belongs to this owner (it then stops being "unattached"). Throws if the file cannot be used for it. */
  claim?(mediaId: string, owner: { type: "product" | "category" | "banner" | "brand"; id: string }): Promise<void>;
}

/** Implemented by the offerings module so the catalog can protect products that are already for sale. */
export interface ProductUsagePort {
  offeringCount(productId: string): Promise<number>;
  /** False when the product is, or may be, referenced by offerings or orders. Hard delete is allowed only on true. */
  canDelete(productId: string): Promise<boolean>;
  /** Bump the delta-sync revision of the product's offerings after a catalog change. */
  touchOfferings(productId: string): Promise<void>;
}

export interface CatalogDeps {
  store: CatalogStore; media: MediaPort; usage: ProductUsagePort;
  now: () => Date; newId: () => string;
}
