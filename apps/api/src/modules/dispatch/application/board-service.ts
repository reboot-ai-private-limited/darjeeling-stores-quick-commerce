import { assertWarehouseScope, type Ctx } from "../../catalog/catalog.public.js";
import type { Rider } from "../../riders/riders.public.js";
import type { Assignment, AssignmentStatus } from "../domain/dispatch.js";
import type { DispatchDeps } from "./context.js";

const PROBLEM_WINDOW_MS = 12 * 3_600_000;

/** What the dispatch board shows: who has what, what needs attention, and where the riders are (F18). */
export function createBoardService(deps: DispatchDeps) {
  const { store, riders, orders, settings, now } = deps;
  const minutesSince = (from: Date) => Math.max(0, Math.floor((now().getTime() - from.getTime()) / 60_000));
  const scopeOf = (ctx: Ctx) => (ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds);
  const inScope = (ctx: Ctx, warehouseId: string) => ctx.actor.scope.all || ctx.actor.scope.warehouseIds.includes(warehouseId);
  const riderInScope = (ctx: Ctx, rider: Rider) => ctx.actor.scope.all || rider.warehouseIds.some(w => ctx.actor.scope.warehouseIds.includes(w));

  return {
    async assignments(ctx: Ctx, query: { status?: AssignmentStatus | undefined; riderId?: string | undefined; warehouseId?: string | undefined }) {
      if (query.warehouseId) assertWarehouseScope(ctx.actor, query.warehouseId);
      const rows = await store.listAssignments({ ...query, scope: scopeOf(ctx) }, 200);
      const [orderList, riderList] = await Promise.all([orders.getMany([...new Set(rows.map(r => r.orderId))]), riders.getMany([...new Set(rows.map(r => r.riderId))])]);
      const orderNo = new Map(orderList.map(o => [o.id, o.orderNo]));
      const riderName = new Map(riderList.map(r => [r.id, r.name]));
      return rows.map(a => ({
        id: a.id, orderId: a.orderId, orderNo: orderNo.get(a.orderId) ?? "", riderId: a.riderId, riderName: riderName.get(a.riderId) ?? "", status: a.status,
        ackDeadlineAt: a.ackDeadlineAt.toISOString(), overdue: a.live && a.status === "assigned" && a.ackDeadlineAt <= now(),
      }));
    },

    /** Things an admin should look at, worked out from the current state. */
    async alerts(ctx: Ctx) {
      const at = now();
      const alerts: Record<string, unknown>[] = [];

      // Waiting for an acknowledgement past the deadline, whether or not the rider has been messaged yet.
      const overdue = (await store.listAssignments({ status: "assigned", scope: scopeOf(ctx) }, 200)).filter(a => a.live && a.ackDeadlineAt <= at);
      const riderList = new Map((await riders.getMany([...new Set(overdue.map(a => a.riderId))])).map(r => [r.id, r]));
      for (const a of overdue) {
        alerts.push({
          type: "ack_overdue", orderId: a.orderId, riderId: a.riderId, since: a.ackDeadlineAt.toISOString(),
          message: `${riderList.get(a.riderId)?.name ?? "The rider"} has not acknowledged for ${minutesSince(a.assignedAt)} min${a.whatsappSentAt ? " (WhatsApp sent)" : ""}`,
        });
      }

      for (const problem of await store.recentProblems(new Date(at.getTime() - PROBLEM_WINDOW_MS), 100)) {
        const live = await store.liveForOrder(problem.orderId);
        if (live && live.riderId === problem.riderId && inScope(ctx, live.warehouseId)) {
          alerts.push({ type: "rider_problem", orderId: problem.orderId, riderId: problem.riderId, problem: problem.type, note: problem.note, since: problem.createdAt.toISOString() });
        }
      }

      const ready = await orders.listByStatus("READY", 200);
      const taken = new Set((await store.liveForOrders(ready.map(o => o.id))).map(a => a.orderId));
      for (const order of ready) {
        const minutes = order.readyAt ? minutesSince(order.readyAt) : 0;
        if (!taken.has(order.id) && inScope(ctx, order.warehouseId) && minutes >= settings.delayedAfterMinutes) alerts.push({ type: "order_delayed", orderId: order.id, state: "READY", minutes });
      }

      for (const rider of await riders.listActive()) {
        if (rider.status === "offline" && (rider.activeOrderCount > 0 || rider.currentShiftId !== null) && riderInScope(ctx, rider)) {
          alerts.push({ type: "rider_offline", riderId: rider.id, hasActiveOrder: rider.activeOrderCount > 0 });
        }
      }

      const failed = await store.failedUnresolved(100);
      const failedOrders = new Map((await orders.getMany(failed.map(f => f.orderId))).map(o => [o.id, o]));
      for (const a of failed) {
        if (failedOrders.get(a.orderId)?.status === "FAILED_DELIVERY" && inScope(ctx, a.warehouseId)) {
          alerts.push({ type: "failed_delivery", orderId: a.orderId, riderId: a.riderId, reason: a.endReason, since: a.completedAt?.toISOString() ?? null });
        }
      }
      return alerts;
    },

    /** Riders on shift with their last position and what they are carrying, for the map. */
    async live(ctx: Ctx, query: { zoneId?: string | undefined; warehouseId?: string | undefined }) {
      if (query.warehouseId) assertWarehouseScope(ctx.actor, query.warehouseId);
      const onShift = (await riders.listActive()).filter(r => r.currentShiftId !== null
        && (!query.zoneId || r.zoneId === query.zoneId) && (!query.warehouseId || r.currentWarehouseId === query.warehouseId) && riderInScope(ctx, r));
      const liveByRider = new Map<string, Assignment[]>();
      for (const rider of onShift) liveByRider.set(rider.id, await store.liveForRider(rider.id));
      const orderList = new Map((await orders.getMany([...liveByRider.values()].flat().map(a => a.orderId))).map(o => [o.id, o]));
      return onShift.map(r => ({
        riderId: r.id, name: r.name, status: r.status, currentWarehouseId: r.currentWarehouseId, location: r.lastLocation, lastLocationAt: r.lastLocationAt?.toISOString() ?? null,
        activeOrders: (liveByRider.get(r.id) ?? []).flatMap(a => { const o = orderList.get(a.orderId); return o ? [{ orderId: o.id, orderNo: o.orderNo, status: o.status }] : []; }),
      }));
    },
  };
}

export type BoardService = ReturnType<typeof createBoardService>;
