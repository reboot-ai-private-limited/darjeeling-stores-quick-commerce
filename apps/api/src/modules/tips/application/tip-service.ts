import { assertWarehouseScope, validation, type Ctx } from "../../catalog/catalog.public.js";
import { dayRange, dayStart, addDays } from "../../reports/reports.public.js";
import type { TipFilter, TipRow, TipStore } from "./ports.js";

export interface TipsDeps { store: TipStore; now: () => Date }
export interface RangeQuery { from?: string | undefined; to?: string | undefined }

const rowView = (r: TipRow) => ({
  orderId: r.orderId, orderNo: r.orderNo, amount: r.amount, deliveredAt: r.deliveredAt.toISOString(), status: r.status, paidAt: r.paidAt?.toISOString() ?? null,
});

/** Rider tips (F22): what each rider has earned from customers' tips, and what the owner still has to pay them. */
export function createTipService({ store, now }: TipsDeps) {
  function range(query: RangeQuery) {
    const r = dayRange(query, now());
    if ("error" in r) throw validation(r.error, [{ path: "from", message: r.error }]);
    return r;
  }
  function warehousesFor(ctx: Ctx, warehouseId: string | undefined): readonly string[] | null {
    if (warehouseId) { assertWarehouseScope(ctx.actor, warehouseId); return [warehouseId]; }
    return ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds;
  }

  return {
    /** A rider's own tips: totals, and the deliveries behind them. */
    async mine(riderId: string, query: RangeQuery & { limit: number }) {
      const r = range(query);
      const filter: TipFilter = { start: r.start, end: r.end, riderId, warehouseIds: null };
      const [totals, rows] = await Promise.all([store.totals(filter), store.list({ ...filter, limit: query.limit })]);
      return { from: r.from, to: r.to, totals, items: rows.map(rowView) };
    },

    /** Every rider's tips, with what is still owed. */
    async summary(ctx: Ctx, query: RangeQuery & { warehouseId?: string | undefined; riderId?: string | undefined }) {
      const r = range(query);
      const filter: TipFilter = { start: r.start, end: r.end, riderId: query.riderId, warehouseIds: warehousesFor(ctx, query.warehouseId) };
      const [totals, riders] = await Promise.all([store.totals(filter), store.byRider(filter)]);
      return { from: r.from, to: r.to, totals, riders };
    },

    async orders(ctx: Ctx, query: RangeQuery & { warehouseId?: string | undefined; riderId?: string | undefined; status?: "owed" | "paid" | undefined; limit: number }) {
      const r = range(query);
      const rows = await store.list({ start: r.start, end: r.end, riderId: query.riderId, status: query.status, limit: query.limit, warehouseIds: warehousesFor(ctx, query.warehouseId) });
      return rows.map(row => ({ ...rowView(row), riderId: row.riderId, warehouseId: row.warehouseId }));
    },

    /** The owner has paid the rider: the listed tips, or every owed tip delivered up to and including a day. Safe to repeat. */
    async pay(ctx: Ctx, input: { riderId: string; orderIds?: string[] | undefined; upTo?: string | undefined; note?: string | null | undefined }) {
      if ((input.orderIds === undefined) === (input.upTo === undefined)) throw validation("Send either orderIds or upTo", { field: "orderIds" });
      let before: Date | undefined;
      if (input.upTo !== undefined) {
        const r = dayRange({ from: input.upTo, to: input.upTo }, now());
        if ("error" in r) throw validation(r.error, { field: "upTo" });
        before = dayStart(addDays(r.to, 1));
      }
      const note = input.note ?? null;
      const result = await store.pay({
        riderId: input.riderId, orderIds: input.orderIds, before, warehouseIds: ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds, by: ctx.actor.userId, note, at: now(),
        audit: ({ count, amount }) => ({
          actorId: ctx.actor.userId, actorRole: ctx.actor.role, action: "tips.pay", entityType: "rider", entityId: input.riderId, requestId: ctx.requestId,
          reason: `${note ? `${note}: ` : ""}paid ${count} tip${count === 1 ? "" : "s"} totalling ${amount} paise`.slice(0, 500),
        }),
      });
      return { riderId: input.riderId, paidCount: result.count, paidAmount: result.amount };
    },
  };
}

export type TipService = ReturnType<typeof createTipService>;
