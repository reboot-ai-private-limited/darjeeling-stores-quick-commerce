import type { ClientSession, Connection } from "mongoose";
import { createAuditWriter } from "../../audit/audit.public.js";
import { conflict } from "../../catalog/catalog.public.js";
import {
  DuplicateRestoreError, type ImportPreview, type MovementQuery, type OfferingListQuery, type OfferingsReads, type OfferingsStore, type OfferingsTx,
  type PriceHistoryQuery, type PriceHistoryRow, type Reservation, type StockMovement,
} from "../application/ports.js";
import type { Offering } from "../domain/stock.js";

// Ids are 24-character hex strings stored as strings, matching the catalog module.
type OfferingDoc = Omit<Offering, "id"> & { _id: string };
type MovementDoc = Omit<StockMovement, "id"> & { _id: string };
type HistoryDoc = Omit<PriceHistoryRow, "id"> & { _id: string };
type ReservationDoc = Omit<Reservation, "id"> & { _id: string };
type PreviewDoc = Omit<ImportPreview, "id"> & { _id: string };
const toPreview = ({ _id, ...rest }: PreviewDoc): ImportPreview => ({ id: _id, ...rest });
interface RevisionDoc { _id: string; value: number }

const REV_ID = "catalogRev";
const toOffering = ({ _id, ...rest }: OfferingDoc): Offering => ({ id: _id, ...rest });
const toOfferingDoc = ({ id, ...rest }: Offering): OfferingDoc => ({ _id: id, ...rest });
const toMovement = ({ _id, ...rest }: MovementDoc): StockMovement => ({ id: _id, ...rest });
const toMovementDoc = ({ id, ...rest }: StockMovement): MovementDoc => ({ _id: id, ...rest });
const toHistory = ({ _id, ...rest }: HistoryDoc): PriceHistoryRow => ({ id: _id, ...rest });
const toHistoryDoc = ({ id, ...rest }: PriceHistoryRow): HistoryDoc => ({ _id: id, ...rest });
const toReservation = ({ _id, ...rest }: ReservationDoc): Reservation => ({ id: _id, ...rest });
const toReservationDoc = ({ id, ...rest }: Reservation): ReservationDoc => ({ _id: id, ...rest });

const isDuplicate = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

