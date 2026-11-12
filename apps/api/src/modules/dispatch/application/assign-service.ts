import type { DeliveryOrder } from "../../../platform/orders.js";
import { assertWarehouseScope, conflict, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { haversineMeters, type Rider } from "../../riders/riders.public.js";
import {
  assignmentView, batchLimit, batchView, buildStops, ineligibleReasons, rankCandidates, type Assignment, type Batch, type IneligibleReason,
} from "../domain/dispatch.js";
import type { BatchService } from "./batch-service.js";
import { orderActorOf, type Decider, type DispatchDeps } from "./context.js";
import { eligibilityError, invalidTransition, transitionError } from "./errors.js";

export type GroupDispatch =
  | { mode: "same_rider"; riderId: string; pickupOrder?: string[] | undefined }
  | { mode: "different_riders"; assignments: { orderId: string; riderId: string }[] };
export interface FailedResolution { action: "redispatch" | "cancel_return"; goodsCondition?: "good" | "spoiled" | undefined; note?: string | null | undefined }

const POST_PICKUP = ["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"];
/** A message to a rider must never undo a dispatch decision that has already been made. */
const quietly = (work: Promise<unknown>) => work.catch(() => undefined);

/** Who delivers which order (F18): assigning, taking back, handing over and the follow-up of a failed delivery. */
export function createAssignService(deps: DispatchDeps, batches: BatchService) {
  const { store, riders, orders, geography, notifier, settings, now, newId } = deps;

  async function orderFor(ctx: Ctx, orderId: string): Promise<DeliveryOrder> {
    const order = await orders.get(orderId);
    if (!order) throw notFound("Order");
    assertWarehouseScope(ctx.actor, order.warehouseId);
    return order;
  }
  async function riderFor(riderId: string): Promise<Rider> {
    const rider = await riders.get(riderId);
    if (!rider) throw notFound("Rider");
    return rider;
  }

  /** Ends a live assignment and gives the rider the capacity back. False if someone else already ended it. */
  async function endAssignment(a: Assignment, status: "cancelled" | "reassigned", reason: string): Promise<boolean> {
    const at = now();
    const done = await store.updateAssignment(a.id, { status, live: false, endedAt: at, endReason: reason, updatedAt: at }, { live: true });
    if (done) await riders.releaseCapacity(a.riderId);
    return done;
  }

  /** Ends an assignment, tells the rider it was taken back, and takes the order out of its batch. */
  async function takeBack(a: Assignment, reason: string, order: DeliveryOrder, event: "cancelled" | "reassigned_away" = "cancelled") {
    if (!(await endAssignment(a, event === "cancelled" ? "cancelled" : "reassigned", reason))) return false;
    await batches.detach(a.orderId);
    await store.appendFeed({ riderId: a.riderId, assignmentId: a.id, orderId: a.orderId, event, at: now() });
    const rider = await riders.get(a.riderId);
    if (rider) await quietly(notifier.cancelled(rider, { assignmentId: a.id, orderId: a.orderId, orderNo: order.orderNo }));
    return true;
  }

  async function assignOrder(order: DeliveryOrder, rider: Rider, opts: { who: Decider; mode: "manual" | "auto"; batch: Batch | null }) {
    const reasons = ineligibleReasons(rider, order, settings, now());
    if (reasons.length > 0) throw eligibilityError(reasons);
    if (opts.batch && (opts.batch.status !== "planned" || opts.batch.riderId !== rider.id || !opts.batch.orderIds.includes(order.id))) {
      throw conflict("This order is not in a planned batch for this rider", { batchId: opts.batch.id, reason: "batch_mismatch" });
    }
    // Claim the rider's capacity first: two admins assigning at once can never put a rider over the limit.
    if (!(await riders.reserveCapacity(rider.id, settings.maxActiveOrders))) throw eligibilityError(["at_capacity"]);
    const moved = await orders.transition(order.id, "ASSIGNED", orderActorOf(opts.who), { riderId: rider.id });
    if (!moved.ok) { await riders.releaseCapacity(rider.id); throw transitionError(moved, "ASSIGNED"); }
    const at = now();
    const assignment: Assignment = {
      id: newId(), orderId: order.id, riderId: rider.id, batchId: opts.batch?.id ?? null, status: "assigned", live: true, mode: opts.mode,
      assignedBy: opts.who.kind === "admin" ? opts.who.ctx.actor.userId : null, assignedAt: at, ackDeadlineAt: new Date(at.getTime() + settings.ackTimeoutSeconds * 1000),
      ackAt: null, escalatedAt: null, whatsappSentAt: null, outcome: null, completedAt: null, endedAt: null, endReason: null, handoverFromId: null,
      zoneId: order.zoneId, warehouseId: order.warehouseId, groupId: order.groupId, pickup: null, failedResolvedAt: null, createdAt: at, updatedAt: at,
    };
    try { await store.insertAssignment(assignment); }
    catch (error) {
      await orders.transition(order.id, "READY", { kind: "system", id: "dispatch" });
      await riders.releaseCapacity(rider.id);
      throw error;
    }
    await riders.markAssigned(rider.id, at);
    await store.appendFeed({ riderId: rider.id, assignmentId: assignment.id, orderId: order.id, event: "assigned", at });
    await quietly(notifier.assigned(rider, { assignmentId: assignment.id, orderNo: order.orderNo, ackDeadlineAt: assignment.ackDeadlineAt }));
    return { assignment, order: moved.order };
  }

  /** The best rider who can take the order now, if any. */
  async function candidates(order: DeliveryOrder, opts: { excludeRiderId?: string; ignoreWarehouse?: boolean } = {}) {
    const warehouse = await geography.warehouse(order.warehouseId);
    const eligible: { rider: Rider; distanceMeters: number | null }[] = [];
    const ineligible: { rider: Rider; reasons: IneligibleReason[] }[] = [];
    for (const rider of await riders.listActive()) {
      if (rider.id === opts.excludeRiderId) continue;
      // Goods already picked up are out of the warehouse, so which warehouses a rider serves no longer matters.
      const reasons = ineligibleReasons(rider, order, settings, now()).filter(r => !(opts.ignoreWarehouse && r === "wrong_warehouse"));
      if (reasons.length > 0) { ineligible.push({ rider, reasons }); continue; }
      eligible.push({ rider, distanceMeters: rider.lastLocation && warehouse ? haversineMeters(rider.lastLocation, warehouse.location) : null });
    }
    return { ranked: rankCandidates(eligible), ineligible };
  }

  return {
    async suggestions(ctx: Ctx, orderId: string) {
      const order = await orderFor(ctx, orderId);
      const changing = order.status === "ASSIGNED" || POST_PICKUP.includes(order.status);
      if (order.status !== "READY" && !changing) throw invalidTransition(order, "Only a ready or assigned order can be given to a rider");
      // For an order that already has a rider, suggest the others (the current rider is left out).
      const current = changing ? await store.liveForOrder(orderId) : null;
      const { ranked, ineligible } = await candidates(order, { ...(current && { excludeRiderId: current.riderId }), ignoreWarehouse: POST_PICKUP.includes(order.status) });
      return {
        orderId, currentRiderId: current?.riderId ?? null,
        suggested: ranked.map((c, i) => ({
          riderId: c.rider.id, name: c.rider.name, activeOrders: c.rider.activeOrderCount, distanceMeters: c.distanceMeters,
          lastAssignedAt: c.rider.lastAssignedAt?.toISOString() ?? null, score: i + 1,
        })),
        ineligible: ineligible.map(i => ({ riderId: i.rider.id, name: i.rider.name, reasons: i.reasons })),
      };
    },

    /** Every ready order still waiting for a rider, each with the riders who can take it (best first) and why the others cannot. One screen to assign from. */
    async readyOrders(ctx: Ctx) {
      const ready = await orders.listByStatus("READY", 100);
      const taken = new Set((await store.liveForOrders(ready.map(o => o.id))).map(a => a.orderId));
      const mine = ready.filter(o => !taken.has(o.id) && (ctx.actor.scope.all || ctx.actor.scope.warehouseIds.includes(o.warehouseId)));
      const at = now();
      const rows = [];
      for (const order of mine) {
        const { ranked, ineligible } = await candidates(order);
        rows.push({
          orderId: order.id, orderNo: order.orderNo, warehouseId: order.warehouseId,
          locality: order.address.locality, landmark: order.address.landmark, customerName: order.customer.name,
          itemCount: order.itemCount, paymentMethod: order.paymentMethod, alreadyPaid: order.alreadyPaid, amountDue: order.amountDue,
          readyAt: order.readyAt?.toISOString() ?? null,
          minutesWaiting: order.readyAt ? Math.max(0, Math.floor((at.getTime() - order.readyAt.getTime()) / 60_000)) : 0,
          suggested: ranked.map((c, i) => ({ riderId: c.rider.id, name: c.rider.name, activeOrders: c.rider.activeOrderCount, distanceMeters: c.distanceMeters, score: i + 1 })),
          ineligible: ineligible.map(i => ({ riderId: i.rider.id, name: i.rider.name, reasons: i.reasons })),
        });
      }
      return rows;
    },

    async assign(ctx: Ctx, orderId: string, input: { riderId: string; batchId: string | null }) {
      const order = await orderFor(ctx, orderId);
      const rider = await riderFor(input.riderId);
      if (order.status !== "READY") throw invalidTransition(order, order.status === "ASSIGNED" ? "The order is already assigned: unassign it first" : "Only a ready order can be assigned");
      const batch = input.batchId ? await store.getBatch(input.batchId) : null;
      if (input.batchId && !batch) throw notFound("Batch");
      const done = await assignOrder(order, rider, { who: { kind: "admin", ctx }, mode: "manual", batch });
      return { assignment: assignmentView(done.assignment), order: { id: order.id, status: done.order.status } };
    },

    async unassign(ctx: Ctx, orderId: string, reason: string | null) {
      const order = await orderFor(ctx, orderId);
      if (order.status !== "ASSIGNED") throw invalidTransition(order, POST_PICKUP.includes(order.status) ? "The order was already picked up: use a hand-over" : "The order is not assigned", { reason: POST_PICKUP.includes(order.status) ? "after_pickup" : "not_assigned" });
      const live = await store.liveForOrder(orderId);
      const moved = await orders.transition(orderId, "READY", { kind: "admin", id: ctx.actor.userId }, { reason });
      if (!moved.ok) throw transitionError(moved, "READY");
      if (live) await takeBack(live, reason ?? "unassigned", order);
      return { order: { id: orderId, status: moved.order.status } };
    },

    async dispatchGroup(ctx: Ctx, groupId: string, input: GroupDispatch) {
      const children = (await orders.childrenOf(groupId)).filter(o => o.status !== "CANCELLED");
      if (children.length === 0) throw notFound("Order group");
      for (const child of children) assertWarehouseScope(ctx.actor, child.warehouseId);
      const who: Decider = { kind: "admin", ctx };
      const done: Assignment[] = [];
      const undo = async (batch: Batch | null) => {
        for (const a of done) {
          const order = children.find(c => c.id === a.orderId)!;
          await orders.transition(a.orderId, "READY", { kind: "system", id: "dispatch" });
          await takeBack(a, "dispatch_failed", order);
        }
        if (batch) await store.updateBatch(batch.id, { status: "cancelled", updatedAt: now() });
      };

      if (input.mode === "same_rider") {
        const rider = await riderFor(input.riderId);
        const notReady = children.find(c => c.status !== "READY");
        if (notReady) throw invalidTransition(notReady, "Every order of the group must be ready", { orderId: notReady.id });
        const reasons = new Set<IneligibleReason>(children.flatMap(c => ineligibleReasons(rider, c, settings, now())));
        if (children.length > batchLimit(settings)) reasons.add("at_capacity");
        if (reasons.size > 0) throw eligibilityError([...reasons]);
        const warehouses = [...new Set(children.map(c => c.warehouseId))];
        const pickupOrder = input.pickupOrder ?? warehouses;
        if (pickupOrder.length !== warehouses.length || !warehouses.every(w => pickupOrder.includes(w))) {
          throw validation("pickupOrder must list each warehouse of the group exactly once", { field: "pickupOrder" });
        }
        const at = now();
        const batch: Batch = { id: newId(), riderId: rider.id, zoneId: rider.zoneId, status: "planned", stops: buildStops(children, pickupOrder), orderIds: children.map(c => c.id), createdBy: ctx.actor.userId, createdAt: at, updatedAt: at };
        await store.insertBatch(batch);
        try { for (const child of children) done.push((await assignOrder(child, rider, { who, mode: "manual", batch })).assignment); }
        catch (error) { await undo(batch); throw error; }
        return { batch: batchView(batch), assignments: done.map(assignmentView) };
      }

      const wanted = new Map(input.assignments.map(a => [a.orderId, a.riderId]));
      if (wanted.size !== input.assignments.length) throw validation("An order is listed twice", { field: "assignments" });
      for (const orderId of wanted.keys()) if (!children.some(c => c.id === orderId)) throw validation("That order is not part of this group", { field: "assignments", orderId });
      for (const child of children.filter(c => wanted.has(c.id))) if (child.status !== "READY") throw invalidTransition(child, "Every order being assigned must be ready", { orderId: child.id });
      try {
        for (const child of children.filter(c => wanted.has(c.id))) done.push((await assignOrder(child, await riderFor(wanted.get(child.id)!), { who, mode: "manual", batch: null })).assignment);
      } catch (error) { await undo(null); throw error; }
      return { batch: null, assignments: done.map(assignmentView) };
    },

    /** Before pickup: gives an assigned order to a different rider in one step. The first rider's alarm is cancelled, the new rider's rings. */
    async reassign(ctx: Ctx, orderId: string, input: { toRiderId: string; reason?: string | null | undefined }) {
      const order = await orderFor(ctx, orderId);
      if (order.status !== "ASSIGNED") throw invalidTransition(order, POST_PICKUP.includes(order.status) ? "The order was already picked up: use a hand-over" : "Only an assigned order can be given to another rider");
      const old = await store.liveForOrder(orderId);
      if (!old) throw notFound("Assignment");
      if (old.riderId === input.toRiderId) throw validation("The order is already with that rider", { field: "toRiderId" });
      const rider = await riderFor(input.toRiderId);
      const reasons = ineligibleReasons(rider, order, settings, now());
      if (reasons.length > 0) throw eligibilityError(reasons);
      if (!(await riders.reserveCapacity(rider.id, settings.maxActiveOrders))) throw eligibilityError(["at_capacity"]);

      const at = now();
      const next: Assignment = {
        ...old, id: newId(), riderId: rider.id, batchId: null, status: "assigned", live: true, mode: "manual", assignedBy: ctx.actor.userId, assignedAt: at,
        ackDeadlineAt: new Date(at.getTime() + settings.ackTimeoutSeconds * 1000), ackAt: null, escalatedAt: null, whatsappSentAt: null,
        handoverFromId: null, createdAt: at, updatedAt: at,
      };
      const why = input.reason?.trim() || "reassigned";
      if (!(await endAssignment(old, "reassigned", why))) { await riders.releaseCapacity(rider.id); throw conflict("The order was just reassigned", { reason: "changed" }); }
      try { await store.insertAssignment(next); }
      catch (error) {
        await store.updateAssignment(old.id, { status: old.status, live: true, endedAt: null, endReason: null }, { live: false });
        await riders.reserveCapacity(old.riderId, settings.maxActiveOrders + 1);
        await riders.releaseCapacity(rider.id);
        throw error;
      }
      await batches.detach(orderId);
      await riders.markAssigned(rider.id, at);
      await orders.recordEvent(orderId, "reassigned", { kind: "admin", id: ctx.actor.userId }, { fromRiderId: old.riderId, toRiderId: rider.id, reason: why });
      await store.appendFeed({ riderId: old.riderId, assignmentId: old.id, orderId, event: "reassigned_away", at });
      await store.appendFeed({ riderId: rider.id, assignmentId: next.id, orderId, event: "assigned", at });
      const from = await riders.get(old.riderId);
      if (from) await quietly(notifier.cancelled(from, { assignmentId: old.id, orderId, orderNo: order.orderNo }));
      await quietly(notifier.assigned(rider, { assignmentId: next.id, orderNo: order.orderNo, ackDeadlineAt: next.ackDeadlineAt }));
      return { assignment: assignmentView(next), order: { id: orderId, status: order.status } };
    },

    /** The rider cannot go on (breakdown, road block): the order, already picked up, goes to another rider. */
    async handover(ctx: Ctx, orderId: string, input: { toRiderId: string; reason: string }) {
      const order = await orderFor(ctx, orderId);
      if (!POST_PICKUP.includes(order.status)) throw invalidTransition(order, "Only an order that has been picked up can be handed over: unassign it instead", { reason: "before_pickup" });
      const old = await store.liveForOrder(orderId);
      if (!old) throw notFound("Assignment");
      if (old.riderId === input.toRiderId) throw validation("The order is already with that rider", { field: "toRiderId" });
      const rider = await riderFor(input.toRiderId);
      // The goods are already out of the warehouse, so only the rider's zone, shift and load matter, not which warehouses they serve.
      const reasons = ineligibleReasons(rider, order, settings, now()).filter(r => r !== "wrong_warehouse");
      if (reasons.length > 0) throw eligibilityError(reasons);
      if (!(await riders.reserveCapacity(rider.id, settings.maxActiveOrders))) throw eligibilityError(["at_capacity"]);

      const at = now();
      const next: Assignment = {
        ...old, id: newId(), riderId: rider.id, batchId: null, status: "assigned", live: true, mode: "manual", assignedBy: ctx.actor.userId, assignedAt: at,
        ackDeadlineAt: new Date(at.getTime() + settings.ackTimeoutSeconds * 1000), ackAt: null, escalatedAt: null, whatsappSentAt: null,
        handoverFromId: old.id, createdAt: at, updatedAt: at,
      };
      // End the old assignment first (frees the one-live-assignment-per-order rule), then start the new one.
      if (!(await endAssignment(old, "reassigned", input.reason))) { await riders.releaseCapacity(rider.id); throw conflict("The order was just reassigned", { reason: "changed" }); }
      try { await store.insertAssignment(next); }
      catch (error) {
        await store.updateAssignment(old.id, { status: old.status, live: true, endedAt: null, endReason: null }, { live: false });
        await riders.reserveCapacity(old.riderId, settings.maxActiveOrders + 1);
        await riders.releaseCapacity(rider.id);
        throw error;
      }
      await batches.detach(orderId);
      await riders.markAssigned(rider.id, at);
      await orders.recordEvent(orderId, "handover", { kind: "admin", id: ctx.actor.userId }, { fromRiderId: old.riderId, toRiderId: rider.id, reason: input.reason });
      await store.appendFeed({ riderId: old.riderId, assignmentId: old.id, orderId, event: "reassigned_away", at });
      await store.appendFeed({ riderId: rider.id, assignmentId: next.id, orderId, event: "assigned", at });
      const from = await riders.get(old.riderId);
      if (from) await quietly(notifier.cancelled(from, { assignmentId: old.id, orderId, orderNo: order.orderNo }));
      await quietly(notifier.handover(rider, { assignmentId: next.id, orderId, orderNo: order.orderNo, ackDeadlineAt: next.ackDeadlineAt }));
      return { assignment: assignmentView(next), order: { id: orderId, status: order.status } };
    },

    /** An admin decides what happens to a delivery that failed. */
    async resolveFailed(ctx: Ctx, orderId: string, input: FailedResolution) {
      const order = await orderFor(ctx, orderId);
      if (order.status !== "FAILED_DELIVERY") throw invalidTransition(order, "Only a failed delivery can be resolved");
      let status: string;
      let refund: { id: string; amount: number } | null = null;
      if (input.action === "redispatch") {
        const moved = await orders.transition(orderId, "READY", { kind: "admin", id: ctx.actor.userId }, { note: input.note ?? null, resolution: "redispatch" });
        if (!moved.ok) throw transitionError(moved, "READY");
        status = moved.order.status;
      } else {
        if (!input.goodsCondition) throw validation("Say whether the goods are good or spoiled", { field: "goodsCondition" });
        const result = await orders.cancelFailedAndReturn(orderId, { goodsCondition: input.goodsCondition, note: input.note ?? null }, { kind: "admin", id: ctx.actor.userId });
        if (!result.ok) throw transitionError(result, "CANCELLED");
        status = result.order.status;
        refund = result.refund;
      }
      const at = now();
      for (const a of await store.failedForOrder(orderId)) await store.updateAssignment(a.id, { failedResolvedAt: at, updatedAt: at });
      return { order: { id: orderId, status }, refund };
    },

    // ---------- for the orders module (Dev 1) and the background sweeps ----------
    /** The order was cancelled: whoever had it is told, and gets their capacity back. */
    async onOrderCancelled(orderId: string): Promise<void> {
      const live = await store.liveForOrder(orderId);
      const order = await orders.get(orderId);
      if (live && order) await takeBack(live, "order_cancelled", order);
    },

    /** The customer's payment arrived: the rider must not collect cash. */
    async onOrderPaid(orderId: string): Promise<void> {
      const live = await store.liveForOrder(orderId);
      const order = await orders.get(orderId);
      if (!live || !order) return;
      await store.appendFeed({ riderId: live.riderId, assignmentId: live.id, orderId, event: "payment_paid", at: now() });
      const rider = await riders.get(live.riderId);
      if (rider) await quietly(notifier.paid(rider, { orderId, orderNo: order.orderNo }));
    },

    /** In auto mode, gives each waiting ready order to the best rider. Manual mode leaves it to the admin. */
    async autoAssignPending(): Promise<number> {
      if (settings.assignmentMode !== "auto") return 0;
      let assigned = 0;
      const ready = await orders.listByStatus("READY", 50);
      const taken = new Set((await store.liveForOrders(ready.map(o => o.id))).map(a => a.orderId));
      for (const order of ready.filter(o => !taken.has(o.id))) {
        const { ranked } = await candidates(order);
        if (!ranked[0]) continue;
        try { await assignOrder(order, ranked[0].rider, { who: { kind: "system" }, mode: "auto", batch: null }); assigned++; } catch { /* the next pass tries again */ }
      }
      return assigned;
    },

    /** Orders nobody acknowledged in time: WhatsApp to the rider (the admin sees the alert on the board). */
    async sweepAcks(): Promise<number> {
      let escalated = 0;
      for (const a of await store.dueForEscalation(now(), 100)) {
        if (!(await store.markEscalated(a.id, now()))) continue;
        escalated++;
        const [rider, order] = await Promise.all([riders.get(a.riderId), orders.get(a.orderId)]);
        if (!rider || !order) continue;
        if (await notifier.unacknowledged(rider, { assignmentId: a.id, orderNo: order.orderNo }).catch(() => false)) await store.updateAssignment(a.id, { whatsappSentAt: now() });
      }
      return escalated;
    },
  };
}

export type AssignService = ReturnType<typeof createAssignService>;
