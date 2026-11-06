import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, guarded, parse, pathId, sendData, validation, type AuthResolver, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { AdminOrderService } from "../application/admin-service.js";
import type { OrderService } from "../application/order-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const STATUSES = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED", "FAILED_DELIVERY", "CANCELLED"] as const;
const status = z.enum(STATUSES);
const statusList = z.string().transform(v => v.split(",").map(s => s.trim()).filter(Boolean)).pipe(z.array(status).min(1).max(12));
const note = z.string().trim().max(500);

export const placeBody = z.object({
  quoteId: id, paymentMethod: z.enum(["cod", "online"]).default("cod"), deliveryNotes: note.nullish(), voiceMediaId: id.nullish(), housePhotoMediaId: id.nullish(),
}).strict();
export const myOrdersQuery = z.object({ status: z.enum(["active", "past"]).optional(), limit: z.coerce.number().int().min(1).max(50).default(20), cursor: id.optional() });
export const adminListQuery = z.object({
  warehouseId: id.optional(), status: statusList.optional(), paymentStatus: z.string().trim().max(30).optional(), riderId: id.optional(), q: z.string().trim().min(1).max(60).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), isPreOrder: z.enum(["true", "false"]).transform(v => v === "true").optional(),
  flagged: z.enum(["true", "false"]).transform(v => v === "true").optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional(),
});
export const changesQuery = z.object({ since: z.string().max(20).optional(), warehouseId: id.optional(), statuses: statusList.optional() });
export const unavailableBody = z.object({ reason: z.string().trim().min(1).max(200), availableQty: z.number().int().min(0).max(1000).optional() }).strict();
export const quantityBody = z.object({ qty: z.number().int().min(0).max(1000) }).strict();
export const cancelBody = z.object({ reason: note.min(1) }).strict();
export const forceBody = z.object({ to: status, reason: note.min(1) }).strict();
export const noteBody = z.object({ text: note.min(1) }).strict();
export const printQuery = z.object({ type: z.enum(["bill", "slip"]).default("bill") });

const itemIndex = (raw: string | string[] | undefined) => {
  const n = Number(raw);
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw) || !Number.isInteger(n)) throw validation("Invalid item index", { field: "itemIndex" });
  return n;
};

/** The 5 customer endpoints of docs/api/F13-order-placement-and-split-orders.md and the 13 admin endpoints of F14. Paths are relative to the API prefix. */
export function orderRoutes(orders: OrderService, admin: AdminOrderService, staff: AuthResolver, customer: CustomerResolver): Route[] {
  const mine = (h: Parameters<typeof customerGuarded>[1]) => customerGuarded(customer, h);
  const view = (h: Parameters<typeof guarded>[2]) => guarded(staff, "orders:view", h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(staff, "orders:manage", h);
  return [
    { method: "post", path: "/orders", handler: mine(async (who, req, res) => {
      const body = parse(placeBody, req.body);
      const key = req.get("Idempotency-Key") ?? "";
      sendData(res, await orders.place(who.userId, body, key.trim()), 201);
    }) },
    { method: "get", path: "/orders", handler: mine(async (who, req, res) => {
      const result = await orders.myOrders(who.userId, parse(myOrdersQuery, req.query));
      sendData(res, result.data, 200, { nextCursor: result.nextCursor });
    }) },
    { method: "get", path: "/order-groups/:id", handler: mine(async (who, req, res) => sendData(res, await orders.myGroup(who.userId, pathId(req, "id", "Order group")))) },
    { method: "get", path: "/orders/:id", handler: mine(async (who, req, res) => sendData(res, await orders.myOrder(who.userId, pathId(req, "id", "Order")))) },
    { method: "post", path: "/orders/:id/reorder", handler: mine(async (who, req, res) => sendData(res, await orders.reorder(who.userId, pathId(req, "id", "Order")))) },

    // `/admin/orders/changes` is registered before `/admin/orders/:id`, or "changes" would be read as an id.
    { method: "get", path: "/admin/orders/changes", handler: view(async (ctx, req, res) => {
      const q = parse(changesQuery, req.query);
      const result = await admin.changes(ctx, q);
      sendData(res, result.data, 200, { cursor: result.cursor, newCount: result.newCount });
    }) },
    { method: "get", path: "/admin/orders", handler: view(async (ctx, req, res) => {
      const q = parse(adminListQuery, req.query);
      const result = await admin.list(ctx, { ...q, statuses: q.status });
      sendData(res, result.data, 200, { nextCursor: result.nextCursor });
    }) },
    { method: "get", path: "/admin/orders/:id", handler: view(async (ctx, req, res) => sendData(res, await admin.get(ctx, pathId(req, "id", "Order")))) },
    { method: "get", path: "/admin/order-groups/:id", handler: view(async (ctx, req, res) => sendData(res, await admin.getGroup(ctx, pathId(req, "id", "Order group")))) },
    { method: "post", path: "/admin/orders/:id/confirm", handler: manage(async (ctx, req, res) => sendData(res, await admin.confirm(ctx, pathId(req, "id", "Order")))) },
    { method: "post", path: "/admin/orders/:id/start-packing", handler: manage(async (ctx, req, res) => sendData(res, await admin.startPacking(ctx, pathId(req, "id", "Order")))) },
    { method: "post", path: "/admin/orders/:id/complete-packing", handler: manage(async (ctx, req, res) => sendData(res, await admin.completePacking(ctx, pathId(req, "id", "Order")))) },
    { method: "post", path: "/admin/orders/:id/items/:itemIndex/unavailable", handler: manage(async (ctx, req, res) =>
      sendData(res, await admin.unavailable(ctx, pathId(req, "id", "Order"), itemIndex(req.params.itemIndex), parse(unavailableBody, req.body)))) },
    { method: "put", path: "/admin/orders/:id/items/:itemIndex", handler: manage(async (ctx, req, res) =>
      sendData(res, await admin.editQuantity(ctx, pathId(req, "id", "Order"), itemIndex(req.params.itemIndex), parse(quantityBody, req.body).qty))) },
    { method: "post", path: "/admin/orders/:id/cancel", handler: manage(async (ctx, req, res) => sendData(res, await admin.cancel(ctx, pathId(req, "id", "Order"), parse(cancelBody, req.body).reason))) },
    { method: "post", path: "/admin/orders/:id/force-status", handler: manage(async (ctx, req, res) => {
      const body = parse(forceBody, req.body);
      sendData(res, await admin.forceStatus(ctx, pathId(req, "id", "Order"), body.to, body.reason));
    }) },
    { method: "post", path: "/admin/orders/:id/notes", handler: manage(async (ctx, req, res) => sendData(res, await admin.addNote(ctx, pathId(req, "id", "Order"), parse(noteBody, req.body).text), 201)) },
    { method: "get", path: "/admin/orders/:id/print", handler: view(async (ctx, req, res) => {
      const html = await admin.print(ctx, pathId(req, "id", "Order"), parse(printQuery, req.query).type);
      res.status(200).type("text/html; charset=utf-8").send(html);
    }) },
  ];
}
