import type { SettingsProvider } from "../../../platform/settings.js";
import type { Ctx } from "../../catalog/catalog.public.js";
import type { Offering, OfferingStatus, ProductInfo, StockThresholds } from "../domain/stock.js";

export type MovementReason = "order" | "cancel" | "return" | "purchase" | "correction" | "wastage" | "count" | "import";
export interface StockMovement {
  id: string; warehouseId: string; productId: string; variantId: string | null; mode: "grams" | "units";
  delta: number; balanceAfter: number; reason: MovementReason; orderKey: string | null; restoreKey: string | null;
  note: string | null; by: string | null; createdAt: Date;
}
export interface PriceHistoryRow {
  id: string; warehouseId: string; productId: string; variantId: string; oldPrice: number; newPrice: number;
  oldMrp: number; newMrp: number; by: string | null; at: Date;
}

/** One stock deduction made for a reservation. `amount` is grams (pooled) or units; `restored` counts quantity given back. */
export interface ReservationLine { warehouseId: string; productId: string; variantId: string; qty: number; amount: number; mode: "grams" | "units"; restored: number }
export interface Reservation {
  id: string; key: string; status: "held" | "confirmed" | "released"; expiresAt: Date | null; lines: ReservationLine[];
  createdAt: Date; updatedAt: Date; releasedAt: Date | null;
}

export type StockEvent =
  | { type: "stock.zone_availability_changed"; zoneId: string; productId: string; variantId: string }
  | { type: "stock.low"; warehouseId: string; productId: string; variantId: string | null; stock: number; threshold: number };

export interface WarehouseDirectory { get(warehouseId: string): Promise<{ id: string; zoneId: string; isEnabled: boolean } | null> }
export interface ProductDirectory {
  getMany(ids: readonly string[]): Promise<ProductInfo[]>;
  /** Every category, for the warehouse tree and for importing a whole category. */
  categories(): Promise<{ id: string; name: string; parentId: string | null; sortOrder: number }[]>;
  /** Ids of products matching a name or SKU search and category, for filtering offering lists. */
  searchIds(params: { q?: string; categoryId?: string }): Promise<string[]>;
}
export interface EventPublisher { publish(event: StockEvent): void | Promise<void> }

export interface OfferingListQuery {
  warehouseIds: readonly string[] | null; status?: OfferingStatus; productIds?: readonly string[]; afterId?: string; limit: number;
}
export interface MovementQuery {
  warehouseIds: readonly string[] | null; productId?: string; reason?: MovementReason; from?: Date; to?: Date; beforeId?: string; limit: number;
}
export interface PriceHistoryQuery {
  warehouseIds: readonly string[] | null; productId?: string; variantId?: string; from?: Date; to?: Date; beforeId?: string; limit: number;
}

export interface ZoneOfferingsQuery {
  zoneId: string; productIds?: readonly string[];
  /** Only offerings that are switched on. Without it, every offering is returned (the delta feed needs the others to report removals). */
  activeOnly?: boolean;
}

export interface OfferingsReads {
  getOffering(id: string): Promise<Offering | null>;
  getByWarehouseProduct(warehouseId: string, productId: string): Promise<Offering | null>;
  listOfferings(query: OfferingListQuery): Promise<Offering[]>;
  listByZoneProduct(zoneId: string, productId: string): Promise<Offering[]>;
  listByProduct(productId: string): Promise<Offering[]>;
}

/** Everything a stock or price change needs, run atomically. Duplicate keys surface as CONFLICT or DuplicateRestoreError. */
export interface OfferingsTx extends OfferingsReads {
  /** Forces concurrent price writers for one zone and product to serialise, so the same-price rule cannot be bypassed. */
  lockZoneProduct(zoneId: string, productId: string): Promise<void>;
  nextRevision(): Promise<number>;
  insertOffering(offering: Offering): Promise<void>;
  replaceOffering(offering: Offering): Promise<void>;
  /** Conditional atomic change of one stock figure. Returns null when a decrease would go below zero or, with `requireSellable`, the offering is not sellable. */
  applyStockDelta(change: { offeringId: string; variantId: string | null; delta: number; requireSellable: boolean; at: Date }): Promise<{ before: number; after: number } | null>;
  setRev(offeringId: string, rev: number): Promise<void>;
  insertMovements(rows: readonly StockMovement[]): Promise<void>;
  hasRestore(restoreKey: string): Promise<boolean>;
  insertPriceHistory(rows: readonly PriceHistoryRow[]): Promise<void>;
  getPreview(id: string): Promise<ImportPreview | null>;
  /** Returns false when the preview was already used or has gone, so a preview can be committed only once. */
  deletePreview(id: string): Promise<boolean>;
  getReservation(key: string): Promise<Reservation | null>;
  insertReservation(reservation: Reservation): Promise<void>;
  saveReservation(reservation: Reservation): Promise<void>;
}

export class DuplicateRestoreError extends Error { constructor() { super("This restore was already applied"); this.name = "DuplicateRestoreError"; } }

export interface OfferingsStore extends OfferingsReads {
  ensureIndexes(): Promise<void>;
  /** Offerings of a zone (all warehouses), optionally narrowed to some products. */
  zoneOfferings(query: ZoneOfferingsQuery): Promise<Offering[]>;
  /** Offerings of a zone changed after revision `since`, oldest revision first. */
  changedSince(zoneId: string, since: number, limit: number): Promise<Offering[]>;
  /** The latest revision handed out so far (0 before any). */
  currentRevision(): Promise<number>;
  transaction<T>(fn: (tx: OfferingsTx) => Promise<T>): Promise<T>;
  listMovements(query: MovementQuery): Promise<StockMovement[]>;
  listPriceHistory(query: PriceHistoryQuery): Promise<PriceHistoryRow[]>;
  expiredHoldKeys(now: Date, limit: number): Promise<string[]>;
  savePreview(preview: ImportPreview): Promise<void>;
  getPreview(id: string): Promise<ImportPreview | null>;
  countByProduct(productId: string): Promise<number>;
}

export type ImportQuantityMode = "copy" | "zero" | "fixed";
export type ImportAction = "create" | "overwrite" | "skip";
export interface ImportOptions { quantityMode: ImportQuantityMode; onConflict: "skip" | "overwrite"; markupPercent: number; fixedQuantity: number | null }
export interface ImportVariantPlan {
  variantId: string; label: string; price: number; mrp: number; salePrice: number | null; saleStart: Date | null; saleEnd: Date | null;
  stock: number | null; maxQtyPerOrder: number | null;
}
export interface ImportRowPlan {
  productId: string; name: string; alreadyInTarget: boolean; action: ImportAction; stockGrams: number | null;
  variants: ImportVariantPlan[]; warnings: { code: string; message: string }[];
  conflicts: { variantId: string; conflicts: { warehouseId: string; price: number }[] }[];
}
/** What the preview step computed. It is stored so commit can check the admin's edits against it. */
export interface ImportPreview {
  id: string; userId: string; sourceWarehouseId: string; targetWarehouseId: string; options: ImportOptions;
  rows: ImportRowPlan[]; createdAt: Date; expiresAt: Date;
}

export interface OfferingsDeps {
  store: OfferingsStore; warehouses: WarehouseDirectory; products: ProductDirectory; events: EventPublisher;
  now: () => Date; newId: () => string; thresholds: SettingsProvider<StockThresholds>;
  /** `block` refuses a price that differs from another warehouse of the zone; `warn` lets it through (the import preview still lists it). */
  priceConflictMode: () => Promise<"block" | "warn">;
}
