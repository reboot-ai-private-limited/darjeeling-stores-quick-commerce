import { AppError, assertWarehouseScope, conflict, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { categoryAndDescendants, hasQuantity, planLines, type PlannedLines, type PlannedVariant } from "../domain/import.js";
import {
  findPriceConflicts, pricingProblems, type Offering, type OfferingVariant, type ProductInfo,
} from "../domain/stock.js";
import type {
  ImportAction, ImportOptions, ImportPreview, ImportRowPlan, OfferingsDeps, OfferingsTx, PriceHistoryRow, StockEvent, StockMovement,
} from "./ports.js";
import { stockSideEffects, withZeroStock } from "./stock-effects.js";

const MAX_ROWS = 500;
const SOURCE_LIMIT = 5000;
const PREVIEW_TTL_MS = 60 * 60 * 1000;

export interface PreviewInput {
  sourceWarehouseId: string; targetWarehouseId: string; productIds: string[] | null; categoryId: string | null; selectAll: boolean; options: ImportOptions;
}
export interface CommitVariantInput {
  variantId: string; price: number; mrp: number; salePrice?: number | null | undefined; saleStart?: Date | null | undefined;
  saleEnd?: Date | null | undefined; stock?: number | null | undefined; maxQtyPerOrder?: number | null | undefined;
}
export interface CommitRowInput { productId: string; action: ImportAction; stockGrams?: number | null | undefined; variants?: CommitVariantInput[] | undefined }
export interface CommitInput { previewId: string; confirmQuantities: boolean; rows: CommitRowInput[] }

const iso = (date: Date | null) => date?.toISOString() ?? null;

function previewView(preview: ImportPreview) {
  const rows = preview.rows.map(row => ({
    productId: row.productId, name: row.name, alreadyInTarget: row.alreadyInTarget, action: row.action,
    ...(row.action !== "skip" && { stockGrams: row.stockGrams }),
    variants: row.variants.map(v => ({ ...v, saleStart: iso(v.saleStart), saleEnd: iso(v.saleEnd) })),
    warnings: row.warnings, conflicts: row.conflicts,
  }));
  return {
    previewId: preview.id, rows,
    summary: {
      create: rows.filter(r => r.action === "create").length, overwrite: rows.filter(r => r.action === "overwrite").length,
      skip: rows.filter(r => r.action === "skip").length, conflicts: rows.filter(r => r.conflicts.length > 0).length,
    },
  };
}

const asOfferingVariant = ({ label: _label, ...v }: PlannedVariant): OfferingVariant => ({ ...v, isActive: true });

/** Copy products from one warehouse into another: a preview that saves nothing, then a commit of the (edited) rows (F06). */
export function createImportService(deps: OfferingsDeps) {
  const { store, warehouses, products, events, now, newId, thresholds, priceConflictMode } = deps;

  async function checkWarehouses(ctx: Ctx, sourceId: string, targetId: string) {
    if (sourceId === targetId) throw validation("The source and target warehouse must be different", { field: "targetWarehouseId" });
    assertWarehouseScope(ctx.actor, sourceId);
    assertWarehouseScope(ctx.actor, targetId);
    const [source, target] = await Promise.all([warehouses.get(sourceId), warehouses.get(targetId)]);
    if (!source) throw notFound("Source warehouse");
    if (!target) throw notFound("Target warehouse");
    return { source, target };
  }

  async function selectSource(input: PreviewInput, sourceId: string): Promise<Offering[]> {
    if (input.productIds && input.productIds.length > 0) {
      const ids = [...new Set(input.productIds)];
      const found = await store.listOfferings({ warehouseIds: [sourceId], productIds: ids, limit: ids.length });
      const missing = ids.filter(id => !found.some(o => o.productId === id));
      if (missing.length > 0) throw new AppError("NOT_FOUND", "Some products are not sold by the source warehouse", { productIds: missing });
      return found;
    }
    const all = (await store.listOfferings({ warehouseIds: [sourceId], limit: SOURCE_LIMIT + 1 })).filter(o => o.status !== "archived");
    if (all.length > SOURCE_LIMIT) throw validation("The source warehouse has too many products to import at once; select a category");
    if (input.categoryId === null) return all;
    const categories = await products.categories();
    if (!categories.some(c => c.id === input.categoryId)) throw notFound("Category");
    const wanted = categoryAndDescendants(categories, input.categoryId);
    const info = new Map((await products.getMany(all.map(o => o.productId))).map(p => [p.id, p]));
    return all.filter(o => wanted.has(info.get(o.productId)?.categoryId ?? ""));
  }

  function movementRow(warehouseId: string, sourceId: string, productId: string, variantId: string | null, mode: "grams" | "units", delta: number, balanceAfter: number, by: string, at: Date): StockMovement {
    return {
      id: newId(), warehouseId, productId, variantId, mode, delta, balanceAfter, reason: "import", orderKey: null, restoreKey: null,
      note: `Imported from warehouse ${sourceId}`, by, createdAt: at,
    };
  }

  return {
    async preview(ctx: Ctx, input: PreviewInput) {
      const { target } = await checkWarehouses(ctx, input.sourceWarehouseId, input.targetWarehouseId);
      const selected = await selectSource(input, input.sourceWarehouseId);
      if (selected.length > MAX_ROWS) throw validation(`Select at most ${MAX_ROWS} products at a time`);
      const ids = selected.map(o => o.productId);
      const info = new Map<string, ProductInfo>((await products.getMany(ids)).map(p => [p.id, p]));
      const existing = new Map((ids.length === 0 ? [] : await store.listOfferings({ warehouseIds: [input.targetWarehouseId], productIds: ids, limit: ids.length })).map(o => [o.productId, o]));
      const at = now();
      const { options } = input;
      const rows: ImportRowPlan[] = [];

      for (const offering of selected) {
        const product = info.get(offering.productId);
        const inTarget = existing.get(offering.productId);
        const row: ImportRowPlan = {
          productId: offering.productId, name: product?.name ?? "", alreadyInTarget: inTarget !== undefined, action: "skip",
          stockGrams: null, variants: [], warnings: [], conflicts: [],
        };
        rows.push(row);
        if (!product) { row.warnings.push({ code: "PRODUCT_NOT_IN_CATALOG", message: "The product is missing from the master catalog. Create it there first." }); continue; }
        if (product.status === "archived") { row.warnings.push({ code: "PRODUCT_ARCHIVED", message: "An archived product cannot be offered. Restore it first." }); continue; }
        if (inTarget && options.onConflict === "skip") continue;
        const lines = planLines(offering, product, options, at);
        if (lines.variants.length === 0) { row.warnings.push({ code: "NO_ACTIVE_VARIANTS", message: "No active size is available to copy." }); continue; }

        row.action = inTarget ? "overwrite" : "create";
        row.stockGrams = lines.stockGrams;
        row.variants = lines.variants;
        if (hasQuantity(lines)) {
          row.warnings.push(options.quantityMode === "copy"
            ? { code: "QUANTITY_COPIED", message: "Quantity is copied from the source. Set it to this warehouse's real stock." }
            : { code: "QUANTITY_SET", message: "Check the quantity: it becomes this warehouse's stock." });
        }
        if (inTarget) row.warnings.push({ code: "STOCK_REPLACED", message: "The existing prices and quantity in this warehouse will be replaced." });
        for (const v of lines.variants) {
          const problems = pricingProblems(v);
          if (problems.length > 0) row.warnings.push({ code: "INVALID_PRICE", message: `${v.label}: ${problems.join("; ")}` });
        }
        const others = (await store.listByZoneProduct(target.zoneId, offering.productId)).filter(o => o.warehouseId !== input.targetWarehouseId);
        row.conflicts = findPriceConflicts(lines.variants.map(asOfferingVariant), others, at);
      }

      rows.sort((a, b) => a.name.localeCompare(b.name));
      const preview: ImportPreview = {
        id: newId(), userId: ctx.actor.userId, sourceWarehouseId: input.sourceWarehouseId, targetWarehouseId: input.targetWarehouseId,
        options, rows, createdAt: at, expiresAt: new Date(at.getTime() + PREVIEW_TTL_MS),
      };
      await store.savePreview(preview);
      return previewView(preview);
    },

    async commit(ctx: Ctx, input: CommitInput) {
      const preview = await store.getPreview(input.previewId);
      if (!preview || preview.userId !== ctx.actor.userId || preview.expiresAt <= now()) throw notFound("Preview");
      const { target } = await checkWarehouses(ctx, preview.sourceWarehouseId, preview.targetWarehouseId);

      const planned = new Map(preview.rows.map(r => [r.productId, r]));
      const chosen: { plan: ImportRowPlan; row: CommitRowInput }[] = [];
      const seen = new Set<string>();
      for (const row of input.rows) {
        if (seen.has(row.productId)) throw validation("A product is listed twice", { productId: row.productId });
        seen.add(row.productId);
        const plan = planned.get(row.productId);
        if (!plan) throw validation("This product is not part of the preview", { productId: row.productId });
        if (row.action === "skip") continue;
        if (row.action !== plan.action) throw validation("A row's action must match the preview, or be skip", { productId: row.productId, expected: plan.action });
        if (!row.variants || row.variants.length === 0) throw validation("Variants are required for a row that is not skipped", { productId: row.productId });
        chosen.push({ plan, row });
      }

      const info = new Map((await products.getMany(chosen.map(c => c.plan.productId))).map(p => [p.id, p]));
      const work = chosen.map(({ plan, row }) => {
        const product = info.get(plan.productId);
        if (!product || product.status === "archived") throw validation("This product can no longer be offered", { productId: plan.productId });
        const pooled = product.stockMode === "pooled_weight";
        const variantIds = new Set<string>();
        const variants: PlannedVariant[] = (row.variants ?? []).map(v => {
          const original = plan.variants.find(p => p.variantId === v.variantId);
          if (!original) throw validation("Unknown variant for this row", { productId: plan.productId, variantId: v.variantId });
          if (variantIds.has(v.variantId)) throw validation("A variant is listed twice", { productId: plan.productId, variantId: v.variantId });
          variantIds.add(v.variantId);
          const salePrice = v.salePrice !== undefined ? v.salePrice : original.salePrice;
          const stock = v.stock !== undefined ? v.stock : original.stock;
          if (pooled && stock !== null) throw validation("stock applies only to per-variant products", { productId: plan.productId, variantId: v.variantId });
          if (!pooled && stock === null) throw validation("stock is required for a per-variant product", { productId: plan.productId, variantId: v.variantId });
          const merged: PlannedVariant = {
            variantId: v.variantId, label: original.label, price: v.price, mrp: v.mrp, salePrice,
            saleStart: salePrice === null ? null : v.saleStart !== undefined ? v.saleStart : original.saleStart,
            saleEnd: salePrice === null ? null : v.saleEnd !== undefined ? v.saleEnd : original.saleEnd,
            stock, maxQtyPerOrder: v.maxQtyPerOrder !== undefined ? v.maxQtyPerOrder : original.maxQtyPerOrder,
          };
          const problems = pricingProblems(merged);
          if (problems.length > 0) throw validation("Invalid price", { productId: plan.productId, variantId: v.variantId, problems });
          return merged;
        });
        const stockGrams = pooled ? (row.stockGrams !== undefined ? row.stockGrams : plan.stockGrams) : null;
        if (pooled && stockGrams === null) throw validation("stockGrams is required for a pooled-weight product", { productId: plan.productId });
        if (!pooled && row.stockGrams != null) throw validation("stockGrams applies only to pooled-weight products", { productId: plan.productId });
        const lines: PlannedLines = { stockGrams, variants };
        return { plan, product, lines, pooled };
      });
      if (!input.confirmQuantities && work.some(w => hasQuantity(w.lines))) {
        throw validation("Confirm the quantities: they become this warehouse's own stock count", { field: "confirmQuantities" });
      }

      const out: StockEvent[] = [];
      const importedFrom = (at: Date) => ({ warehouseId: preview.sourceWarehouseId, at, by: ctx.actor.userId });
      const result = await store.transaction(async (tx: OfferingsTx) => {
        out.length = 0;
        // A preview is single-use. If a concurrent commit used it first, this deletes nothing and reports NOT_FOUND.
        if (!(await tx.deletePreview(preview.id))) throw notFound("Preview");
        const at = now();
        const offeringIds: string[] = [];
        let created = 0;
        let overwritten = 0;
        const ordered = [...work].sort((a, b) => (a.plan.productId < b.plan.productId ? -1 : 1));

        // Pass 1: look at everything (and serialise with other price writers) before any write, so conflicts are reported together.
        const staged: { item: (typeof work)[number]; existing: Offering | null }[] = [];
        const allConflicts: { productId: string; variantId: string; conflicts: { warehouseId: string; price: number }[] }[] = [];
        for (const item of ordered) {
          await tx.lockZoneProduct(target.zoneId, item.plan.productId);
          const existing = await tx.getByWarehouseProduct(preview.targetWarehouseId, item.plan.productId);
          if ((item.plan.action === "create") === (existing !== null)) {
            throw conflict("This warehouse changed after the preview. Run the preview again.", { productId: item.plan.productId, reason: "target_changed" });
          }
          const others = (await tx.listByZoneProduct(target.zoneId, item.plan.productId)).filter(o => o.warehouseId !== preview.targetWarehouseId);
          for (const c of findPriceConflicts(item.lines.variants.map(asOfferingVariant), others, at)) allConflicts.push({ productId: item.plan.productId, ...c });
          staged.push({ item, existing });
        }
        if (allConflicts.length > 0 && (await priceConflictMode()) === "block") {
          const first = allConflicts[0]!;
          throw new AppError("PRICE_CONFLICT", "Price differs from another warehouse in this zone", {
            productId: first.productId, variantId: first.variantId, conflicts: first.conflicts, canApplyToOthers: false, variants: allConflicts,
          });
        }

        // Pass 2: write.
        const rev = await tx.nextRevision();
        for (const { item, existing } of staged) {
          const { plan, product, lines, pooled } = item;
          const variantModels = lines.variants.map(asOfferingVariant);
          const moves: StockMovement[] = [];
          const history: PriceHistoryRow[] = [];
          const record = (line: OfferingVariant, old: OfferingVariant | undefined) => {
            if (!old || old.price !== line.price || old.mrp !== line.mrp) {
              history.push({ id: newId(), warehouseId: preview.targetWarehouseId, productId: plan.productId, variantId: line.variantId, oldPrice: old?.price ?? 0, newPrice: line.price, oldMrp: old?.mrp ?? 0, newMrp: line.mrp, by: ctx.actor.userId, at });
            }
          };
          const move = (variantId: string | null, before: number, after: number) => {
            if (after !== before) moves.push(movementRow(preview.targetWarehouseId, preview.sourceWarehouseId, plan.productId, variantId, pooled ? "grams" : "units", after - before, after, ctx.actor.userId, at));
          };

          let before: Offering;
          let next: Offering;
          if (!existing) {
            next = {
              id: newId(), warehouseId: preview.targetWarehouseId, productId: plan.productId, zoneId: target.zoneId, status: "active",
              stockGrams: lines.stockGrams, variants: variantModels, isOutOfStockOverride: false, rev, importedFrom: importedFrom(at), createdAt: at, updatedAt: at,
            };
            await tx.insertOffering(next);
            before = withZeroStock(product, next);
            if (pooled) move(null, 0, next.stockGrams ?? 0);
            for (const line of variantModels) { record(line, undefined); if (!pooled) move(line.variantId, 0, line.stock ?? 0); }
            created++;
          } else {
            before = structuredClone(existing);
            next = structuredClone(existing);
            if (pooled) { move(null, existing.stockGrams ?? 0, lines.stockGrams ?? 0); next.stockGrams = lines.stockGrams; }
            for (const line of variantModels) {
              const index = next.variants.findIndex(v => v.variantId === line.variantId);
              const old = index >= 0 ? next.variants[index] : undefined;
              record(line, old);
              if (!pooled) move(line.variantId, old?.stock ?? 0, line.stock ?? 0);
              if (index >= 0) next.variants[index] = line; else next.variants.push(line);
            }
            next.rev = rev; next.updatedAt = at; next.importedFrom = importedFrom(at);
            await tx.replaceOffering(next);
            overwritten++;
          }
          await tx.insertMovements(moves);
          await tx.insertPriceHistory(history);
          await stockSideEffects(tx, await thresholds({ warehouseId: next.warehouseId }), product, before, next, out, { revAlreadyBumped: true });
          offeringIds.push(next.id);
        }
        return { created, overwritten, offeringIds };
      });
      await Promise.allSettled(out.map(async event => events.publish(event)));
      return { created: result.created, overwritten: result.overwritten, skipped: preview.rows.length - result.created - result.overwritten, offeringIds: result.offeringIds };
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
