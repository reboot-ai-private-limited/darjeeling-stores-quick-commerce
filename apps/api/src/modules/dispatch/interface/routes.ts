import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, pathId, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import { riderGuarded, type RiderResolver, type RiderService } from "../../riders/riders.public.js";
import type { AssignService } from "../application/assign-service.js";
import type { BatchService } from "../application/batch-service.js";
import type { BoardService } from "../application/board-service.js";
import type { FieldService } from "../application/field-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
const note = z.string().trim().max(500);
const stop = z.object({ type: z.enum(["pickup", "drop"]), warehouseId: id.optional(), orderIds: z.array(id).min(1).max(5) }).strict();

export const suggestionsQuery = z.object({ orderId: id });
export const assignBody = z.object({ riderId: id, batchId: id.nullish() }).strict();
export const unassignBody = z.object({ reason: note.nullish() }).strict();
export const groupBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("same_rider"), riderId: id, pickupOrder: z.array(id).min(1).max(5).optional() }).strict(),
  z.object({ mode: z.literal("different_riders"), assignments: z.array(z.object({ orderId: id, riderId: id }).strict()).min(1).max(5) }).strict(),
]);
export const batchCreate = z.object({ riderId: id, orderIds: z.array(id).min(1).max(10), stops: z.array(stop).max(20).optional() }).strict();
export const batchUpdate = z.union([
  z.object({ stops: z.array(stop).min(1).max(20) }).strict(),
  z.object({ addOrderIds: z.array(id).max(10).optional(), removeOrderIds: z.array(id).max(10).optional() }).strict()
    .refine(b => (b.addOrderIds?.length ?? 0) + (b.removeOrderIds?.length ?? 0) > 0, "Send stops, addOrderIds or removeOrderIds"),
]);
export const batchesQuery = z.object({ status: z.enum(["planned", "active", "done", "cancelled"]).optional(), riderId: id.optional() });
export const handoverBody = z.object({ toRiderId: id, reason: note.min(1) }).strict();
export const resolveBody = z.object({ action: z.enum(["redispatch", "cancel_return"]), goodsCondition: z.enum(["good", "spoiled"]).optional(), note: note.nullish() }).strict();
export const assignmentsQuery = z.object({
  status: z.enum(["assigned", "acknowledged", "reassigned", "cancelled", "completed"]).optional(), riderId: id.optional(), warehouseId: id.optional(),
});
export const liveQuery = z.object({ zoneId: id.optional(), warehouseId: id.optional() });

export const sinceQuery = z.object({ since: z.string().max(40).optional() });
export const pickupBody = z.object({ checklist: z.object({ itemsVerified: z.boolean(), bagCount: z.number().int().min(0).max(50).nullish() }).strict() }).strict();
export const arrivedBody = z.object({ location: point.nullish() }).strict();
export const otpBody = z.object({ otp: z.string().trim().regex(/^\d{4,8}$/, "Use the digits the customer reads out") }).strict();
export const deliverBody = z.object({
  otp: z.string().trim().regex(/^\d{4,8}$/, "Use the digits the customer reads out").nullish(), deliveredAt: z.coerce.date().nullish(), location: point.nullish(), accuracyM: z.number().min(0).max(100_000).nullish(),
}).strict();
export const failedBody = z.object({
  reason: z.enum(["customer_unreachable", "wrong_address", "refused", "road_blocked", "weather", "other"]), note: note.nullish(), photoMediaId: id.nullish(),
}).strict();
export const problemBody = z.object({ type: z.enum(["vehicle_issue", "road_blocked", "customer_issue", "other"]), note: note.nullish() }).strict();
export const historyQuery = z.object({
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().regex(/^[a-f0-9]{24}$/).optional(),
});

