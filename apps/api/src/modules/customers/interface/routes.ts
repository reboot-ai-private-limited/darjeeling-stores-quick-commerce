import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, pathId, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import { toCsv } from "../../reports/reports.public.js";
import type { CustomerService } from "../application/customer-service.js";
import { STATUSES, type CustomerStatus } from "../domain/customer.js";

const flag = z.enum(["true", "false"]).transform(v => v === "true");
const listQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(), status: z.enum(STATUSES as unknown as [string, ...string[]]).optional(), codAllowed: flag.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(64).optional(),
}).strict();
export const editBody = z.object({ codAllowed: z.boolean().optional(), note: z.string().trim().min(1).max(500).optional() }).strict()
  .refine(v => v.codAllowed !== undefined || v.note !== undefined, "Send codAllowed, note or both");
export const blockBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/** The customer endpoints of F25. `/export` is registered before `/:id`. */
export function customerRoutes(service: CustomerService, auth: AuthResolver): Route[] {
  const view = (h: Parameters<typeof guarded>[2]) => guarded(auth, "customers:view", h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(auth, "customers:manage", h);
  return [
    { method: "get", path: "/admin/customers", handler: view(async (ctx, req, res) => {
      const query = parse(listQuery, req.query);
      const page = await service.list(ctx, { ...query, status: query.status as CustomerStatus | undefined });
      sendData(res, page.data, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "get", path: "/admin/customers/export", handler: manage(async (ctx, _req, res) => {
      const table = await service.exportRows(ctx);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="customers.csv"');
      res.status(200).send(toCsv(table));
    }) },
    { method: "get", path: "/admin/customers/:id", handler: view(async (ctx, req, res) => sendData(res, await service.get(ctx, pathId(req, "id", "Customer")))) },
    { method: "put", path: "/admin/customers/:id", handler: manage(async (ctx, req, res) => sendData(res, await service.edit(ctx, pathId(req, "id", "Customer"), parse(editBody, req.body)))) },
    { method: "post", path: "/admin/customers/:id/block", handler: manage(async (ctx, req, res) => sendData(res, await service.block(ctx, pathId(req, "id", "Customer"), parse(blockBody, req.body).reason))) },
    { method: "post", path: "/admin/customers/:id/unblock", handler: manage(async (ctx, req, res) => sendData(res, await service.unblock(ctx, pathId(req, "id", "Customer")))) },
    { method: "post", path: "/admin/customers/:id/finalise-deletion", handler: manage(async (ctx, req, res) => sendData(res, await service.finaliseDeletion(ctx, pathId(req, "id", "Customer")))) },
  ];
}