export function createMongoOfferingsStore(connection: Connection): OfferingsStore {
  const offerings = () => connection.collection<OfferingDoc>("warehouse_products");
  const movements = () => connection.collection<MovementDoc>("stock_movements");
  const history = () => connection.collection<HistoryDoc>("price_history");
  const reservations = () => connection.collection<ReservationDoc>("stock_reservations");
  // Revision counters and per zone/product locks share one small collection.
  const previews = () => connection.collection<PreviewDoc>("import_previews");
  const revisions = () => connection.collection<RevisionDoc>("catalog_revisions");
  const writeAudit = createAuditWriter(connection);

  function reads(session?: ClientSession): OfferingsReads {
    const opts = session ? { session } : {};
    return {
      async getOffering(id) { const doc = await offerings().findOne({ _id: id }, opts); return doc ? toOffering(doc) : null; },
      async getByWarehouseProduct(warehouseId, productId) { const doc = await offerings().findOne({ warehouseId, productId }, opts); return doc ? toOffering(doc) : null; },
      async listOfferings(query: OfferingListQuery) {
        const filter: Record<string, unknown> = {};
      if (query.warehouseIds) filter.warehouseId = { $in: [...query.warehouseIds] };
        if (query.status) filter.status = query.status;
        if (query.productIds) filter.productId = { $in: [...query.productIds] };
        if (query.afterId) filter._id = { $gt: query.afterId };
        return (await offerings().find(filter, opts).sort({ _id: 1 }).limit(query.limit).toArray()).map(toOffering);
      },
      async listByZoneProduct(zoneId, productId) { return (await offerings().find({ zoneId, productId }, opts).toArray()).map(toOffering); },
      async listByProduct(productId) { return (await offerings().find({ productId }, opts).toArray()).map(toOffering); },
    };
  }

  function tx(session: ClientSession): OfferingsTx {
    return {
      ...reads(session),
      async lockZoneProduct(zoneId, productId) {
        await revisions().updateOne({ _id: `lock:${zoneId}:${productId}` }, { $inc: { value: 1 } }, { upsert: true, session });
      },
      async nextRevision() {
        const doc = await revisions().findOneAndUpdate({ _id: REV_ID }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after", session });
        return doc!.value;
      },
      async insertOffering(offering) {
        try { await offerings().insertOne(toOfferingDoc(offering), { session }); }
        catch (error) { if (isDuplicate(error)) throw conflict("This product is already offered by this warehouse", { field: "productId" }); throw error; }
      },
      async replaceOffering(offering) { await offerings().replaceOne({ _id: offering.id }, toOfferingDoc(offering), { session }); },
      async applyStockDelta({ offeringId, variantId, delta, requireSellable, at }) {
        const sellable = requireSellable ? { status: "active" as const, isOutOfStockOverride: false } : {};
        if (variantId === null) {
          const filter = { _id: offeringId, stockGrams: delta < 0 ? { $gte: -delta } : { $ne: null }, ...sellable };
          const doc = await offerings().findOneAndUpdate(filter, { $inc: { stockGrams: delta }, $set: { updatedAt: at } }, { returnDocument: "after", session });
          if (!doc || doc.stockGrams === null) return null;
          return { before: doc.stockGrams - delta, after: doc.stockGrams };
        }
        const match = { variantId, stock: delta < 0 ? { $gte: -delta } : { $ne: null }, ...(requireSellable ? { isActive: true } : {}) };
        const doc = await offerings().findOneAndUpdate(
          { _id: offeringId, variants: { $elemMatch: match }, ...sellable },
          { $inc: { "variants.$[v].stock": delta }, $set: { updatedAt: at } },
          { arrayFilters: [{ "v.variantId": variantId }], returnDocument: "after", session },
        );
        const after = doc?.variants.find(v => v.variantId === variantId)?.stock;
        return after === undefined || after === null ? null : { before: after - delta, after };
      },
      async setRev(offeringId, rev) { await offerings().updateOne({ _id: offeringId }, { $set: { rev } }, { session }); },
      async insertMovements(rows) {
        if (rows.length === 0) return;
        try { await movements().insertMany(rows.map(toMovementDoc), { session }); }
        catch (error) { if (isDuplicate(error)) throw new DuplicateRestoreError(); throw error; }
      },
      async hasRestore(restoreKey) { return (await movements().countDocuments({ restoreKey }, { session, limit: 1 })) > 0; },
      async insertPriceHistory(rows) { if (rows.length > 0) await history().insertMany(rows.map(toHistoryDoc), { session }); },
      async getPreview(id) { const doc = await previews().findOne({ _id: id }, { session }); return doc ? toPreview(doc) : null; },
      async deletePreview(id) { return (await previews().deleteOne({ _id: id }, { session })).deletedCount === 1; },
      async getReservation(key) { const doc = await reservations().findOne({ key }, { session }); return doc ? toReservation(doc) : null; },
      async insertReservation(reservation) {
        try { await reservations().insertOne(toReservationDoc(reservation), { session }); }
        catch (error) { if (isDuplicate(error)) throw conflict("A reservation with this key already exists", { reason: "reservation_exists" }); throw error; }
      },
      async saveReservation(reservation) { await reservations().replaceOne({ _id: reservation.id }, toReservationDoc(reservation), { session }); },
      async audit(ctx, entry) {
        await writeAudit({
          actorId: ctx.actor.userId, actorRole: ctx.actor.role, action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
          requestId: ctx.requestId, ...(entry.warehouseId !== undefined && { warehouseId: entry.warehouseId }),
        }, session);
      },
    };
  }

  return {
    ...reads(),
    async ensureIndexes() {
      await offerings().createIndex({ warehouseId: 1, productId: 1 }, { unique: true });
      await offerings().createIndex({ zoneId: 1, rev: 1 });
      await offerings().createIndex({ zoneId: 1, productId: 1 });
      await offerings().createIndex({ warehouseId: 1, status: 1 });
      await movements().createIndex({ warehouseId: 1, productId: 1, createdAt: -1 });
      // A restore can be applied once: the same restoreKey cannot touch the same line twice.
      await movements().createIndex({ restoreKey: 1, warehouseId: 1, productId: 1, variantId: 1 }, { unique: true, partialFilterExpression: { restoreKey: { $type: "string" } } });
      await history().createIndex({ warehouseId: 1, productId: 1, at: -1 });
      await reservations().createIndex({ key: 1 }, { unique: true });
      await reservations().createIndex({ status: 1, expiresAt: 1 });
      // Previews are short-lived: Mongo removes them once `expiresAt` has passed.
      await previews().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },
    async transaction<T>(fn: (t: OfferingsTx) => Promise<T>): Promise<T> {
      const session = await connection.startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => { result = await fn(tx(session)); });
        return result;
      } finally { await session.endSession(); }
    },
    async listMovements(query: MovementQuery) {
      const filter: Record<string, unknown> = {};
      if (query.warehouseIds) filter.warehouseId = { $in: [...query.warehouseIds] };
      if (query.productId) filter.productId = query.productId;
      if (query.reason) filter.reason = query.reason;
      if (query.beforeId) filter._id = { $lt: query.beforeId };
      if (query.from || query.to) filter.createdAt = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
      return (await movements().find(filter).sort({ _id: -1 }).limit(query.limit).toArray()).map(toMovement);
    },
    async listPriceHistory(query: PriceHistoryQuery) {
      const filter: Record<string, unknown> = {};
      if (query.warehouseIds) filter.warehouseId = { $in: [...query.warehouseIds] };
      if (query.productId) filter.productId = query.productId;
      if (query.variantId) filter.variantId = query.variantId;
      if (query.beforeId) filter._id = { $lt: query.beforeId };
      if (query.from || query.to) filter.at = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
      return (await history().find(filter).sort({ _id: -1 }).limit(query.limit).toArray()).map(toHistory);
    },
    async expiredHoldKeys(now, limit) {
      const docs = await reservations().find({ status: "held", expiresAt: { $lte: now } }, { projection: { key: 1 } }).sort({ expiresAt: 1 }).limit(limit).toArray();
      return docs.map(doc => doc.key);
    },
    async zoneOfferings({ zoneId, productIds, activeOnly }) {
      if (productIds && productIds.length === 0) return [];
      const filter = { zoneId, ...(activeOnly && { status: "active" as const }), ...(productIds && { productId: { $in: [...productIds] } }) };
      return (await offerings().find(filter).toArray()).map(toOffering);
    },
    async changedSince(zoneId, since, limit) {
      return (await offerings().find({ zoneId, rev: { $gt: since } }).sort({ rev: 1 }).limit(limit).toArray()).map(toOffering);
    },
    async currentRevision() { return (await revisions().findOne({ _id: REV_ID }))?.value ?? 0; },
    async savePreview(preview) { const { id, ...rest } = preview; await previews().insertOne({ _id: id, ...rest }); },
    async getPreview(id) { const doc = await previews().findOne({ _id: id }); return doc ? toPreview(doc) : null; },
    countByProduct(productId) { return offerings().countDocuments({ productId }); },
  };
}
