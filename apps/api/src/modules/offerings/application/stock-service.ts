import { AppError, conflict, notFound, validation } from "../../catalog/catalog.public.js";
import {
  discountAmount, discountPercent, effectivePrice, gramsFor, isSellable, onSale, unitsAvailable, type Offering, type ProductInfo,
} from "../domain/stock.js";
import { DuplicateRestoreError, type OfferingsDeps, type Reservation, type ReservationLine, type StockEvent, type StockMovement } from "./ports.js";
import { stockSideEffects, withStock } from "./stock-effects.js";

export interface ReserveLine { warehouseId: string; productId: string; variantId: string; qty: number }
export interface Shortage { warehouseId: string; productId: string; variantId: string; requested: number; available: number; reason: "not_offered" | "not_sellable" | "insufficient" }
export interface ReservationView { key: string; status: Reservation["status"]; expiresAt: Date | null; lines: ReservationLine[] }
export type ReserveResult = { ok: true; replay: boolean; reservation: ReservationView } | { ok: false; shortages: Shortage[] };

export interface LineResolution {
  productId: string; variantId: string; name: string; variantLabel: string; weightGrams: number; qty: number;
  unitPrice: number | null; mrp: number | null; discountAmount: number; discountPercent: number; onSale: boolean; saleEndsAt: Date | null; maxQty: number | null; sellable: boolean;
  reason: "not_sold_in_zone" | "not_sellable" | null;
  /** Units each warehouse of the zone could supply now. The caller (allocation) chooses the warehouse. */
  warehouses: { warehouseId: string; availableUnits: number }[];
}

const DEFAULT_HOLD_SECONDS = 900;
class ShortageSignal extends Error { constructor(readonly shortages: Shortage[]) { super("Stock shortage"); } }

const view = ({ key, status, expiresAt, lines }: Reservation): ReservationView => ({ key, status, expiresAt, lines });

/** Merge repeated lines for the same warehouse, product and variant so the shortage check sees the true total. */
function mergeLines(lines: readonly ReserveLine[]): ReserveLine[] {
  const merged = new Map<string, ReserveLine>();
  for (const line of lines) {
    const id = `${line.warehouseId}|${line.productId}|${line.variantId}`;
    const existing = merged.get(id);
    merged.set(id, existing ? { ...existing, qty: existing.qty + line.qty } : { ...line });
  }
  return [...merged.values()];
}

function assertLines(lines: readonly ReserveLine[]) {
  if (lines.length === 0 || lines.length > 100) throw validation("Between 1 and 100 lines are required");
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 1000) throw validation("Each quantity must be a whole number from 1 to 1000");
  }
}

/**
 * Atomic stock operations used by orders (provided to the orders module through the `stock` port) and the price lookup used by
 * cart and quote (the `catalog` port). Stock only ever changes through conditional updates inside a MongoDB transaction.
 */
