import {
  AppError, assertWarehouseScope, conflict, notFound, validation, type Ctx,
} from "../../catalog/catalog.public.js";
import {
  bulkPrice, discountAmount, discountPercent, effectivePrice, findPriceConflicts, isLow, onSale, pricingProblems, unitsAvailable, type Offering, type OfferingVariant, type PriceConflict, type ProductInfo,
} from "../domain/stock.js";
import type { OfferingsDeps, OfferingsTx, PriceHistoryRow, StockEvent, StockMovement } from "./ports.js";
import { stockSideEffects, withZeroStock } from "./stock-effects.js";
import type {
  AdjustInput, BulkInput, CountInput, CreateOfferingInput, HistoryFilters, LevelsFilters, MovementFilters, OfferingListFilters,
  OfferingView, UpdateOfferingInput, VariantPatchInput,
} from "./types.js";

const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const id = Buffer.from(cursor, "base64url").toString();
  if (!/^[a-f0-9]{24}$/.test(id)) throw validation("Invalid cursor", { field: "cursor" });
  return id;
}

export function createOfferingsService(deps: OfferingsDeps) {
  const { store, warehouses, products, events, now, newId, thresholds, priceConflictMode } = deps;

  async function publish(list: StockEvent[]) { await Promise.allSettled(list.map(async event => events.publish(event))); }

  async function loadProduct(productId: string): Promise<ProductInfo> {
    const [product] = await products.getMany([productId]);
    if (!product) throw notFound("Product");
    return product;
  }

  function toView(offering: Offering, product: ProductInfo): OfferingView {
    const at = now();
    return {
      id: offering.id, warehouseId: offering.warehouseId, productId: offering.productId, zoneId: offering.zoneId,
      product: { name: product.name, type: product.type, stockMode: product.stockMode, categoryId: product.categoryId },
      status: offering.status, stockGrams: offering.stockGrams,
      variants: offering.variants.map(v => {
        const info = product.variants.find(p => p.id === v.variantId);
        return {
          variantId: v.variantId, label: info?.label ?? "", weightGrams: info?.weightGrams ?? 0, price: v.price, mrp: v.mrp, salePrice: v.salePrice,
          saleStart: v.saleStart?.toISOString() ?? null, saleEnd: v.saleEnd?.toISOString() ?? null,
          effectivePrice: effectivePrice(v, at), onSale: onSale(v, at), discountAmount: discountAmount(v.mrp, effectivePrice(v, at)), discountPercent: discountPercent(v.mrp, effectivePrice(v, at)),
          stock: v.stock, maxQtyPerOrder: v.maxQtyPerOrder, isActive: v.isActive,
        };
      }),
      isOutOfStockOverride: offering.isOutOfStockOverride, rev: offering.rev,
      importedFrom: offering.importedFrom ? { warehouseId: offering.importedFrom.warehouseId, at: offering.importedFrom.at.toISOString(), by: offering.importedFrom.by } : null,
    };
  }

  /** Warehouses a request may touch: the named one (scope-checked), or every warehouse for all-scope staff, or the staff member's own. */
  function scopeIds(ctx: Ctx, warehouseId?: string): readonly string[] | null {
    if (warehouseId !== undefined) { assertWarehouseScope(ctx.actor, warehouseId); return [warehouseId]; }
    return ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds;
  }

  function priceConflictError(conflicts: PriceConflict[], canApplyToOthers: boolean) {
    const first = conflicts[0]!;
    return new AppError("PRICE_CONFLICT", "Price differs from another warehouse in this zone", {
      variantId: first.variantId, conflicts: first.conflicts, canApplyToOthers, variants: conflicts,
    });
  }

  function movement(offering: Offering, product: ProductInfo, variantId: string | null, delta: number, balanceAfter: number, reason: StockMovement["reason"], note: string | null, ctx: Ctx, at: Date): StockMovement {
    return {
      id: newId(), warehouseId: offering.warehouseId, productId: offering.productId, variantId,
      mode: product.stockMode === "pooled_weight" ? "grams" : "units", delta, balanceAfter, reason, orderKey: null, restoreKey: null, note, by: ctx.actor.userId, createdAt: at,
    };
  }

  /** Apply a stock/price/status patch to one offering inside an open transaction. */
  async function applyUpdate(tx: OfferingsTx, ctx: Ctx, product: ProductInfo, id: string, make: UpdateOfferingInput | ((current: Offering) => UpdateOfferingInput), out: StockEvent[], at: Date): Promise<Offering> {
    const current = await tx.getOffering(id);
    if (!current || current.productId !== product.id) throw notFound("Offering");
    assertWarehouseScope(ctx.actor, current.warehouseId);
    const patch = typeof make === "function" ? make(current) : make;
    if (patch.rev !== null && patch.rev !== current.rev) throw new AppError("VERSION_CONFLICT", "This record changed since you loaded it. Reload and try again.", { currentRev: current.rev });

    const before = structuredClone(current);
    const next = structuredClone(current);
    const pooled = product.stockMode === "pooled_weight";
    const history: PriceHistoryRow[] = [];
    const moves: StockMovement[] = [];
    /** Lines whose price or sale changed: these are checked against the same-zone price rule. */
    const changedLines: OfferingVariant[] = [];
    /** Every line the patch touched: these are validated even when only the MRP or a limit changed. */
    const touchedLines: OfferingVariant[] = [];
    const priceHistoryFor = (line: OfferingVariant, old: OfferingVariant) =>
      history.push({ id: newId(), warehouseId: next.warehouseId, productId: next.productId, variantId: line.variantId, oldPrice: old.price, newPrice: line.price, oldMrp: old.mrp, newMrp: line.mrp, by: ctx.actor.userId, at });

    if (patch.status !== undefined) next.status = patch.status;
    if (patch.isOutOfStockOverride !== undefined) next.isOutOfStockOverride = patch.isOutOfStockOverride;
    if (patch.stockGrams !== undefined) {
      if (!pooled) throw validation("stockGrams applies only to pooled-weight products", { field: "stockGrams" });
      if (patch.stockGrams !== (current.stockGrams ?? 0)) moves.push(movement(next, product, null, patch.stockGrams - (current.stockGrams ?? 0), patch.stockGrams, "correction", "Edited from the product tree", ctx, at));
      next.stockGrams = patch.stockGrams;
    }
    for (const vp of patch.variants ?? []) {
      const info = product.variants.find(v => v.id === vp.variantId);
      if (!info) throw validation("Unknown variant for this product", { variantId: vp.variantId });
      let line = next.variants.find(v => v.variantId === vp.variantId);
      if (!line) {
        if (vp.price === undefined || vp.mrp === undefined) throw validation("price and mrp are required to start selling a variant", { variantId: vp.variantId });
        if (pooled && vp.stock != null) throw validation("stock applies only to per-variant products", { variantId: vp.variantId });
        if (!pooled && (vp.stock === undefined || vp.stock === null)) throw validation("stock is required for a per-variant product", { variantId: vp.variantId });
        line = {
          variantId: vp.variantId, price: vp.price, mrp: vp.mrp, salePrice: vp.salePrice ?? null, saleStart: vp.saleStart ?? null, saleEnd: vp.saleEnd ?? null,
          stock: pooled ? null : (vp.stock ?? 0), maxQtyPerOrder: vp.maxQtyPerOrder ?? null, isActive: vp.isActive ?? true,
        };
        next.variants.push(line);
        changedLines.push(line);
        if (!pooled && (line.stock ?? 0) > 0) moves.push(movement(next, product, line.variantId, line.stock!, line.stock!, "correction", "Initial stock", ctx, at));
        continue;
      }
      const old = structuredClone(line);
      touchedLines.push(line);
      if (vp.price !== undefined) line.price = vp.price;
      if (vp.mrp !== undefined) line.mrp = vp.mrp;
      if (vp.salePrice !== undefined) line.salePrice = vp.salePrice;
      if (vp.saleStart !== undefined) line.saleStart = vp.saleStart;
      if (vp.saleEnd !== undefined) line.saleEnd = vp.saleEnd;
      if (vp.maxQtyPerOrder !== undefined) line.maxQtyPerOrder = vp.maxQtyPerOrder;
      if (vp.isActive !== undefined) line.isActive = vp.isActive;
      if (vp.stock !== undefined) {
        if (pooled) throw validation("stock applies only to per-variant products", { variantId: vp.variantId });
        if (vp.stock === null) throw validation("stock cannot be cleared on a per-variant product", { variantId: vp.variantId });
        if (vp.stock !== (old.stock ?? 0)) moves.push(movement(next, product, line.variantId, vp.stock - (old.stock ?? 0), vp.stock, "correction", "Edited from the product tree", ctx, at));
        line.stock = vp.stock;
      }
      if (line.price !== old.price || line.mrp !== old.mrp) priceHistoryFor(line, old);
      if (effectivePrice(line, at) !== effectivePrice(old, at) || line.price !== old.price || line.salePrice !== old.salePrice) changedLines.push(line);
    }
    for (const line of new Set([...touchedLines, ...changedLines])) {
      const problems = pricingProblems(line);
      if (problems.length > 0) throw validation("Invalid price", { variantId: line.variantId, problems });
    }
    for (const line of changedLines.filter(l => !before.variants.some(b => b.variantId === l.variantId))) {
      history.push({ id: newId(), warehouseId: next.warehouseId, productId: next.productId, variantId: line.variantId, oldPrice: 0, newPrice: line.price, oldMrp: 0, newMrp: line.mrp, by: ctx.actor.userId, at });
    }

    const rev = await tx.nextRevision();
    const touched: Offering[] = [];
    if (changedLines.length > 0) {
      await tx.lockZoneProduct(next.zoneId, next.productId);
      const others = (await tx.listByZoneProduct(next.zoneId, next.productId)).filter(o => o.id !== next.id);
      const applyTo = new Set(patch.applyToWarehouseIds ?? []);
      for (const wanted of applyTo) if (!others.some(o => o.warehouseId === wanted)) throw validation("applyToWarehouseIds must be other warehouses of this zone that sell the product", { warehouseId: wanted });
      const conflicts = findPriceConflicts(changedLines, others, at);
      if (conflicts.some(c => c.conflicts.some(x => !applyTo.has(x.warehouseId))) && (await priceConflictMode()) === "block") throw priceConflictError(conflicts, true);
      for (const other of others.filter(o => applyTo.has(o.warehouseId))) {
        assertWarehouseScope(ctx.actor, other.warehouseId);
        for (const line of changedLines) {
          const theirs = other.variants.find(v => v.variantId === line.variantId);
          if (!theirs) continue;
          const old = structuredClone(theirs);
          Object.assign(theirs, { price: line.price, mrp: line.mrp, salePrice: line.salePrice, saleStart: line.saleStart, saleEnd: line.saleEnd });
          if (old.price !== theirs.price || old.mrp !== theirs.mrp) history.push({ id: newId(), warehouseId: other.warehouseId, productId: other.productId, variantId: line.variantId, oldPrice: old.price, newPrice: theirs.price, oldMrp: old.mrp, newMrp: theirs.mrp, by: ctx.actor.userId, at });
        }
        other.rev = rev; other.updatedAt = at;
        touched.push(other);
      }
    }
    next.rev = rev; next.updatedAt = at;
    await tx.replaceOffering(next);
    for (const other of touched) await tx.replaceOffering(other);
    await tx.insertMovements(moves);
    await tx.insertPriceHistory(history);
    await stockSideEffects(tx, await thresholds({ warehouseId: next.warehouseId }), product, before, next, out, { revAlreadyBumped: true });
    return next;
  }

  async function updateOne(ctx: Ctx, id: string, make: UpdateOfferingInput | ((current: Offering) => UpdateOfferingInput)): Promise<OfferingView> {
    const pre = await store.getOffering(id);
    if (!pre) throw notFound("Offering");
    assertWarehouseScope(ctx.actor, pre.warehouseId);
    const product = await loadProduct(pre.productId);
    const out: StockEvent[] = [];
    const updated = await store.transaction(tx => { out.length = 0; return applyUpdate(tx, ctx, product, id, make, out, now()); });
    await publish(out);
    return toView(updated, product);
  }

  async function changeStock(ctx: Ctx, offering: Offering, product: ProductInfo, variantId: string | null, compute: (current: number) => number, reason: StockMovement["reason"], note: string | null, out: StockEvent[], tx: OfferingsTx, at: Date) {
    const current = offering.stockGrams !== null && variantId === null ? offering.stockGrams : (offering.variants.find(v => v.variantId === variantId)?.stock ?? 0);
    const target = compute(current);
    const delta = target - current;
    if (target < 0) throw new AppError("INSUFFICIENT_STOCK", "Not enough stock for this change", { available: current, requested: -delta });
    if (delta === 0) return { delta: 0, balanceAfter: current, movementId: null as string | null };
    const applied = await tx.applyStockDelta({ offeringId: offering.id, variantId, delta, requireSellable: false, at });
    if (!applied) throw new AppError("INSUFFICIENT_STOCK", "Not enough stock for this change", { available: current, requested: -delta });
    const row = movement(offering, product, variantId, delta, applied.after, reason, note, ctx, at);
    await tx.insertMovements([row]);
    const after = variantId === null ? { ...offering, stockGrams: applied.after } : { ...offering, variants: offering.variants.map(v => (v.variantId === variantId ? { ...v, stock: applied.after } : v)) };
    await stockSideEffects(tx, await thresholds({ warehouseId: offering.warehouseId }), product, offering, after, out);
    return { delta, balanceAfter: applied.after, movementId: row.id };
  }

  async function findForStock(ctx: Ctx, warehouseId: string, productId: string, variantId: string | null) {
    assertWarehouseScope(ctx.actor, warehouseId);
    const offering = await store.getByWarehouseProduct(warehouseId, productId);
    if (!offering) throw notFound("Offering");
    const product = await loadProduct(productId);
    const pooled = product.stockMode === "pooled_weight";
    if (pooled && variantId !== null) throw validation("variantId must be null for a pooled-weight product", { field: "variantId" });
    if (!pooled && (variantId === null || !offering.variants.some(v => v.variantId === variantId))) throw validation("variantId must name a variant this warehouse sells", { field: "variantId" });
    return { offering, product };
  }

  return {
    async create(ctx: Ctx, input: CreateOfferingInput): Promise<OfferingView> {
      assertWarehouseScope(ctx.actor, input.warehouseId);
      const warehouse = await warehouses.get(input.warehouseId);
      if (!warehouse) throw notFound("Warehouse");
      const product = await loadProduct(input.productId);
      if (product.status === "archived") throw conflict("An archived product cannot be offered", { reason: "archived" });
      const pooled = product.stockMode === "pooled_weight";
      if (pooled && input.stockGrams === null) throw validation("stockGrams is required for a pooled-weight product", { field: "stockGrams" });
      if (!pooled && input.stockGrams !== null) throw validation("stockGrams applies only to pooled-weight products", { field: "stockGrams" });
      const seen = new Set<string>();
      for (const v of input.variants) {
        const info = product.variants.find(p => p.id === v.variantId);
        if (!info || !info.isActive) throw validation("Variant is not an active variant of this product", { variantId: v.variantId });
        if (seen.has(v.variantId)) throw validation("A variant is listed twice", { variantId: v.variantId });
        seen.add(v.variantId);
        if (pooled && v.stock !== null) throw validation("stock applies only to per-variant products", { variantId: v.variantId });
        if (!pooled && v.stock === null) throw validation("stock is required for a per-variant product", { variantId: v.variantId });
        const problems = pricingProblems(v);
        if (problems.length > 0) throw validation("Invalid price", { variantId: v.variantId, problems });
      }
      const at = now();
      const out: StockEvent[] = [];
      const created = await store.transaction(async tx => {
        out.length = 0;
        await tx.lockZoneProduct(warehouse.zoneId, product.id);
        const lines: OfferingVariant[] = input.variants.map(v => ({ ...v, isActive: true }));
        const conflicts = findPriceConflicts(lines, await tx.listByZoneProduct(warehouse.zoneId, product.id), at);
        if (conflicts.length > 0 && (await priceConflictMode()) === "block") throw priceConflictError(conflicts, false);
        const offering: Offering = {
          id: newId(), warehouseId: input.warehouseId, productId: input.productId, zoneId: warehouse.zoneId, status: "active",
          stockGrams: pooled ? input.stockGrams : null, variants: lines, isOutOfStockOverride: false, rev: await tx.nextRevision(),
          importedFrom: null, createdAt: at, updatedAt: at,
        };
        await tx.insertOffering(offering);
        const moves: StockMovement[] = [];
        if (pooled && (offering.stockGrams ?? 0) > 0) moves.push(movement(offering, product, null, offering.stockGrams!, offering.stockGrams!, "correction", "Initial stock", ctx, at));
        if (!pooled) for (const l of lines) if ((l.stock ?? 0) > 0) moves.push(movement(offering, product, l.variantId, l.stock!, l.stock!, "correction", "Initial stock", ctx, at));
        await tx.insertMovements(moves);
        await tx.insertPriceHistory(lines.map(l => ({ id: newId(), warehouseId: offering.warehouseId, productId: offering.productId, variantId: l.variantId, oldPrice: 0, newPrice: l.price, oldMrp: 0, newMrp: l.mrp, by: ctx.actor.userId, at })));
        await stockSideEffects(tx, await thresholds({ warehouseId: offering.warehouseId }), product, withZeroStock(product, offering), offering, out, { revAlreadyBumped: true });
        return offering;
      });
      await publish(out);
      return toView(created, product);
    },

    async get(ctx: Ctx, id: string): Promise<OfferingView> {
      const offering = await store.getOffering(id);
      if (!offering) throw notFound("Offering");
      assertWarehouseScope(ctx.actor, offering.warehouseId);
      return toView(offering, await loadProduct(offering.productId));
    },

    async listForWarehouse(ctx: Ctx, warehouseId: string, filters: OfferingListFilters): Promise<{ items: OfferingView[]; nextCursor: string | null }> {
      assertWarehouseScope(ctx.actor, warehouseId);
      const productIds = filters.q !== undefined || filters.categoryId !== undefined
        ? await products.searchIds({ ...(filters.q !== undefined && { q: filters.q }), ...(filters.categoryId !== undefined && { categoryId: filters.categoryId }) })
        : undefined;
      if (productIds && productIds.length === 0) return { items: [], nextCursor: null };
      const afterId = decodeCursor(filters.cursor);
      const rows = await store.listOfferings({
        warehouseIds: [warehouseId], limit: filters.limit + 1, ...(filters.status !== undefined && { status: filters.status }),
        ...(productIds !== undefined && { productIds }), ...(afterId !== undefined && { afterId }),
      });
      const page = rows.slice(0, filters.limit);
      const info = new Map((await products.getMany(page.map(o => o.productId))).map(p => [p.id, p]));
      // shortcut: lowStock filters the current page, so a page can hold fewer than `limit` rows. Upgrade with a stored low-stock flag if needed.
      const limits = await thresholds({ warehouseId });
      const items = page.flatMap(o => {
        const product = info.get(o.productId);
        if (!product) return [];
        if (filters.lowStock) {
          const low = product.stockMode === "pooled_weight" ? isLow(product, o.stockGrams ?? 0, limits) : o.variants.some(v => isLow(product, v.stock ?? 0, limits));
          if (!low) return [];
        }
        return [toView(o, product)];
      });
      return { items, nextCursor: rows.length > filters.limit ? encodeCursor(page[page.length - 1]!.id) : null };
    },

    update(ctx: Ctx, id: string, input: UpdateOfferingInput) { return updateOne(ctx, id, input); },

    /** Each offering is its own transaction, so one failure never blocks the rest. */
    async bulk(ctx: Ctx, input: BulkInput): Promise<{ updated: number; failed: { id: string; code: string; message?: string }[] }> {
      const failed: { id: string; code: string; message?: string }[] = [];
      let updated = 0;
      for (const id of [...new Set(input.ids)]) {
        try {
          const patch = (current: Offering): UpdateOfferingInput => {
            const { action } = input;
            if (action.type === "set_status") return { rev: null, status: action.value };
            if (action.type === "set_quantity" || action.type === "add_quantity") {
              const pooled = current.stockGrams !== null;
              const target = (existing: number) => {
                const result = action.type === "set_quantity" ? action.value : existing + action.value;
                if (result < 0) throw new AppError("INSUFFICIENT_STOCK", "Stock cannot go below zero", { available: existing, requested: -action.value });
                return result;
              };
              if (pooled) return { rev: null, stockGrams: target(current.stockGrams ?? 0) };
              return { rev: null, variants: current.variants.filter(v => v.isActive).map((v): VariantPatchInput => ({ variantId: v.variantId, stock: target(v.stock ?? 0) })) };
            }
            return { rev: null, variants: current.variants.filter(v => v.isActive).map((v): VariantPatchInput => ({ variantId: v.variantId, price: bulkPrice(action, v.price)! })) };
          };
          await updateOne(ctx, id, patch);
          updated++;
        } catch (error) {
          if (error instanceof AppError) failed.push({ id, code: error.code, message: error.message });
          else throw error;
        }
      }
      return { updated, failed };
    },

    async adjust(ctx: Ctx, input: AdjustInput): Promise<{ movementId: string; balanceAfter: number; rev: number }> {
      if (input.delta === 0) throw validation("delta cannot be zero", { field: "delta" });
      if (input.reason === "purchase" && input.delta < 0) throw validation("A purchase must add stock", { field: "delta" });
      if (input.reason === "wastage" && input.delta > 0) throw validation("Wastage must remove stock", { field: "delta" });
      const { offering, product } = await findForStock(ctx, input.warehouseId, input.productId, input.variantId);
      const out: StockEvent[] = [];
      const result = await store.transaction(async tx => {
        out.length = 0;
        const fresh = (await tx.getOffering(offering.id))!;
        const changed = await changeStock(ctx, fresh, product, input.variantId, current => current + input.delta, input.reason, input.note, out, tx, now());
        return { ...changed, rev: (await tx.getOffering(offering.id))!.rev };
      });
      await publish(out);
      return { movementId: result.movementId!, balanceAfter: result.balanceAfter, rev: result.rev };
    },

    async count(ctx: Ctx, input: CountInput): Promise<{ adjusted: { productId: string; variantId: string | null; before: number; after: number; delta: number }[]; failed: { productId: string; code: string }[] }> {
      assertWarehouseScope(ctx.actor, input.warehouseId);
      const adjusted: { productId: string; variantId: string | null; before: number; after: number; delta: number }[] = [];
      const failed: { productId: string; code: string }[] = [];
      for (const entry of input.counts) {
        try {
          const { offering, product } = await findForStock(ctx, input.warehouseId, entry.productId, entry.variantId);
          const out: StockEvent[] = [];
          const result = await store.transaction(async tx => {
            out.length = 0;
            const fresh = (await tx.getOffering(offering.id))!;
            const changed = await changeStock(ctx, fresh, product, entry.variantId, () => entry.counted, "count", "Stock-take", out, tx, now());
            return changed;
          });
          await publish(out);
          adjusted.push({ productId: entry.productId, variantId: entry.variantId, before: entry.counted - result.delta, after: entry.counted, delta: result.delta });
        } catch (error) {
          if (error instanceof AppError) failed.push({ productId: entry.productId, code: error.code });
          else throw error;
        }
      }
      return { adjusted, failed };
    },

    async levels(ctx: Ctx, filters: LevelsFilters) {
      const ids = scopeIds(ctx, filters.warehouseId);
      const afterId = decodeCursor(filters.cursor);
      const rows = await store.listOfferings({ warehouseIds: ids, limit: filters.limit + 1, ...(afterId !== undefined && { afterId }) });
      const page = rows.slice(0, filters.limit);
      const info = new Map((await products.getMany(page.map(o => o.productId))).map(p => [p.id, p]));
      // Thresholds can differ per warehouse, so each warehouse on the page is read once.
      const limitsOf = new Map(await Promise.all([...new Set(page.map(o => o.warehouseId))].map(async id => [id, await thresholds({ warehouseId: id })] as const)));
      const items = page.flatMap(o => {
        const product = info.get(o.productId);
        if (!product || o.status === "archived") return [];
        const thresholds = limitsOf.get(o.warehouseId)!;
        const make = (variantId: string | null, label: string | null, stock: number) => {
          const threshold = product.stockMode === "pooled_weight" ? thresholds.grams : thresholds.units;
          return { warehouseId: o.warehouseId, productId: o.productId, name: product.name, variantId, variantLabel: label, unit: product.stockMode === "pooled_weight" ? "grams" : "units", stock, lowStockThreshold: threshold, isLow: isLow(product, stock, thresholds) };
        };
        const entries = product.stockMode === "pooled_weight"
          ? [make(null, null, o.stockGrams ?? 0)]
          : o.variants.filter(v => v.isActive).map(v => make(v.variantId, product.variants.find(p => p.id === v.variantId)?.label ?? null, v.stock ?? 0));
        return filters.lowStock ? entries.filter(e => e.isLow) : entries;
      });
      return { items, nextCursor: rows.length > filters.limit ? encodeCursor(page[page.length - 1]!.id) : null };
    },

    async movements(ctx: Ctx, filters: MovementFilters) {
      const beforeId = decodeCursor(filters.cursor);
      const rows = await store.listMovements({
        warehouseIds: scopeIds(ctx, filters.warehouseId), limit: filters.limit + 1,
        ...(filters.productId !== undefined && { productId: filters.productId }), ...(filters.reason !== undefined && { reason: filters.reason }),
        ...(filters.from !== undefined && { from: filters.from }), ...(filters.to !== undefined && { to: filters.to }), ...(beforeId !== undefined && { beforeId }),
      });
      const page = rows.slice(0, filters.limit);
      return { items: page.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })), nextCursor: rows.length > filters.limit ? encodeCursor(page[page.length - 1]!.id) : null };
    },

    async priceHistory(ctx: Ctx, filters: HistoryFilters) {
      const beforeId = decodeCursor(filters.cursor);
      const rows = await store.listPriceHistory({
        warehouseIds: scopeIds(ctx, filters.warehouseId), limit: filters.limit + 1,
        ...(filters.productId !== undefined && { productId: filters.productId }), ...(filters.variantId !== undefined && { variantId: filters.variantId }),
        ...(filters.from !== undefined && { from: filters.from }), ...(filters.to !== undefined && { to: filters.to }), ...(beforeId !== undefined && { beforeId }),
      });
      const page = rows.slice(0, filters.limit);
      return { items: page.map(({ id: _id, at, ...rest }) => ({ ...rest, at: at.toISOString() })), nextCursor: rows.length > filters.limit ? encodeCursor(page[page.length - 1]!.id) : null };
    },

    /** Whole units each size of a product can be sold in a zone right now. Used by Notify Me (F07). */
    async zoneAvailability(zoneId: string, productId: string): Promise<{ sold: boolean; unitsByVariant: Record<string, number> }> {
      const [product] = await products.getMany([productId]);
      if (!product || product.status !== "active") return { sold: false, unitsByVariant: {} };
      const sellers = (await store.listByZoneProduct(zoneId, productId)).filter(o => o.status === "active");
      const unitsByVariant: Record<string, number> = {};
      for (const variant of product.variants.filter(v => v.isActive)) {
        unitsByVariant[variant.id] = sellers.reduce((sum, o) => sum + (o.variants.some(l => l.variantId === variant.id) ? unitsAvailable(product, o, variant.id) : 0), 0);
      }
      return { sold: sellers.length > 0, unitsByVariant };
    },

    // ---------- for the catalog module (ProductUsagePort) ----------
    offeringCount(productId: string) { return store.countByProduct(productId); },

    /** Give a product's offerings a new revision so clients receive the catalog change through delta sync. */
    async touchOfferings(productId: string): Promise<void> {
      await store.transaction(async tx => {
        const list = await tx.listByProduct(productId);
        if (list.length === 0) return;
        const rev = await tx.nextRevision();
        for (const offering of list) await tx.setRev(offering.id, rev);
      });
    },
  };
}

export type OfferingsService = ReturnType<typeof createOfferingsService>;
