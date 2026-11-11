import type { Geography } from "../../../platform/geography.js";
import type { DeliveryOrder, OrderActor, OrdersPort } from "../../../platform/orders.js";
import { assertWarehouseScope, AppError, conflict, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import type { Rider } from "../../riders/riders.public.js";
import { OUTCOMES, ledgerView, reconciliationView, type LedgerFlag, type ReconciliationOutcome, type ReconciliationType } from "../domain/cash.js";
import { DuplicateCollectionError, InsufficientCashError, type CashStore, type NewReconciliation, type OrderRelations, type RiderDirectory } from "./ports.js";

export interface CashDeps {
  store: CashStore; orders: OrdersPort; riders: RiderDirectory; relations: OrderRelations; geography: Geography; now: () => Date;
}
export type CollectMethod = "cash" | "upi";

/** How a collection that came from the offline queue was settled. Cash is never dropped, so even a conflict leaves a record. */
export type SyncCollectResult =
  | { kind: "applied" | "duplicate" }
  | { kind: "conflict"; reason: "already_paid_online" | "order_cancelled" | "reassigned" | "not_assigned_to_you" | "invalid_transition"; message: string };

const IST_MS = 5.5 * 3_600_000;
const startOfIstDay = (at: Date) => { const d = new Date(at.getTime() + IST_MS); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - IST_MS); };
const byRider = (rider: Rider): OrderActor => ({ kind: "rider", id: rider.userId });
const byAdmin = (ctx: Ctx): OrderActor => ({ kind: "admin", id: ctx.actor.userId });

