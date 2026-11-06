import { AppError, assertWarehouseScope, conflict, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import type { DeliveryOrder } from "../../../platform/orders.js";
import { batchLimit, batchView, buildStops, ineligibleReasons, sameStops, type Batch, type Stop } from "../domain/dispatch.js";
import type { DispatchDeps } from "./context.js";
import { eligibilityError } from "./errors.js";

export interface BatchInput {
  riderId: string; orderIds: string[];
  stops?: { type: "pickup" | "drop"; warehouseId?: string | undefined; orderIds: string[] }[] | undefined;
}
export type BatchPatch =
  | { stops: { type: "pickup" | "drop"; warehouseId?: string | undefined; orderIds: string[] }[]; addOrderIds?: undefined; removeOrderIds?: undefined }
  | { addOrderIds?: string[] | undefined; removeOrderIds?: string[] | undefined; stops?: undefined };

/** Progress of a batch as its orders move: pickups done, the rider at a drop, orders finished. Pure, so it is easy to check. */
export function afterPickup(batch: Batch, orderId: string, at: Date): Batch {
  const stops = batch.stops.map(s => {
    if (s.type !== "pickup" || !s.orderIds.includes(orderId) || s.doneOrderIds.includes(orderId)) return s;
    const doneOrderIds = [...s.doneOrderIds, orderId];
    return doneOrderIds.length === s.orderIds.length ? { ...s, doneOrderIds, status: "done" as const, doneAt: at } : { ...s, doneOrderIds, status: "arrived" as const };
  });
  return { ...batch, stops, status: batch.status === "planned" ? "active" : batch.status, updatedAt: at };
}
export function afterArrived(batch: Batch, orderIds: readonly string[], at: Date): Batch {
  const stops = batch.stops.map(s => (s.type === "drop" && s.orderIds.some(id => orderIds.includes(id)) && s.status === "pending" ? { ...s, status: "arrived" as const, arrivedAt: at } : s));
  return { ...batch, stops, updatedAt: at };
}
export function afterFinished(batch: Batch, orderId: string, at: Date): Batch {
  const stops = batch.stops.map(s => {
    if (s.type !== "drop" || !s.orderIds.includes(orderId) || s.doneOrderIds.includes(orderId)) return s;
    const doneOrderIds = [...s.doneOrderIds, orderId];
    return doneOrderIds.length === s.orderIds.length ? { ...s, doneOrderIds, status: "done" as const, doneAt: at } : { ...s, doneOrderIds };
  });
  const finished = stops.filter(s => s.type === "drop").every(s => s.status === "done");
  return { ...batch, stops, status: finished ? "done" : batch.status, updatedAt: at };
}
/** Every pickup of the batch is done, so the ride can start. */
export const pickupsDone = (batch: Batch) => batch.stops.filter(s => s.type === "pickup").every(s => s.status === "done");

/** Groups of orders for one rider, with the order of stops (F18). */
export function createBatchService(deps: DispatchDeps) {
  const { store, riders, orders, settings, now, newId } = deps;

  async function loadOrders(ids: readonly string[]): Promise<DeliveryOrder[]> {
    const unique = [...new Set(ids)];
    const found = await orders.getMany(unique);
    if (found.length !== unique.length) throw notFound("Order");
    return unique.map(id => found.find(o => o.id === id)!);
  }
  /** The orders must be ready, in the rider's zone, and at warehouses the rider may serve. */
  async function checkMembers(rider: NonNullable<Awaited<ReturnType<typeof riders.get>>>, list: readonly DeliveryOrder[], ctx: Ctx, skipBatch?: string) {
    if (list.length === 0) throw validation("A batch needs at least one order", { field: "orderIds" });
    if (list.length > batchLimit(settings)) throw validation(`A batch holds at most ${batchLimit(settings)} orders`, { field: "orderIds", reason: "batch_limit" });
    for (const order of list) {
      assertWarehouseScope(ctx.actor, order.warehouseId);
      if (order.status !== "READY") throw new AppError("INVALID_TRANSITION", "Only ready orders can go in a batch", { from: order.status, orderId: order.id });
      const reasons = ineligibleReasons(rider, order, settings, now()).filter(r => r === "wrong_zone" || r === "wrong_warehouse");
      if (reasons.length > 0) throw eligibilityError(reasons);
      const other = await store.batchOfOrder(order.id);
      if (other && other.id !== skipBatch) throw conflict("This order is already in another batch", { orderId: order.id, batchId: other.id });
    }
  }
  function stopsFor(list: readonly DeliveryOrder[], proposed: BatchInput["stops"]): Stop[] {
    if (!proposed) return buildStops(list);
    const stops = sameStops(list.map(o => o.id), proposed, list);
    if (!stops) throw validation("Stops must pick up and drop off every order exactly once", { field: "stops" });
    return stops;
  }
  async function mine(ctx: Ctx, id: string): Promise<Batch> {
    const batch = await store.getBatch(id);
    if (!batch) throw notFound("Batch");
    if (!ctx.actor.scope.all) {
      const first = (await orders.getMany(batch.orderIds))[0];
      if (first) assertWarehouseScope(ctx.actor, first.warehouseId);
    }
    return batch;
  }

  return {
    async create(ctx: Ctx, input: BatchInput) {
      const rider = await riders.get(input.riderId);
      if (!rider) throw notFound("Rider");
      const list = await loadOrders(input.orderIds);
      await checkMembers(rider, list, ctx);
      const at = now();
      const batch: Batch = { id: newId(), riderId: rider.id, zoneId: rider.zoneId, status: "planned", stops: stopsFor(list, input.stops), orderIds: list.map(o => o.id), createdBy: ctx.actor.userId, createdAt: at, updatedAt: at };
      await store.insertBatch(batch);
      return batchView(batch);
    },

    async list(ctx: Ctx, query: { status?: Batch["status"] | undefined; riderId?: string | undefined }) {
      const all = await store.listBatches(query, 200);
      if (ctx.actor.scope.all) return all.map(batchView);
      const visible: Batch[] = [];
      for (const batch of all) {
        const first = (await orders.getMany(batch.orderIds))[0];
        if (first && ctx.actor.scope.warehouseIds.includes(first.warehouseId)) visible.push(batch);
      }
      return visible.map(batchView);
    },

    /** Reorder the stops, or add and remove orders. Only while nothing has started. */
    async update(ctx: Ctx, id: string, patch: BatchPatch) {
      const batch = await mine(ctx, id);
      if (batch.status !== "planned") throw conflict("Only a batch that has not started can be changed", { reason: "not_planned" });
      const rider = (await riders.get(batch.riderId))!;
      const current = await loadOrders(batch.orderIds);
      let list = current;
      let stops: Stop[];
      if (patch.stops) {
        stops = stopsFor(current, patch.stops);
      } else {
        const remove = new Set(patch.removeOrderIds ?? []);
        for (const orderId of remove) {
          if (!batch.orderIds.includes(orderId)) throw validation("That order is not in this batch", { orderId });
          if (await store.liveForOrder(orderId)) throw conflict("Unassign the order before taking it out of the batch", { orderId, reason: "assigned" });
        }
        const added = await loadOrders((patch.addOrderIds ?? []).filter(orderId => !batch.orderIds.includes(orderId)));
        list = [...current.filter(o => !remove.has(o.id)), ...added];
        await checkMembers(rider, list, ctx, batch.id);
        stops = buildStops(list);
      }
      const next: Batch = { ...batch, stops, orderIds: list.map(o => o.id), updatedAt: now() };
      if (!(await store.updateBatch(id, { stops: next.stops, orderIds: next.orderIds, updatedAt: next.updatedAt }, { status: "planned" }))) throw conflict("The batch has started", { reason: "not_planned" });
      return batchView(next);
    },

    async cancel(ctx: Ctx, id: string) {
      const batch = await mine(ctx, id);
      if (batch.status !== "planned") throw conflict("Only a batch that has not started can be cancelled", { reason: "not_planned" });
      if (!(await store.updateBatch(id, { status: "cancelled", updatedAt: now() }, { status: "planned" }))) throw conflict("The batch has started", { reason: "not_planned" });
      // Orders already assigned stay with their rider, just no longer as a batch.
      for (const a of await store.liveForOrders(batch.orderIds)) await store.updateAssignment(a.id, { batchId: null, updatedAt: now() }, { live: true });
    },

    /** Takes an order out of its batch when it stops being carried (unassigned, handed over, cancelled). */
    async detach(orderId: string) {
      const batch = await store.batchOfOrder(orderId);
      if (!batch) return;
      const remaining = batch.orderIds.filter(id => id !== orderId);
      const at = now();
      if (remaining.length === 0) { await store.updateBatch(batch.id, { orderIds: [], stops: [], status: batch.status === "planned" ? "cancelled" : "done", updatedAt: at }); return; }
      const list = await orders.getMany(remaining);
      // Stops already started keep their progress; the removed order just leaves them.
      const stops = batch.status === "planned"
        ? buildStops(list)
        : batch.stops.map(s => ({ ...s, orderIds: s.orderIds.filter(id => id !== orderId), doneOrderIds: s.doneOrderIds.filter(id => id !== orderId) })).filter(s => s.orderIds.length > 0).map((s, i) => ({ ...s, seq: i + 1 }));
      await store.updateBatch(batch.id, { orderIds: remaining, stops, updatedAt: at });
    },
  };
}

export type BatchService = ReturnType<typeof createBatchService>;
