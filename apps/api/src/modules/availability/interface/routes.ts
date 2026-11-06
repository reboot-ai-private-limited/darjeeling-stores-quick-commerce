import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { AppError, guarded, parse, pathId, sendData, sendError, type AuthResolver } from "../../catalog/catalog.public.js";
import type { NotifyService } from "../application/notify-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");

export const subscribeBody = z.object({
  zoneId: id, productId: id, variantId: id.nullable().optional(),
  channels: z.array(z.enum(["push", "whatsapp"])).min(1).max(2).default(["push", "whatsapp"]),
}).strict().transform(body => ({ ...body, variantId: body.variantId ?? null, channels: [...new Set(body.channels)] }));
export const demandQuery = z.object({ zoneId: id.optional(), warehouseId: id.optional() });

/** Who the logged-in customer is. Supplied by the identity module's session; until then nobody is logged in. */
export type CustomerResolver = (req: Request) => Promise<{ userId: string } | undefined> | { userId: string } | undefined;
export const noCustomers: CustomerResolver = () => undefined;

function asCustomer(resolve: CustomerResolver, handler: (customer: { userId: string }, req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return async (req, res, next) => {
    try {
      const customer = await resolve(req);
      if (!customer) return sendError(res, new AppError("UNAUTHORIZED", "Authentication required"));
      await handler(customer, req, res);
    } catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}

/** The 4 endpoints of docs/api/F07-notify-me.md. Paths are relative to the API prefix. */
export function notifyRoutes(service: NotifyService, customer: CustomerResolver, staff: AuthResolver): Route[] {
  return [
    { method: "post", path: "/notify-me", handler: asCustomer(customer, async (who, req, res) =>
      sendData(res, await service.subscribe(who.userId, parse(subscribeBody, req.body)), 201)) },
    { method: "get", path: "/notify-me", handler: asCustomer(customer, async (who, _req, res) => {
      const data = await service.listMine(who.userId);
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "delete", path: "/notify-me/:id", handler: asCustomer(customer, async (who, req, res) => {
      await service.cancel(who.userId, pathId(req, "id", "Subscription"));
      sendData(res, { ok: true });
    }) },
    { method: "get", path: "/admin/notify-demand", handler: guarded(staff, "notify_demand:view", async (ctx, req, res) => {
      const data = await service.demand(ctx, parse(demandQuery, req.query));
      sendData(res, data, 200, { count: data.length });
    }) },
  ];
}
