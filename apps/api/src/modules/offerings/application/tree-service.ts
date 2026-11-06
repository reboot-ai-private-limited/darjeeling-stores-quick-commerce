import { assertWarehouseScope, validation, type Ctx } from "../../catalog/catalog.public.js";
import { isLow, type OfferingStatus, type ProductInfo } from "../domain/stock.js";
import type { OfferingsDeps } from "./ports.js";

const MAX_OFFERINGS = 5000;

export interface TreeFilters { q?: string | undefined; status?: OfferingStatus | undefined; lowStock?: boolean | undefined }
export interface TreeProduct {
  offeringId: string; productId: string; name: string; status: OfferingStatus; rev: number; stockGrams: number | null;
  variants: { variantId: string; label: string; price: number; mrp: number; salePrice: number | null; stock: number | null; isActive: boolean }[];
}
export interface TreeCategory { id: string; name: string; products: TreeProduct[]; children: TreeCategory[] }
export interface WarehouseTree { warehouseId: string; categories: TreeCategory[] }

/** The category → product → variants view of one warehouse's offerings (F06). */
export function createTreeService(deps: OfferingsDeps) {
  const { store, products, thresholds } = deps;

  return {
    async tree(ctx: Ctx, warehouseId: string, filters: TreeFilters): Promise<WarehouseTree> {
      assertWarehouseScope(ctx.actor, warehouseId);
      const productIds = filters.q !== undefined ? await products.searchIds({ q: filters.q }) : undefined;
      if (productIds && productIds.length === 0) return { warehouseId, categories: [] };
      const rows = await store.listOfferings({
        warehouseIds: [warehouseId], limit: MAX_OFFERINGS + 1, ...(filters.status !== undefined && { status: filters.status }),
        ...(productIds !== undefined && { productIds }),
      });
      if (rows.length > MAX_OFFERINGS) throw validation("This warehouse has too many products to show at once; narrow it with q or status");

      const info = new Map<string, ProductInfo>((await products.getMany(rows.map(o => o.productId))).map(p => [p.id, p]));
      const byCategory = new Map<string, TreeProduct[]>();
      for (const offering of rows) {
        const product = info.get(offering.productId);
        if (!product) continue;
        if (filters.lowStock) {
          const low = product.stockMode === "pooled_weight"
            ? isLow(product, offering.stockGrams ?? 0, thresholds)
            : offering.variants.some(v => isLow(product, v.stock ?? 0, thresholds));
          if (!low) continue;
        }
        const entry: TreeProduct = {
          offeringId: offering.id, productId: product.id, name: product.name, status: offering.status, rev: offering.rev, stockGrams: offering.stockGrams,
          variants: offering.variants.map(v => ({
            variantId: v.variantId, label: product.variants.find(p => p.id === v.variantId)?.label ?? "", price: v.price, mrp: v.mrp,
            salePrice: v.salePrice, stock: v.stock, isActive: v.isActive,
          })),
        };
        byCategory.set(product.categoryId, [...(byCategory.get(product.categoryId) ?? []), entry]);
      }

      const categories = await products.categories();
      const children = new Map<string | null, typeof categories>();
      for (const category of categories) children.set(category.parentId, [...(children.get(category.parentId) ?? []), category]);
      const order = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
      /** Categories with no products anywhere below them are left out. */
      const build = (parentId: string | null): TreeCategory[] => (children.get(parentId) ?? []).sort(order).flatMap(category => {
        const nested = build(category.id);
        const own = (byCategory.get(category.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
        return own.length === 0 && nested.length === 0 ? [] : [{ id: category.id, name: category.name, products: own, children: nested }];
      });
      return { warehouseId, categories: build(null) };
    },
  };
}

export type TreeService = ReturnType<typeof createTreeService>;
