import type { Badge, Brand, FoodType, InfoSection, KeyInfoRow, Nutrition, Product, ProductType, StockMode, ProductStatus, VariantAttribute } from "../domain/product.js";

/** Optional fields accept an explicit undefined (what parsed JSON produces). */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export interface CategoryInput { name: string; parentId: string | null; imageMediaId: string | null; sortOrder: number }
export type CategoryPatch = Patch<CategoryInput> & { isActive?: boolean | undefined };

export interface VariantInput { label: string; weightGrams: number; sku: string; barcode: string | null; attributes: VariantAttribute[] }

export interface BrandInput { name: string; logoMediaId: string | null; sortOrder: number }
export type BrandPatch = Patch<BrandInput> & { isActive?: boolean | undefined };
export type BrandView = Omit<Brand, "logoMediaId"> & { logoMediaId: string | null; logoUrls: Record<string, string> };
export interface ProductInput {
  name: string; description: string; categoryId: string; type: ProductType; stockMode: StockMode; tags: string[];
  highlights: string[]; keyInfo: KeyInfoRow[]; nutrition: Nutrition | null; infoSections: InfoSection[];
  variants: VariantInput[]; gstRate: number; hsnCode: string | null; status: Extract<ProductStatus, "active" | "inactive">; sortOrder: number;
  brandId: string | null; foodType: FoodType; extraCategoryIds: string[]; badge: Badge | null; isReturnable: boolean;
}
export type ProductPatch = Patch<Omit<ProductInput, "variants">>;
export type VariantPatch = Patch<VariantInput> & { isActive?: boolean | undefined };

export interface ProductListQuery {
  q?: string | undefined; categoryId?: string | undefined; status?: ProductStatus | undefined;
  type?: ProductType | undefined; brandId?: string | undefined; foodType?: FoodType | undefined; cursor?: string | undefined; limit: number;
}

/** A product with its image URLs resolved. */
export type ProductView = Omit<Product, "nameKey" | "images"> & {
  brand: { id: string; name: string } | null;
  images: { mediaId: string; alt: string; sortOrder: number; urls: Record<string, string> }[];
};