/** The 13 endpoints of docs/api/F18-dispatch-and-assignment.md and the rider's own work calls in F19. Paths are relative to the API prefix. */
export function dispatchRoutes(
  services: { assign: AssignService; batches: BatchService; board: BoardService; field: FieldService }, riders: Pick<RiderService, "forUser">, rider: RiderResolver, staff: AuthResolver,
): Route[] {
  const { assign, batches, board, field } = services;
  const dispatch = (h: Parameters<typeof guarded>[2]) => guarded(staff, "dispatch:manage", h);
  const orderAdmin = (h: Parameters<typeof guarded>[2]) => guarded(staff, "orders:manage", h);
  const mine = (h: Parameters<typeof riderGuarded>[2]) => riderGuarded(rider, riders.forUser, h);
  const none = (req: { body?: unknown }) => req.body ?? {};
  return [
    // ---- admin: dispatch ----
    { method: "get", path: "/admin/dispatch/suggestions", handler: dispatch(async (ctx, req, res) => sendData(res, await assign.suggestions(ctx, parse(suggestionsQuery, req.query).orderId))) },
    { method: "post", path: "/admin/orders/:id/assign", handler: dispatch(async (ctx, req, res) => {
      const body = parse(assignBody, req.body);
      sendData(res, await assign.assign(ctx, pathId(req, "id", "Order"), { riderId: body.riderId, batchId: body.batchId ?? null }));
    }) },
    { method: "post", path: "/admin/orders/:id/unassign", handler: dispatch(async (ctx, req, res) => sendData(res, await assign.unassign(ctx, pathId(req, "id", "Order"), parse(unassignBody, none(req)).reason ?? null))) },
    { method: "post", path: "/admin/order-groups/:id/dispatch", handler: dispatch(async (ctx, req, res) => sendData(res, await assign.dispatchGroup(ctx, pathId(req, "id", "Order group"), parse(groupBody, req.body)))) },
    { method: "post", path: "/admin/batches", handler: dispatch(async (ctx, req, res) => sendData(res, await batches.create(ctx, parse(batchCreate, req.body)), 201)) },
    { method: "get", path: "/admin/batches", handler: dispatch(async (ctx, req, res) => sendData(res, await batches.list(ctx, parse(batchesQuery, req.query)))) },
    { method: "put", path: "/admin/batches/:id", handler: dispatch(async (ctx, req, res) => sendData(res, await batches.update(ctx, pathId(req, "id", "Batch"), parse(batchUpdate, req.body) as never))) },
    { method: "post", path: "/admin/batches/:id/cancel", handler: dispatch(async (ctx, req, res) => { await batches.cancel(ctx, pathId(req, "id", "Batch")); sendData(res, { ok: true }); }) },
    { method: "post", path: "/admin/orders/:id/handover", handler: dispatch(async (ctx, req, res) => sendData(res, await assign.handover(ctx, pathId(req, "id", "Order"), parse(handoverBody, req.body)))) },
    { method: "post", path: "/admin/orders/:id/failed/resolve", handler: orderAdmin(async (ctx, req, res) => sendData(res, await assign.resolveFailed(ctx, pathId(req, "id", "Order"), parse(resolveBody, req.body)))) },
    { method: "get", path: "/admin/assignments", handler: dispatch(async (ctx, req, res) => {
      const data = await board.assignments(ctx, parse(assignmentsQuery, req.query));
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "get", path: "/admin/dispatch/alerts", handler: dispatch(async (ctx, _req, res) => sendData(res, await board.alerts(ctx))) },
    { method: "get", path: "/admin/riders/live", handler: dispatch(async (ctx, req, res) => sendData(res, await board.live(ctx, parse(liveQuery, req.query)))) },

    // ---- the rider's work ----
    { method: "get", path: "/rider/assignments", handler: mine(async (r, req, res) => {
      const result = await field.assignments(r, parse(sinceQuery, req.query).since);
      sendData(res, result.data, 200, { cursor: result.cursor });
    }) },
    { method: "post", path: "/rider/assignments/:id/ack", handler: mine(async (r, req, res) => sendData(res, await field.ack(r, pathId(req, "id", "Assignment")))) },
    { method: "get", path: "/rider/orders/:id", handler: mine(async (r, req, res) => sendData(res, await field.order(r, pathId(req, "id", "Order")))) },
    { method: "post", path: "/rider/orders/:id/pickup", handler: mine(async (r, req, res) => {
      const body = parse(pickupBody, req.body);
      sendData(res, await field.pickup(r, pathId(req, "id", "Order"), { itemsVerified: body.checklist.itemsVerified, bagCount: body.checklist.bagCount ?? null }));
    }) },
    { method: "post", path: "/rider/orders/:id/start-ride", handler: mine(async (r, req, res) => sendData(res, await field.startRide(r, pathId(req, "id", "Order")))) },
    { method: "post", path: "/rider/orders/:id/arrived", handler: mine(async (r, req, res) => sendData(res, await field.arrived(r, pathId(req, "id", "Order"), parse(arrivedBody, none(req)).location ?? null))) },
    { method: "post", path: "/rider/orders/:id/verify-otp", handler: mine(async (r, req, res) => sendData(res, await field.verifyOtp(r, pathId(req, "id", "Order"), parse(otpBody, req.body).otp))) },
    { method: "post", path: "/rider/orders/:id/deliver", handler: mine(async (r, req, res) => {
      const body = parse(deliverBody, req.body);
      sendData(res, await field.deliver(r, pathId(req, "id", "Order"), { otp: body.otp ?? null, deliveredAt: body.deliveredAt ?? null, location: body.location ?? null, accuracyM: body.accuracyM ?? null }));
    }) },
    { method: "post", path: "/rider/orders/:id/failed", handler: mine(async (r, req, res) => {
      const body = parse(failedBody, req.body);
      sendData(res, await field.failed(r, pathId(req, "id", "Order"), { reason: body.reason, note: body.note ?? null, photoMediaId: body.photoMediaId ?? null }));
    }) },
    { method: "post", path: "/rider/orders/:id/problem", handler: mine(async (r, req, res) => {
      const body = parse(problemBody, req.body);
      await field.problem(r, pathId(req, "id", "Order"), { type: body.type, note: body.note ?? null });
      sendData(res, { ok: true });
    }) },
    { method: "get", path: "/rider/history", handler: mine(async (r, req, res) => {
      const page = await field.history(r, parse(historyQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor, deliveredToday: page.deliveredToday });
    }) },
  ];
}