export function createStockService(deps: OfferingsDeps) {
  const { store, products, events, now, newId, thresholds } = deps;

  async function publish(list: StockEvent[]) {
    // A failing listener must never undo or fail committed stock changes.
    await Promise.allSettled(list.map(async event => events.publish(event)));
  }
  async function productMap(ids: readonly string[]): Promise<Map<string, ProductInfo>> {
    return new Map((await products.getMany([...new Set(ids)])).map(p => [p.id, p]));
  }

  function amountOf(product: ProductInfo, variantId: string, qty: number): number | null {
    const info = product.variants.find(v => v.id === variantId);
    if (!info) return null;
    return product.stockMode === "pooled_weight" ? gramsFor(info.weightGrams, qty) : qty;
  }

  /** Give stock back for one reservation line inside a transaction. */
  async function giveBack(tx: Parameters<Parameters<typeof store.transaction>[0]>[0], product: ProductInfo, line: ReservationLine, qty: number, reason: StockMovement["reason"], key: string, restoreKey: string | null, events: StockEvent[], at: Date) {
    const offering = await tx.getByWarehouseProduct(line.warehouseId, line.productId);
    if (!offering) return;
    const pooled = line.mode === "grams";
    const applied = await tx.applyStockDelta({ offeringId: offering.id, variantId: pooled ? null : line.variantId, delta: (line.amount / line.qty) * qty, requireSellable: false, at });
    if (!applied) return;
    await tx.insertMovements([{
      id: newId(), warehouseId: line.warehouseId, productId: line.productId, variantId: pooled ? null : line.variantId, mode: line.mode,
      delta: applied.after - applied.before, balanceAfter: applied.after, reason, orderKey: key, restoreKey, note: null, by: null, createdAt: at,
    }]);
    await stockSideEffects(tx, await thresholds({ warehouseId: line.warehouseId }), product, offering, withStock(offering, pooled ? null : line.variantId, applied.after), events);
  }

  async function release(key: string, why: "cancel" | "expired" | "payment_failed"): Promise<{ released: boolean }> {
    const eventsOut: StockEvent[] = [];
    const reservation = await store.transaction(async tx => {
      eventsOut.length = 0;
      const found = await tx.getReservation(key);
      if (!found || found.status === "released") return null;
      const map = await productMap(found.lines.map(l => l.productId));
      const at = now();
      for (const line of found.lines) {
        const remaining = line.qty - line.restored;
        const product = map.get(line.productId);
        if (remaining > 0 && product) await giveBack(tx, product, line, remaining, "cancel", key, null, eventsOut, at);
        line.restored = line.qty;
      }
      found.status = "released"; found.expiresAt = null; found.releasedAt = at; found.updatedAt = at;
      await tx.saveReservation(found);
      return found;
    });
    void why;
    await publish(eventsOut);
    return { released: reservation !== null };
  }

  return {
    /** All-or-nothing: either every line is deducted and the reservation is saved, or nothing changes. Idempotent by `key`. */
    async reserve(input: { key: string; lines: readonly ReserveLine[]; holdSeconds?: number }): Promise<ReserveResult> {
      if (!input.key || input.key.length > 200) throw validation("A reservation key of 1 to 200 characters is required");
      assertLines(input.lines);
      const lines = mergeLines(input.lines);
      const map = await productMap(lines.map(l => l.productId));
      const eventsOut: StockEvent[] = [];
      try {
        const outcome = await store.transaction(async tx => {
          eventsOut.length = 0;
          const existing = await tx.getReservation(input.key);
          if (existing) {
            if (existing.status === "released") throw conflict("This reservation was already released; use a new key", { reason: "reservation_released" });
            return { reservation: existing, replay: true };
          }
          const at = now();
          const shortages: Shortage[] = [];
          const movements: StockMovement[] = [];
          const applied: ReservationLine[] = [];
          for (const line of lines) {
            const product = map.get(line.productId);
            const offering = await tx.getByWarehouseProduct(line.warehouseId, line.productId);
            const amount = product ? amountOf(product, line.variantId, line.qty) : null;
            if (!product || !offering || amount === null) { shortages.push({ ...line, requested: line.qty, available: 0, reason: "not_offered" }); continue; }
            const available = unitsAvailable(product, offering, line.variantId);
            const pooled = product.stockMode === "pooled_weight";
            const change = available >= line.qty
              ? await tx.applyStockDelta({ offeringId: offering.id, variantId: pooled ? null : line.variantId, delta: -amount, requireSellable: true, at })
              : null;
            if (!change) {
              shortages.push({ ...line, requested: line.qty, available, reason: isSellable(product, offering, line.variantId) ? "insufficient" : "not_sellable" });
              continue;
            }
            movements.push({
              id: newId(), warehouseId: line.warehouseId, productId: line.productId, variantId: pooled ? null : line.variantId,
              mode: pooled ? "grams" : "units", delta: -amount, balanceAfter: change.after, reason: "order", orderKey: input.key,
              restoreKey: null, note: null, by: null, createdAt: at,
            });
            applied.push({ warehouseId: line.warehouseId, productId: line.productId, variantId: line.variantId, qty: line.qty, amount, mode: pooled ? "grams" : "units", restored: 0 });
            await stockSideEffects(tx, await thresholds({ warehouseId: line.warehouseId }), product, offering, withStock(offering, pooled ? null : line.variantId, change.after), eventsOut);
          }
          if (shortages.length > 0) throw new ShortageSignal(shortages);
          await tx.insertMovements(movements);
          const reservation: Reservation = {
            id: newId(), key: input.key, status: "held", expiresAt: new Date(at.getTime() + (input.holdSeconds ?? DEFAULT_HOLD_SECONDS) * 1000),
            lines: applied, createdAt: at, updatedAt: at, releasedAt: null,
          };
          await tx.insertReservation(reservation);
          return { reservation, replay: false };
        });
        await publish(eventsOut);
        return { ok: true, replay: outcome.replay, reservation: view(outcome.reservation) };
      } catch (error) {
        if (error instanceof ShortageSignal) return { ok: false, shortages: error.shortages };
        throw error;
      }
    },

    /** The order exists now: stop the hold from expiring. Idempotent. */
    async confirm(key: string): Promise<ReservationView> {
      return view(await store.transaction(async tx => {
        const found = await tx.getReservation(key);
        if (!found) throw notFound("Reservation");
        if (found.status === "released") throw conflict("This reservation was already released", { reason: "reservation_released" });
        if (found.status === "held") { found.status = "confirmed"; found.expiresAt = null; found.updatedAt = now(); await tx.saveReservation(found); }
        return found;
      }));
    },

    /** Cancel, payment expiry or an expired hold: give back whatever has not already been restored. Idempotent. */
    release,

    /**
     * Give back part of a reservation (an item removed at packing, or goods returned undamaged).
     * `restoreKey` makes the call idempotent. Spoiled goods are simply not restored (a wastage decision, no stock change).
     */
    async restore(input: { key: string; restoreKey: string; reason: "cancel" | "return"; lines: readonly { warehouseId: string; productId: string; variantId: string; qty: number }[] }): Promise<{ applied: boolean }> {
      assertLines(input.lines);
      if (!input.restoreKey || input.restoreKey.length > 200) throw validation("A restore key of 1 to 200 characters is required");
      const lines = mergeLines(input.lines);
      const map = await productMap(lines.map(l => l.productId));
      const eventsOut: StockEvent[] = [];
      try {
        const applied = await store.transaction(async tx => {
          eventsOut.length = 0;
          if (await tx.hasRestore(input.restoreKey)) return false;
          const found = await tx.getReservation(input.key);
          if (!found) throw notFound("Reservation");
          if (found.status === "released") throw conflict("This reservation was already released", { reason: "reservation_released" });
          const at = now();
          for (const wanted of lines) {
            const line = found.lines.find(l => l.warehouseId === wanted.warehouseId && l.productId === wanted.productId && l.variantId === wanted.variantId);
            if (!line) throw validation("The line is not part of this reservation", { productId: wanted.productId, variantId: wanted.variantId });
            if (wanted.qty > line.qty - line.restored) throw validation("More than the remaining reserved quantity", { productId: wanted.productId, variantId: wanted.variantId });
            const product = map.get(line.productId);
            if (product) await giveBack(tx, product, line, wanted.qty, input.reason, input.key, input.restoreKey, eventsOut, at);
            line.restored += wanted.qty;
          }
          found.updatedAt = at;
          await tx.saveReservation(found);
          return true;
        });
        await publish(eventsOut);
        return { applied };
      } catch (error) {
        if (error instanceof DuplicateRestoreError) return { applied: false };
        throw error;
      }
    },

    /** Safety net for crashes: holds never confirmed by the order module are released once they expire. Run periodically. */
    async releaseExpiredHolds(limit = 100): Promise<number> {
      let released = 0;
      for (const key of await store.expiredHoldKeys(now(), limit)) if ((await release(key, "expired")).released) released++;
      return released;
    },

    // ---------- price and availability lookup for cart and quote (the `catalog` port) ----------
    async resolveLines(input: { zoneId: string; lines: readonly { productId: string; variantId: string; qty: number }[] }): Promise<LineResolution[]> {
      const at = now();
      const map = await productMap(input.lines.map(l => l.productId));
      const byProduct = new Map<string, Offering[]>();
      for (const id of map.keys()) byProduct.set(id, await store.listByZoneProduct(input.zoneId, id));
      return input.lines.map((line): LineResolution => {
        const product = map.get(line.productId);
        const info = product?.variants.find(v => v.id === line.variantId);
        const offered = (byProduct.get(line.productId) ?? []).filter(o => o.status === "active" && o.variants.some(v => v.variantId === line.variantId && v.isActive));
        const base = { productId: line.productId, variantId: line.variantId, qty: line.qty };
        if (!product || !info || product.status !== "active" || offered.length === 0) {
          return { ...base, name: product?.name ?? "", variantLabel: info?.label ?? "", weightGrams: info?.weightGrams ?? 0, unitPrice: null, mrp: null, discountAmount: 0, discountPercent: 0, onSale: false, saleEndsAt: null, maxQty: null, sellable: false, reason: "not_sold_in_zone", warehouses: [] };
        }
        const rows = offered.map(o => ({ offering: o, line: o.variants.find(v => v.variantId === line.variantId)!, units: unitsAvailable(product, o, line.variantId) }));
        const priced = rows.some(r => r.units > 0) ? rows.filter(r => r.units > 0) : rows;
        const cheapest = priced.reduce((a, b) => (effectivePrice(b.line, at) < effectivePrice(a.line, at) ? b : a));
        const caps = rows.map(r => r.line.maxQtyPerOrder).filter((n): n is number => n !== null);
        const sellable = rows.some(r => r.units > 0);
        return {
          ...base, name: product.name, variantLabel: info.label, weightGrams: info.weightGrams,
          unitPrice: effectivePrice(cheapest.line, at), mrp: cheapest.line.mrp,
          discountAmount: discountAmount(cheapest.line.mrp, effectivePrice(cheapest.line, at)), discountPercent: discountPercent(cheapest.line.mrp, effectivePrice(cheapest.line, at)),
          onSale: onSale(cheapest.line, at), saleEndsAt: onSale(cheapest.line, at) ? cheapest.line.saleEnd : null,
          maxQty: caps.length > 0 ? Math.min(...caps) : null, sellable, reason: sellable ? null : "not_sellable",
          warehouses: rows.map(r => ({ warehouseId: r.offering.warehouseId, availableUnits: r.units })),
        };
      });
    },
  };
}

export type StockService = ReturnType<typeof createStockService>;
export { AppError };
