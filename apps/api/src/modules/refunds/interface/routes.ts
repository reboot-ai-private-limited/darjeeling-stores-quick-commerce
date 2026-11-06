import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, guarded, parse, pathId, sendData, type AuthResolver, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { RefundService } from "../application/refund-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const note = z.string().trim().max(500);
const paise = z.number().int().min(1).max(100_000_000);

export const cancelBody = z.object({ reason: note.min(1) }).strict();
export const requestBody = z.object({
  reason: z.enum(["damaged_item", "missing_item", "other"]),
  items: z.array(z.object({ orderItemIndex: z.number().int().min(0).max(100), qty: z.number().int().min(1).max(1000) }).strict()).min(1).max(40),
  customerNote: note.nullish(), photoMediaIds: z.array(id).max(10).default([]),
}).strict();
export const myListQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: id.optional() });
export const adminListQuery = z.object({
  status: z.enum(["requested", "approved", "done", "rejected"]).optional(), source: z.enum(["auto", "customer_request", "admin"]).optional(), warehouseId: id.optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional(),
});
export const createBody = z.object({
  orderId: id, amount: paise, reason: z.enum(["cancelled", "item_unavailable", "late_payment", "damaged_item", "missing_item", "overpaid", "other"]).default("other"), note: note.nullish(),
}).strict();
export const rejectBody = z.object({ reason: note.min(1) }).strict();
export const doneBody = z.object({ method: z.enum(["razorpay_dashboard", "upi", "cash"]), reference: z.string().trim().min(1).max(100).nullish(), note: note.nullish() }).strict();

/** The 10 endpoints of docs/api/F16-cancellations-and-refunds.md. Paths are relative to the API prefix. */
export function refundRoutes(
  refunds: RefundService, cancelOwn: (userId: string, orderId: string, reason: string) => Promise<unknown>, staff: AuthResolver, customer: CustomerResolver,
): Route[] {
  const mine = (h: Parameters<typeof customerGuarded>[1]) => customerGuarded(customer, h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(staff, "refunds:manage", h);
  return [
    { method: "post", path: "/orders/:id/cancel", handler: mine(async (who, req, res) => sendData(res, await cancelOwn(who.userId, pathId(req, "id", "Order"), parse(cancelBody, req.body).reason))) },
    { method: "post", path: "/orders/:id/refund-request", handler: mine(async (who, req, res) => {
      const body = parse(requestBody, req.body);
      sendData(res, await refunds.request(who.userId, pathId(req, "id", "Order"), { ...body, customerNote: body.customerNote ?? null }), 201);
    }) },
    { method: "get", path: "/refunds", handler: mine(async (who, req, res) => {
      const result = await refunds.myRefunds(who.userId, parse(myListQuery, req.query));
      sendData(res, result.data, 200, { nextCursor: result.nextCursor });
    }) },
    { method: "get", path: "/refunds/:id", handler: mine(async (who, req, res) => sendData(res, await refunds.myRefund(who.userId, pathId(req, "id", "Refund")))) },
    { method: "get", path: "/admin/refunds", handler: manage(async (ctx, req, res) => {
      const result = await refunds.list(ctx, parse(adminListQuery, req.query));
      sendData(res, result.data, 200, { pendingCount: result.pendingCount, nextCursor: result.nextCursor });
    }) },
    { method: "post", path: "/admin/refunds", handler: manage(async (ctx, req, res) => {
      const body = parse(createBody, req.body);
      sendData(res, await refunds.create(ctx, { ...body, note: body.note ?? null }), 201);
    }) },
    { method: "get", path: "/admin/refunds/:id", handler: manage(async (ctx, req, res) => sendData(res, await refunds.get(ctx, pathId(req, "id", "Refund")))) },
    { method: "post", path: "/admin/refunds/:id/approve", handler: manage(async (ctx, req, res) => sendData(res, await refunds.approve(ctx, pathId(req, "id", "Refund")))) },
    { method: "post", path: "/admin/refunds/:id/reject", handler: manage(async (ctx, req, res) => sendData(res, await refunds.reject(ctx, pathId(req, "id", "Refund"), parse(rejectBody, req.body).reason))) },
    { method: "post", path: "/admin/refunds/:id/mark-done", handler: manage(async (ctx, req, res) => {
      const body = parse(doneBody, req.body);
      sendData(res, await refunds.markDone(ctx, pathId(req, "id", "Refund"), { method: body.method, reference: body.reference ?? null, note: body.note ?? null }));
    }) },
  ];
}
