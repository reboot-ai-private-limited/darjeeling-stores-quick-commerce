import type { DeliveryOrder, OrderActor } from "../../../platform/orders.js";
import { AppError, conflict, notFound, validation } from "../../catalog/catalog.public.js";
import type { Rider } from "../../riders/riders.public.js";
import type { Assignment, Batch, FeedEntry } from "../domain/dispatch.js";
import { afterArrived, afterFinished, afterPickup, pickupsDone } from "./batch-service.js";
import { orderSummary, type DispatchDeps } from "./context.js";
import { invalidTransition, transitionError } from "./errors.js";

export type FailReason = "customer_unreachable" | "wrong_address" | "refused" | "road_blocked" | "weather" | "other";
export type ProblemType = "vehicle_issue" | "road_blocked" | "customer_issue" | "other";

const IST_MS = 5.5 * 3_600_000;
const startOfIstDay = (at: Date) => { const d = new Date(at.getTime() + IST_MS); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - IST_MS); };
const cursorOf = (seq: number) => `c_${seq}`;
const parseCursor = (cursor: string): number => {
  const match = /^c_(\d{1,12})$/.exec(cursor);
  if (!match) throw validation("Invalid cursor", { field: "since" });
  return Number(match[1]);
};

/** What the rider does in the field (F19): the list of work, acknowledging, and every step from pickup to delivery. */
export function createFieldService(deps: DispatchDeps) {
  const { store, riders, orders, evidence, now, newId } = deps;
  const by = (rider: Rider): OrderActor => ({ kind: "rider", id: rider.userId });

  /** The rider's own live assignment for an order, with the order. Anyone else's order is simply not found. */
  async function owned(rider: Rider, orderId: string): Promise<{ assignment: Assignment; order: DeliveryOrder }> {
    const assignment = await store.liveForOrder(orderId);
    if (!assignment || assignment.riderId !== rider.id) throw notFound("Order");
    const order = await orders.get(orderId);
    if (!order) throw notFound("Order");
    return { assignment, order };
  }

  async function orderView(order: DeliveryOrder, batch: Batch | null) {
    const warehouse = await deps.geography.warehouse(order.warehouseId);
    const stop = batch?.stops.find(s => s.type === "drop" && s.orderIds.includes(order.id));
    return {
      id: order.id, orderNo: order.orderNo, groupId: order.groupId, status: order.status,
      warehouse: { id: order.warehouseId, name: warehouse?.name ?? "", location: warehouse?.location ?? null },
      items: order.items, bagCount: order.bagCount, customer: order.customer, address: order.address, voiceNote: order.voiceNote, housePhoto: order.housePhoto,
      paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, amountDue: order.amountDue, alreadyPaid: order.alreadyPaid,
      otpRequired: order.otpRequired, promisedAt: order.promisedAt.toISOString(),
      batchStop: batch && stop ? { seq: stop.seq, of: batch.stops.length } : null,
    };
  }
  async function currentView(rider: Rider, orderId: string) {
    const order = await orders.get(orderId);
    if (!order) throw notFound("Order");
    return orderView(order, await store.batchOfOrder(orderId));
  }

  async function feedView(a: Assignment) {
    const [order, batch] = await Promise.all([orders.get(a.orderId), a.batchId ? store.getBatch(a.batchId) : Promise.resolve(null)]);
    return {
      id: a.id, status: a.status, assignedAt: a.assignedAt.toISOString(), ackDeadlineAt: a.ackDeadlineAt.toISOString(),
      batch: batch ? { id: batch.id, stops: batch.stops.map(s => ({ seq: s.seq, type: s.type, ...(s.warehouseId && { warehouseId: s.warehouseId }), orderIds: s.orderIds, status: s.status })) } : null,
      orders: order ? [await orderSummary(deps, order)] : [],
    };
  }

  /** The assignment is over: free the rider's capacity and move the batch on. */
  async function finish(a: Assignment, outcome: "delivered" | "failed", reason: string | null) {
    const at = now();
    const done = await store.updateAssignment(a.id, { status: "completed", live: false, outcome, completedAt: at, endedAt: at, endReason: reason, updatedAt: at }, { live: true });
    if (!done) return;
    await riders.releaseCapacity(a.riderId);
    const batch = await store.batchOfOrder(a.orderId);
    if (batch) await store.updateBatch(batch.id, afterFinished(batch, a.orderId, at));
  }

  return {
    /** The rider's list of work. Without `since` it is everything current; with it, only what happened after that point. */
    async assignments(rider: Rider, since: string | undefined) {
      if (since === undefined) {
        const cursor = cursorOf(await store.latestSeq(rider.id));
        const live = await store.liveForRider(rider.id);
        return { data: await Promise.all(live.map(async a => ({ event: "assigned", assignment: await feedView(a) }))), cursor };
      }
      const after = parseCursor(since);
      const entries: FeedEntry[] = await store.feedSince(rider.id, after, 100);
      const data = (await Promise.all(entries.map(async e => {
        const a = await store.getAssignment(e.assignmentId);
        return a ? [{ event: e.event, assignment: await feedView(a) }] : [];
      }))).flat();
      return { data, cursor: cursorOf(entries.length > 0 ? entries[entries.length - 1]!.seq : after) };
    },

    /** There is no way to refuse: the rider acknowledges, or dispatch follows up. */
    async ack(rider: Rider, assignmentId: string) {
      const a = await store.getAssignment(assignmentId);
      if (!a || a.riderId !== rider.id || !a.live) throw notFound("Assignment");
      if (a.status === "acknowledged") throw new AppError("ALREADY_ACKNOWLEDGED", "Already acknowledged");
      const at = now();
      if (!(await store.updateAssignment(assignmentId, { status: "acknowledged", ackAt: at, updatedAt: at }, { live: true, status: "assigned" }))) {
        const again = await store.getAssignment(assignmentId);
        if (again?.live && again.status === "acknowledged") throw new AppError("ALREADY_ACKNOWLEDGED", "Already acknowledged");
        throw notFound("Assignment");
      }
      return { id: assignmentId, status: "acknowledged" as const, ackAt: at.toISOString() };
    },

    /** An order the rider has, or had: live now, or finished by this rider. */
    async order(rider: Rider, orderId: string) {
      const mine = await store.forOrderAndRider(orderId, rider.id);
      const relevant = mine.find(a => a.live || a.status === "completed");
      if (!relevant) throw notFound("Order");
      return currentView(rider, orderId);
    },

    async pickup(rider: Rider, orderId: string, checklist: { itemsVerified: boolean; bagCount: number | null }) {
      const { assignment } = await owned(rider, orderId);
      if (!checklist.itemsVerified) throw validation("Check the items before picking up", { field: "checklist.itemsVerified" });
      const current = await orders.get(orderId);
      if (current && ["CONFIRMED", "PACKING", "READY"].includes(current.status)) throw new AppError("INVALID_TRANSITION", "The order is still being packed. Wait until the store marks it ready.", { reason: "still_packing" });
      const moved = await orders.transition(orderId, "PICKED_UP", by(rider), { bagCount: checklist.bagCount, itemsVerified: true });
      if (!moved.ok) throw transitionError(moved, "PICKED_UP");
      const at = now();
      // Picking up shows the rider has the order, so it counts as acknowledged.
      await store.updateAssignment(assignment.id, {
        pickup: { at, bagCount: checklist.bagCount }, updatedAt: at, ...(assignment.status === "assigned" && { status: "acknowledged" as const, ackAt: at }),
      }, { live: true });
      const batch = await store.batchOfOrder(orderId);
      if (batch) await store.updateBatch(batch.id, afterPickup(batch, orderId, at));
      return orderView(moved.order, batch ? await store.getBatch(batch.id) : null);
    },

    /** In a batch the ride starts only after every pickup. */
    async startRide(rider: Rider, orderId: string) {
      await owned(rider, orderId);
      const batch = await store.batchOfOrder(orderId);
      if (batch && !pickupsDone(batch)) throw new AppError("INVALID_TRANSITION", "Finish every pickup before starting the ride", { reason: "pickups_pending" });
      const moved = await orders.transition(orderId, "OUT_FOR_DELIVERY", by(rider));
      if (!moved.ok) throw transitionError(moved, "OUT_FOR_DELIVERY");
      return orderView(moved.order, batch);
    },

    /** At the door. Orders of the same checkout dropped at the same stop arrive together. */
    async arrived(rider: Rider, orderId: string, location: { lat: number; lng: number } | null) {
      await owned(rider, orderId);
      const moved = await orders.transition(orderId, "ARRIVED", by(rider), { location });
      if (!moved.ok) throw transitionError(moved, "ARRIVED");
      const batch = await store.batchOfOrder(orderId);
      if (batch) {
        const stop = batch.stops.find(s => s.type === "drop" && s.orderIds.includes(orderId));
        const arrivedIds = [orderId];
        for (const otherId of (stop?.orderIds ?? []).filter(id => id !== orderId)) {
          const other = await store.liveForOrder(otherId);
          if (other?.riderId === rider.id && (await orders.transition(otherId, "ARRIVED", by(rider), { location })).ok) arrivedIds.push(otherId);
        }
        await store.updateBatch(batch.id, afterArrived(batch, arrivedIds, now()));
      }
      return orderView(moved.order, batch);
    },

    /** A check of the code the customer reads out. Changes nothing but the count of wrong tries. */
    async verifyOtp(rider: Rider, orderId: string, otp: string) {
      const { order } = await owned(rider, orderId);
      if (!order.otpRequired) return { valid: true as const };
      const result = await orders.verifyDeliveryOtp(orderId, otp);
      if (result.valid) return { valid: true as const };
      if (result.locked) throw new AppError("OTP_LOCKED", "Too many wrong codes. Ask dispatch for help.", { attemptsLeft: 0 });
      throw new AppError("OTP_MISMATCH", "That code is not right", { attemptsLeft: result.attemptsLeft });
    },

    /** `offline`: the delivery happened without signal and is being reported later, so an older `deliveredAt` is allowed. */
    async deliver(rider: Rider, orderId: string, input: { otp: string | null; deliveredAt: Date | null; location: { lat: number; lng: number } | null; accuracyM: number | null }, opts: { offline?: boolean; skipOtp?: boolean } = {}) {
      const { assignment, order } = await owned(rider, orderId).catch(async error => {
        // A repeat of a delivery that already went through is harmless: say so rather than "not found".
        const mine = await store.forOrderAndRider(orderId, rider.id);
        if (mine.some(a => a.status === "completed" && a.outcome === "delivered")) throw conflict("This order was already delivered", { reason: "already_delivered" });
        throw error;
      });
      if (order.status === "DELIVERED") throw conflict("This order was already delivered", { reason: "already_delivered" });
      if (order.status !== "ARRIVED") throw invalidTransition(order, "Mark yourself arrived before delivering");
      const at = now();
      if (input.deliveredAt && (input.deliveredAt.getTime() > at.getTime() + 5 * 60_000 || input.deliveredAt.getTime() < at.getTime() - (opts.offline ? 7 : 1) * 24 * 3_600_000)) {
        throw validation("deliveredAt must be within the last day and not in the future", { field: "deliveredAt" });
      }
      if (order.paymentMethod === "cod" && !order.alreadyPaid && !order.collectionRecorded) throw conflict("Record the payment before delivering", { reason: "collection_required" });
      if (order.otpRequired && !opts.skipOtp) {
        if (!input.otp) throw validation("The delivery code is required", { field: "otp" });
        const checked = await orders.verifyDeliveryOtp(orderId, input.otp);
        if (!checked.valid) {
          if (checked.locked) throw new AppError("OTP_LOCKED", "Too many wrong codes. Ask dispatch for help.", { attemptsLeft: 0 });
          throw new AppError("OTP_MISMATCH", "That code is not right", { attemptsLeft: checked.attemptsLeft });
        }
      }
      const deliveredAt = input.deliveredAt ?? at;
      const details = { deliveredAt: deliveredAt.toISOString(), location: input.location, accuracyM: input.accuracyM, ...(opts.offline && { offline: true }) };
      const moved = await orders.transition(orderId, "DELIVERED", by(rider), details);
      if (!moved.ok) throw transitionError(moved, "DELIVERED");
      await finish(assignment, "delivered", null);

      // One code delivers every order of the same checkout that this rider carried to the same door.
      for (const sibling of await orders.childrenOf(order.groupId)) {
        if (sibling.id === orderId || sibling.status !== "ARRIVED") continue;
        const theirs = await store.liveForOrder(sibling.id);
        if (!theirs || theirs.riderId !== rider.id) continue;
        if (sibling.paymentMethod === "cod" && !sibling.alreadyPaid && !sibling.collectionRecorded) continue;
        if ((await orders.transition(sibling.id, "DELIVERED", by(rider), details)).ok) await finish(theirs, "delivered", null);
      }
      return { id: orderId, status: moved.order.status, deliveredAt: deliveredAt.toISOString(), groupStatus: (await orders.get(orderId))?.groupStatus ?? moved.order.groupStatus };
    },

    async failed(rider: Rider, orderId: string, input: { reason: FailReason; note: string | null; photoMediaId: string | null }) {
      const { assignment, order } = await owned(rider, orderId);
      if (order.status !== "OUT_FOR_DELIVERY" && order.status !== "ARRIVED") throw invalidTransition(order, "Only an order on its way or at the door can fail");
      if (input.photoMediaId) await evidence.claim({ mediaId: input.photoMediaId, userId: rider.userId, orderId });
      const moved = await orders.transition(orderId, "FAILED_DELIVERY", by(rider), { reason: input.reason, note: input.note, photoMediaId: input.photoMediaId });
      if (!moved.ok) {
        if (input.photoMediaId) await evidence.unclaim(input.photoMediaId, orderId).catch(() => undefined);
        throw transitionError(moved, "FAILED_DELIVERY");
      }
      await finish(assignment, "failed", input.reason);
      return orderView(moved.order, await store.batchOfOrder(orderId));
    },

    /** Tells dispatch about trouble. Nothing is unassigned: the admin decides. */
    async problem(rider: Rider, orderId: string, input: { type: ProblemType; note: string | null }) {
      const { assignment } = await owned(rider, orderId);
      await store.insertProblem({ id: newId(), orderId, riderId: rider.id, assignmentId: assignment.id, type: input.type, note: input.note, createdAt: now() });
    },

    async history(rider: Rider, query: { from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined }) {
      const rows = await store.completedFor(rider.id, { from: query.from, to: query.to }, query.cursor, query.limit + 1);
      const page = rows.slice(0, query.limit);
      const orderList = new Map((await orders.getMany(page.map(a => a.orderId))).map(o => [o.id, o]));
      return {
        items: page.flatMap(a => {
          const o = orderList.get(a.orderId);
          return o ? [{
            orderId: o.id, orderNo: o.orderNo, status: a.outcome === "delivered" ? "DELIVERED" : "FAILED_DELIVERY", deliveredAt: a.outcome === "delivered" ? (o.deliveredAt ?? a.completedAt)?.toISOString() ?? null : null,
            amountDue: o.amountDue, collectionMethod: o.collectionMethod, deliveredOffline: o.deliveredOffline,
          }] : [];
        }),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
        deliveredToday: await store.countDeliveredSince(rider.id, startOfIstDay(now())),
      };
    },

    /** How this rider stands with an order: working it now, finished it, handed it on, or never had it. */
    async relation(riderId: string, orderId: string): Promise<"live" | "finished" | "ended" | "none"> {
      const mine = await store.forOrderAndRider(orderId, riderId);
      if (mine.some(a => a.live)) return "live";
      if (mine.some(a => a.status === "completed")) return "finished";
      return mine.length > 0 ? "ended" : "none";
    },
    /** The rider who last had the order, whether or not they still do. */
    async riderOfOrder(orderId: string): Promise<string | null> { return (await store.latestForOrder(orderId))?.riderId ?? null; },
    /** The orders a rider is working now. */
    async liveOrderIds(riderId: string): Promise<string[]> { return (await store.liveForRider(riderId)).map(a => a.orderId); },
    deliveredToday(riderId: string): Promise<number> { return store.countDeliveredSince(riderId, startOfIstDay(now())); },
    /** The admin rejected an offline delivery: the finished job becomes a failed one so it can be resolved like any other. */
    async markDeliveryRejected(orderId: string, note: string | null): Promise<void> {
      const last = await store.latestForOrder(orderId);
      if (last?.outcome === "delivered") await store.updateAssignment(last.id, { outcome: "failed", endReason: note ?? "delivery_rejected", failedResolvedAt: null, updatedAt: now() }, { live: false });
    },

    /** How many of the rider's orders are already out of the warehouse (for ending a shift by force). */
    async pickedUpCount(riderId: string) { return (await store.withPickup(riderId)).length; },

  };
}

export type FieldService = ReturnType<typeof createFieldService>;