/** Cash and doorstep UPI taken by riders, the append-only ledger, deposits, and the items an admin must review (F22). */
export function createCashService(deps: CashDeps) {
  const { store, orders, riders, relations, geography, now } = deps;

  const scopeOf = (ctx: Ctx, warehouseId?: string): readonly string[] | undefined => {
    if (warehouseId) { assertWarehouseScope(ctx.actor, warehouseId); return [warehouseId]; }
    return ctx.actor.scope.all ? undefined : ctx.actor.scope.warehouseIds;
  };
  const reconFor = (rider: Rider, order: DeliveryOrder, type: ReconciliationType, amount: number): NewReconciliation => ({
    type, orderId: order.id, orderNo: order.orderNo, riderId: rider.id, riderName: rider.name, warehouseId: order.warehouseId, amount, at: now(),
  });

  /** Writes the cash line (once per order) and, if the order does not show it yet, the order's own collection record. */
  async function recordCash(rider: Rider, order: DeliveryOrder, amount: number, flags: LedgerFlag[], recon: NewReconciliation[], markOrder: boolean, details: Record<string, unknown>) {
    let duplicate = false;
    let entry;
    try {
      entry = await store.post({ riderId: rider.id, warehouseId: order.warehouseId, type: "collected", amount, orderId: order.id, orderNo: order.orderNo, note: null, by: rider.userId, flags, at: now() }, { reconciliations: recon });
    } catch (error) {
      if (!(error instanceof DuplicateCollectionError)) throw error;
      duplicate = true;
      entry = await store.collectedFor(order.id);
    }
    // Self-healing: a first attempt that wrote the ledger but not the order is finished by the repeat.
    if (markOrder && !order.collectionRecorded) await orders.setCollection(order.id, { method: "cash", amount }, byRider(rider), details);
    return { entry, duplicate };
  }

  async function recordUpi(rider: Rider, order: DeliveryOrder, amount: number, type: ReconciliationType, markOrder: boolean, details: Record<string, unknown>) {
    await store.openReconciliation(reconFor(rider, order, type, amount));
    if (markOrder) await orders.setCollection(order.id, { method: "upi_unverified", amount }, byRider(rider), details);
  }

  async function cashInHand(riderId: string) { return (await store.balanceOf(riderId)).total; }

  return {
    // ---------------------------------------------------------------- the rider

    async myCash(rider: Rider) {
      const [balance, entries, pending, deliveredToday] = await Promise.all([
        store.balanceOf(rider.id), store.entriesSince(rider.id, startOfIstDay(now())),
        store.listReconciliation({ type: "upi_unverified", status: "open", riderId: rider.id }, 50), relations.deliveredToday(rider.id),
      ]);
      const names = new Map(await Promise.all(balance.byWarehouse.map(async w => [w.warehouseId, (await geography.warehouse(w.warehouseId))?.name ?? ""] as const)));
      return {
        cashInHand: balance.total,
        byWarehouse: balance.byWarehouse.map(w => ({ warehouseId: w.warehouseId, warehouseName: names.get(w.warehouseId) ?? "", amount: w.amount })),
        deliveredToday,
        pendingUpi: pending.map(p => ({ orderId: p.orderId, orderNo: p.orderNo, amount: p.amount, status: "upi_unverified" as const })),
        entries: entries.map(e => ({ id: e.id, type: e.type, amount: e.amount, orderNo: e.orderNo, warehouseId: e.warehouseId, at: e.at.toISOString() })),
      };
    },

    /** The rider records cash or a doorstep UPI payment at the door. Repeating it answers with the first result. */
    async collect(rider: Rider, orderId: string, method: CollectMethod, input: { amount: number; note?: string | null | undefined; collectedAt?: Date | null | undefined }) {
      const order = await orders.get(orderId);
      const relation = await relations.relation(rider.id, orderId);
      if (!order || relation === "none" || relation === "ended") throw notFound("Order");
      const details = { note: input.note ?? null, collectedAt: input.collectedAt?.toISOString() ?? null };
      const answer = async (duplicate: boolean) => {
        const fresh = (await orders.get(orderId))!;
        if (method === "cash") {
          const entry = await store.collectedFor(orderId);
          return { orderId, paymentStatus: fresh.paymentStatus, ledgerEntryId: entry?.id ?? null, cashInHand: await cashInHand(rider.id), ...(duplicate && { duplicate: true }) };
        }
        return { orderId, paymentStatus: fresh.paymentStatus, collection: { method: "upi_unverified" as const, amount: fresh.collectionAmount ?? input.amount }, ...(duplicate && { duplicate: true }) };
      };
      if (order.collectionRecorded) return answer(true);
      if (relation !== "live") throw notFound("Order");
      if (order.alreadyPaid || order.paymentMethod !== "cod") throw conflict("This order is already paid online. Do not take cash.", { reason: "already_paid" });
      if (order.status !== "ARRIVED") throw new AppError("INVALID_TRANSITION", "Mark yourself arrived before recording a payment", { from: order.status, to: "collected" });
      if (input.amount !== order.amountDue) throw new AppError("PAYMENT_MISMATCH", "The amount must equal the amount due", { amountDue: order.amountDue });
      if (method === "cash") {
        const done = await recordCash(rider, order, input.amount, [], [], true, details);
        return answer(done.duplicate);
      }
      await recordUpi(rider, order, input.amount, "upi_unverified", true, details);
      return answer(false);
    },

    /**
     * A collection that arrived from the offline queue. The money is already in the rider's hands, so it is always recorded;
     * anything unexpected goes to an admin as a reconciliation item and is reported back as a conflict.
     */
    async collectSynced(rider: Rider, orderId: string, method: CollectMethod, input: { amount: number; note?: string | null | undefined; deviceTime?: Date | null | undefined }): Promise<SyncCollectResult> {
      const order = await orders.get(orderId);
      if (!order) return { kind: "conflict", reason: "not_assigned_to_you", message: "That order could not be found." };
      const relation = await relations.relation(rider.id, orderId);
      const details = { note: input.note ?? null, collectedAt: input.deviceTime?.toISOString() ?? null, offline: true };
      const money = method === "cash";
      const record = async (flags: LedgerFlag[], type: ReconciliationType, markOrder: boolean, review = true) => {
        const recon = money && !review ? [] : [reconFor(rider, order, type, input.amount)];
        if (money) return (await recordCash(rider, order, input.amount, flags, recon, markOrder, details)).duplicate;
        await recordUpi(rider, order, input.amount, type, markOrder, details);
        return false;
      };

      if (order.status === "CANCELLED" || relation === "none" || relation === "ended") {
        const duplicate = await record(["unmatched"], "unmatched", false);
        if (duplicate) return { kind: "duplicate" };
        const reason = order.status === "CANCELLED" ? "order_cancelled" : relation === "ended" ? "reassigned" : "not_assigned_to_you";
        return { kind: "conflict", reason, message: "This order is no longer yours. The money you took is recorded and an admin will sort it out." };
      }
      if (order.collectionRecorded) return { kind: "duplicate" };
      if (order.alreadyPaid || order.paymentMethod !== "cod") {
        if (await record(["overpaid"], "overpaid", false)) return { kind: "duplicate" };
        return { kind: "conflict", reason: "already_paid_online", message: "The customer had already paid online. Your collection is recorded and the customer will be refunded." };
      }
      if (input.amount !== order.amountDue) {
        if (await record(["unmatched"], "unmatched", false)) return { kind: "duplicate" };
        return { kind: "conflict", reason: "invalid_transition", message: `The amount differs from the ₹${order.amountDue / 100} due. An admin will review it.` };
      }
      return { kind: (await record([], "upi_unverified", true, false)) ? "duplicate" : "applied" };
    },

    // ---------------------------------------------------------------- the admin

    async ridersCash(ctx: Ctx, query: { warehouseId?: string | undefined; zoneId?: string | undefined }) {
      const warehouseIds = scopeOf(ctx, query.warehouseId);
      const rows = await store.balances({ ...(warehouseIds && { warehouseIds }) });
      const known = new Map((await riders.getMany(rows.map(r => r.riderId))).map(r => [r.id, r]));
      const data = rows.filter(r => r.byWarehouse.length > 0 && (!query.zoneId || known.get(r.riderId)?.zoneId === query.zoneId)).map(r => ({
        riderId: r.riderId, name: known.get(r.riderId)?.name ?? "", cashInHand: r.total, byWarehouse: r.byWarehouse, lastDepositAt: r.lastDepositAt?.toISOString() ?? null,
      })).sort((a, b) => b.cashInHand - a.cashInHand || a.riderId.localeCompare(b.riderId));
      return { data, totalInHand: data.reduce((sum, r) => sum + r.cashInHand, 0) };
    },

    async ledger(ctx: Ctx, query: { riderId?: string | undefined; warehouseId?: string | undefined; type?: "collected" | "deposit" | "adjustment" | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined }) {
      const warehouseIds = scopeOf(ctx, query.warehouseId);
      const rows = await store.listLedger({
        ...(query.riderId && { riderId: query.riderId }), ...(warehouseIds && { warehouseIds }), ...(query.type && { type: query.type }),
        ...(query.from && { from: query.from }), ...(query.to && { to: query.to }),
      }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      return { data: page.map(ledgerView), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },

    async deposit(ctx: Ctx, input: { riderId: string; warehouseId: string; amount: number; note: string | null }) {
      assertWarehouseScope(ctx.actor, input.warehouseId);
      if (!(await riders.get(input.riderId))) throw notFound("Rider");
      if (!(await geography.warehouse(input.warehouseId))) throw notFound("Warehouse");
      try {
        const entry = await store.post(
          { riderId: input.riderId, warehouseId: input.warehouseId, type: "deposit", amount: -input.amount, orderId: null, orderNo: null, note: input.note, by: ctx.actor.userId, flags: [], at: now() },
          { limit: true },
        );
        return ledgerView(entry);
      } catch (error) {
        if (error instanceof InsufficientCashError) throw validation("The deposit is more than the cash this rider holds for the warehouse", { field: "amount", held: error.held });
        throw error;
      }
    },

    async adjust(ctx: Ctx, input: { riderId: string; warehouseId: string; amount: number; note: string }) {
      assertWarehouseScope(ctx.actor, input.warehouseId);
      if (!(await riders.get(input.riderId))) throw notFound("Rider");
      if (!(await geography.warehouse(input.warehouseId))) throw notFound("Warehouse");
      const entry = await store.post(
        { riderId: input.riderId, warehouseId: input.warehouseId, type: "adjustment", amount: input.amount, orderId: null, orderNo: null, note: input.note, by: ctx.actor.userId, flags: [], at: now() },
      );
      return ledgerView(entry);
    },

    async reconciliation(ctx: Ctx, query: { type?: string | undefined; status?: "open" | "resolved" | undefined; warehouseId?: string | undefined; limit: number; cursor?: string | undefined }) {
      const warehouseIds = scopeOf(ctx, query.warehouseId);
      const rows = await store.listReconciliation({ ...(query.type && { type: query.type }), ...(query.status && { status: query.status }), ...(warehouseIds && { warehouseIds }) }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      return { data: page.map(reconciliationView), openCount: await store.openCount(scopeOf(ctx)), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },

    async resolve(ctx: Ctx, id: string, input: { outcome: ReconciliationOutcome; note: string | null; bankReference: string | null; amount?: number | undefined }) {
      const item = await store.getReconciliation(id);
      if (!item) throw notFound("Reconciliation item");
      assertWarehouseScope(ctx.actor, item.warehouseId);
      if (item.status === "resolved") throw conflict("This item was already resolved", { reason: "already_resolved" });
      if (!OUTCOMES[item.type].includes(input.outcome)) throw validation(`Use one of: ${OUTCOMES[item.type].join(", ")}`, { field: "outcome", allowed: OUTCOMES[item.type] });
      if (input.outcome === "adjust" && input.amount !== undefined && input.amount === 0) throw validation("An adjustment cannot be zero", { field: "amount" });
      const at = now();
      if (!(await store.closeReconciliation(id, { outcome: input.outcome, note: input.note, bankReference: input.bankReference, by: ctx.actor.userId, at }))) {
        throw conflict("This item was already resolved", { reason: "already_resolved" });
      }
      let refund: { id: string; amount: number } | null = null;
      try {
        const ledgerAdjustment = async (amount: number, note: string, flags: LedgerFlag[]) => store.post({
          riderId: item.riderId, warehouseId: item.warehouseId, type: "adjustment", amount, orderId: item.orderId, orderNo: item.orderNo, note, by: ctx.actor.userId, flags, at,
        });
        switch (input.outcome) {
          case "verified": await orders.setCollection(item.orderId, { method: "upi_verified", amount: item.amount }, byAdmin(ctx), { bankReference: input.bankReference }); break;
          case "not_received":
            // The rider says the customer paid by UPI, but the money never arrived: they now owe that amount in cash.
            await ledgerAdjustment(item.amount, input.note ?? `UPI payment for ${item.orderNo} was not received`, ["discrepancy"]);
            await orders.setCollection(item.orderId, { method: "cash", amount: item.amount }, byAdmin(ctx), { reason: "upi_not_received" });
            break;
          case "refund": refund = await orders.createRefund(item.orderId, { amount: item.amount, reason: "Paid online and cash was also taken" }, byAdmin(ctx)); break;
          case "adjust": await ledgerAdjustment(input.amount ?? -item.amount, input.note ?? `Adjustment for ${item.orderNo}`, []); break;
          case "keep": break;
        }
      } catch (error) {
        await store.reopenReconciliation(id);
        throw error;
      }
      return { ...reconciliationView((await store.getReconciliation(id))!), ...(refund && { refund }) };
    },

    /** Corrects a wrong collection record. The ledger is never edited: it gets an adjustment for the difference. */
    async fixCollection(ctx: Ctx, orderId: string, input: { method: CollectMethod; amount: number; reason: string }) {
      const order = await orders.get(orderId);
      if (!order) throw notFound("Order");
      assertWarehouseScope(ctx.actor, order.warehouseId);
      const previous = await store.collectedFor(orderId);
      const riderId = previous?.riderId ?? (await relations.riderOfOrder(orderId));
      const delta = (input.method === "cash" ? input.amount : 0) - (await store.netForOrder(orderId));
      if (delta !== 0 && !riderId) throw conflict("No rider is linked to this order, so the cash cannot be adjusted", { reason: "no_rider" });
      if (delta !== 0) {
        await store.post({
          riderId: riderId!, warehouseId: previous?.warehouseId ?? order.warehouseId, type: "adjustment", amount: delta, orderId, orderNo: order.orderNo,
          note: input.reason, by: ctx.actor.userId, flags: [], at: now(),
        });
      }
      if (input.method === "upi" && riderId) {
        const rider = await riders.get(riderId);
        if (rider) await store.openReconciliation({ type: "upi_unverified", orderId, orderNo: order.orderNo, riderId, riderName: rider.name, warehouseId: order.warehouseId, amount: input.amount, at: now() });
      }
      const moved = await orders.setCollection(orderId, { method: input.method === "cash" ? "cash" : "upi_unverified", amount: input.amount }, byAdmin(ctx), { reason: input.reason });
      if (!moved.ok) throw notFound("Order");
      const o = moved.order;
      return { id: o.id, orderNo: o.orderNo, status: o.status, paymentStatus: o.paymentStatus, collection: { method: o.collectionMethod, amount: o.collectionAmount } };
    },
  };
}

export type CashService = ReturnType<typeof createCashService>;
