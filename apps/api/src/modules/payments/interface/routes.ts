import type { Request } from "express";
import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, guarded, open, parse, pathId, sendData, type AuthResolver, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { PaymentService } from "../application/payment-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
export const verifyBody = z.object({
  groupId: id, razorpayOrderId: z.string().trim().min(1).max(64), razorpayPaymentId: z.string().trim().min(1).max(64), razorpaySignature: z.string().trim().min(1).max(200),
}).strict();
export const retryBody = z.object({ groupId: id }).strict();
export const payLinkBody = z.object({ method: z.enum(["upi_intent", "link"]).default("link") }).strict();
export const listQuery = z.object({
  status: z.enum(["created", "authorized", "captured", "failed", "cod_pending", "cod_collected"]).optional(), method: z.enum(["razorpay", "cod", "razorpay_link"]).optional(),
  groupNo: z.string().trim().min(1).max(30).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional(),
});
export const reconcileBody = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
export const reconciliationQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const markPaidBody = z.object({ razorpayPaymentId: z.string().trim().min(1).max(64), note: z.string().trim().max(500).nullish() }).strict();

/** The 10 endpoints of docs/api/F15-payments.md. Paths are relative to the API prefix. */
export function paymentRoutes(service: PaymentService, staff: AuthResolver, customer: CustomerResolver): Route[] {
  const mine = (h: Parameters<typeof customerGuarded>[1]) => customerGuarded(customer, h);
  const view = (h: Parameters<typeof guarded>[2]) => guarded(staff, "payments:view", h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(staff, "payments:manage", h);
  return [
    { method: "post", path: "/payments/verify", handler: mine(async (who, req, res) => sendData(res, await service.verify(who.userId, parse(verifyBody, req.body)))) },
    { method: "post", path: "/payments/retry", handler: mine(async (who, req, res) => sendData(res, await service.retry(who.userId, parse(retryBody, req.body).groupId), 201)) },
    { method: "get", path: "/order-groups/:id/payment", handler: mine(async (who, req, res) => sendData(res, await service.status(who.userId, pathId(req, "id", "Order group")))) },
    { method: "post", path: "/orders/:id/pay-link", handler: mine(async (who, req, res) => sendData(res, await service.payLink(who.userId, pathId(req, "id", "Order"), parse(payLinkBody, req.body ?? {}).method), 201)) },
    // Razorpay calls this one. It always answers 200 once the signature is good, so Razorpay does not keep retrying a handled event.
    { method: "post", path: "/webhooks/razorpay", handler: open(async (req, res) => {
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const result = await service.webhook(raw, req.get("X-Razorpay-Signature") ?? undefined, req.get("X-Razorpay-Event-Id") ?? undefined);
      res.status(200).json({ data: result });
    }) },
    { method: "get", path: "/admin/payments/reconciliation", handler: view(async (ctx, req, res) => sendData(res, await service.latestReconciliation(ctx, parse(reconciliationQuery, req.query).date))) },
    { method: "post", path: "/admin/payments/reconcile", handler: manage(async (ctx, req, res) => sendData(res, await service.reconcile(ctx, parse(reconcileBody, req.body ?? {}).date), 202)) },
    { method: "get", path: "/admin/payments", handler: view(async (ctx, req, res) => {
      const result = await service.list(ctx, parse(listQuery, req.query));
      sendData(res, result.data, 200, { nextCursor: result.nextCursor });
    }) },
    { method: "get", path: "/admin/payments/:id", handler: view(async (ctx, req, res) => sendData(res, await service.get(ctx, pathId(req, "id", "Payment")))) },
    { method: "post", path: "/admin/payments/:id/mark-paid", handler: manage(async (ctx, req, res) => {
      const body = parse(markPaidBody, req.body);
      sendData(res, await service.markPaid(ctx, pathId(req, "id", "Payment"), { razorpayPaymentId: body.razorpayPaymentId, note: body.note ?? null }));
    }) },
  ];
}
