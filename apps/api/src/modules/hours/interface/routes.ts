import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, guarded, parse, pathId, sendData, type AuthResolver, type CustomerResolver } from "../../catalog/catalog.public.js";
import type { HoursService } from "../application/hours-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const slotsQuery = z.object({ zoneId: id });
export const hoursBody = z.object({
  hours: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), open: clock, close: clock }).strict()).min(1).max(14),
  lastOrderMinutesBeforeClose: z.number().int().min(0).max(240).optional(), afterHoursMode: z.enum(["closed", "pre_order"]).optional(),
}).strict();
export const preorderBody = z.object({
  enabled: z.boolean(), slots: z.array(z.object({ start: clock, end: clock, capacity: z.number().int().min(1).max(1000) }).strict()).max(12),
  cutoffMinutesBeforeSlot: z.number().int().min(0).max(720).optional(), packLeadMinutes: z.number().int().min(0).max(240).optional(),
}).strict();
export const pauseBody = z.object({
  scope: z.enum(["warehouse", "zone"]), id, message: z.string().trim().min(1).max(300).nullish(), until: z.coerce.date().nullish(),
}).strict();
export const resumeBody = z.object({ scope: z.enum(["warehouse", "zone"]), id }).strict();
export const preordersQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), warehouseId: id.optional(), slotStart: clock.optional(),
});

/** The F17 endpoints other than rain mode (which is with fees in F11). Paths are relative to the API prefix. */
export function hoursRoutes(service: HoursService, staff: AuthResolver, customer: CustomerResolver): Route[] {
  const warehouses = (h: Parameters<typeof guarded>[2]) => guarded(staff, "warehouses:manage", h);
  const ops = (h: Parameters<typeof guarded>[2]) => guarded(staff, "ops_mode:manage", h);
  const orders = (h: Parameters<typeof guarded>[2]) => guarded(staff, "orders:view", h);
  return [
    { method: "get", path: "/preorder/slots", handler: customerGuarded(customer, async (_who, req, res) => sendData(res, await service.slots(parse(slotsQuery, req.query).zoneId))) },
    { method: "put", path: "/admin/warehouses/:id/hours", handler: warehouses(async (ctx, req, res) => sendData(res, await service.setHours(ctx, pathId(req, "id", "Warehouse"), parse(hoursBody, req.body)))) },
    { method: "put", path: "/admin/warehouses/:id/preorder", handler: warehouses(async (ctx, req, res) => sendData(res, await service.setPreorder(ctx, pathId(req, "id", "Warehouse"), parse(preorderBody, req.body)))) },
    { method: "post", path: "/admin/ops/pause", handler: ops(async (ctx, req, res) => {
      const body = parse(pauseBody, req.body);
      sendData(res, await service.pause(ctx, { scope: body.scope, id: body.id, message: body.message ?? null, until: body.until ?? null }));
    }) },
    { method: "post", path: "/admin/ops/resume", handler: ops(async (ctx, req, res) => sendData(res, await service.resume(ctx, parse(resumeBody, req.body)))) },
    { method: "get", path: "/admin/preorders", handler: orders(async (ctx, req, res) => {
      const result = await service.listPreorders(ctx, parse(preordersQuery, req.query));
      sendData(res, result.data, 200, { count: result.count, bySlot: result.bySlot });
    }) },
  ];
}
