import type { BulkAction, Offering, OfferingStatus } from "../domain/stock.js";
import type { MovementReason } from "./ports.js";

export interface OfferingVariantInput {
  variantId: string; price: number; mrp: number; salePrice: number | null; saleStart: Date | null; saleEnd: Date | null;
  stock: number | null; maxQtyPerOrder: number | null;
}
export interface CreateOfferingInput { warehouseId: string; productId: string; stockGrams: number | null; variants: OfferingVariantInput[] }

export interface VariantPatchInput {
  variantId: string; price?: number | undefined; mrp?: number | undefined; salePrice?: number | null | undefined;
  saleStart?: Date | null | undefined; saleEnd?: Date | null | undefined; stock?: number | null | undefined;
  maxQtyPerOrder?: number | null | undefined; isActive?: boolean | undefined;
}
/** `rev: null` skips the optimistic-lock check (used by bulk edits, which are "set" operations). */
export interface UpdateOfferingInput {
  rev: number | null; status?: OfferingStatus | undefined; stockGrams?: number | undefined; isOutOfStockOverride?: boolean | undefined;
  variants?: VariantPatchInput[] | undefined; applyToWarehouseIds?: string[] | undefined;
}
export interface BulkInput { ids: string[]; action: BulkAction }
export interface AdjustInput { warehouseId: string; productId: string; variantId: string | null; delta: number; reason: Extract<MovementReason, "purchase" | "wastage" | "correction">; note: string | null }
export interface CountInput { warehouseId: string; counts: { productId: string; variantId: string | null; counted: number }[] }

export interface OfferingListFilters { q?: string | undefined; categoryId?: string | undefined; status?: OfferingStatus | undefined; lowStock?: boolean | undefined; cursor?: string | undefined; limit: number }
export interface LevelsFilters { warehouseId?: string | undefined; lowStock?: boolean | undefined; cursor?: string | undefined; limit: number }
export interface MovementFilters { warehouseId?: string | undefined; productId?: string | undefined; reason?: MovementReasonFilter | undefined; from?: Date | undefined; to?: Date | undefined; cursor?: string | undefined; limit: number }
export type MovementReasonFilter = MovementReason;
export interface HistoryFilters { warehouseId?: string | undefined; productId?: string | undefined; variantId?: string | undefined; from?: Date | undefined; to?: Date | undefined; cursor?: string | undefined; limit: number }

export interface OfferingView {
  id: string; warehouseId: string; productId: string; zoneId: string;
  product: { name: string; type: string; stockMode: string; categoryId: string };
  status: OfferingStatus; stockGrams: number | null;
  variants: {
    variantId: string; label: string; weightGrams: number; price: number; mrp: number; salePrice: number | null;
    saleStart: string | null; saleEnd: string | null;
    /** Computed on every read, never stored or accepted as input. */
    effectivePrice: number; onSale: boolean; discountAmount: number; discountPercent: number;
    stock: number | null; maxQtyPerOrder: number | null; isActive: boolean;
  }[];
  isOutOfStockOverride: boolean; rev: number; importedFrom: { warehouseId: string; at: string; by: string } | null;
  warnings?: { code: string; message: string }[];
}

export type { Offering };
