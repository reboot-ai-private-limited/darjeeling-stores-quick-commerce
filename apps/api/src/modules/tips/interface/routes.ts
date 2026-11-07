import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import { riderGuarded, type Rider, type RiderResolver } from "../../riders/riders.public.js";
import type { TipService } from "../application/tip-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const mineQuery = z.object({ from: day.optional(), to: day.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();
const summaryQuery = z.object({ from: day.optional(), to: day.optional(), warehouseId: id.optional(), riderId: id.optional() }).strict();
const ordersQuery = summaryQuery.extend({ status: z.enum(["owed", "paid"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();
export const payBody = z.object({
  riderId: id, orderIds: z.array(id).min(1).max(500).optional(), upTo: day.optional(), note: z.string().trim().min(1).max(200).nullish(),
}).strict();

/** The rider tip endpoints. `/admin/rider-tips/orders` and `/pay` are fixed paths, so there is no `/:id` to clash with. */
export function tipRoutes(service: TipService, rider: RiderResolver, findRider: (userId: string) => Promise<Rider | null>, staff: AuthResolver): Route[] {
  const mine = (h: Parameters<typeof riderGuarded>[2]) => riderGuarded(rider, findRider, h);
  const view = (h: Parameters<typeof guarded>[2]) => guarded(staff, "riders:view", h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(staff, "cash:manage", h);
  return [
    { method: "get", path: "/rider/tips", handler: mine(async (r, req, res) => sendData(res, await service.mine(r.id, parse(mineQuery, req.query)))) },
    { method: "get", path: "/admin/rider-tips", handler: view(async (ctx, req, res) => sendData(res, await service.summary(ctx, parse(summaryQuery, req.query)))) },
    { method: "get", path: "/admin/rider-tips/orders", handler: view(async (ctx, req, res) => sendData(res, await service.orders(ctx, parse(ordersQuery, req.query)))) },
    { method: "post", path: "/admin/rider-tips/pay", handler: manage(async (ctx, req, res) => sendData(res, await service.pay(ctx, parse(payBody, req.body)))) },
  ];
}
