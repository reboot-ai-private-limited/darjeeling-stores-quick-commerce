import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { AppError, forbidden, guarded, parse, pathId, sendData, sendError, type AuthResolver } from "../../catalog/catalog.public.js";
import type { RiderService } from "../application/rider-service.js";
import type { Rider } from "../domain/rider.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const phone = z.string().transform(value => value.replace(/[\s-]/g, "")).transform(value => (/^\d{10}$/.test(value) ? `+91${value}` : value)).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format such as +919876543210"));
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
const name = z.string().trim().min(1).max(80);

export const shiftStartBody = z.object({ warehouseId: id, location: point, accuracyM: z.number().min(0).max(100_000).nullish() }).strict();
export const switchBody = z.object({ warehouseId: id }).strict();
export const photoBody = z.object({ mediaId: id }).strict();
export const riderCreate = z.object({
  name, phone, zoneId: id, warehouseIds: z.array(id).min(1).max(20), vehicle: z.string().trim().min(1).max(40).nullish(),
}).strict();
export const riderUpdate = z.object({
  name: name.optional(), zoneId: id.optional(), warehouseIds: z.array(id).min(1).max(20).optional(), vehicle: z.string().trim().min(1).max(40).nullable().optional(),
  photoMediaId: id.nullable().optional(),
}).strict();
export const forceBody = z.object({ force: z.boolean().default(false) }).strict();
export const ridersQuery = z.object({
  zoneId: id.optional(), warehouseId: id.optional(), status: z.enum(["offline", "online", "on_break", "deactivated"]).optional(), q: z.string().trim().min(1).max(60).optional(),
});
export const shiftsQuery = z.object({
  riderId: id.optional(), warehouseId: id.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().regex(/^[a-f0-9]{24}$/).optional(),
});

/** Who the signed-in rider's login is. Supplied by the identity module's session; until then nobody is logged in. */
export type RiderResolver = (req: Request) => Promise<{ userId: string } | undefined> | { userId: string } | undefined;
export const noRiders: RiderResolver = () => undefined;

/** Answers 401 without a login and 403 for a login that is not an active rider; otherwise runs the handler with the rider. */
export function riderGuarded(
  resolve: RiderResolver, find: (userId: string) => Promise<Rider | null>,
  handler: (rider: Rider, req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const who = await resolve(req);
      if (!who) return sendError(res, new AppError("UNAUTHORIZED", "Authentication required"));
      const rider = await find(who.userId);
      if (!rider) return sendError(res, forbidden("This login is not a registered rider"));
      if (!rider.isActive) return sendError(res, forbidden("This rider account is deactivated"));
      await handler(rider, req, res);
    } catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}

/** The 9 admin endpoints of docs/api/F19-rider-app.md and the rider's own profile and shift calls. Paths are relative to the API prefix. */
export function riderRoutes(service: RiderService, rider: RiderResolver, staff: AuthResolver): Route[] {
  const mine = (h: Parameters<typeof riderGuarded>[2]) => riderGuarded(rider, service.forUser, h);
  const view = (h: Parameters<typeof guarded>[2]) => guarded(staff, "riders:view", h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(staff, "riders:manage", h);
  return [
    { method: "get", path: "/rider/me", handler: mine(async (r, _req, res) => sendData(res, await service.me(r))) },
    { method: "post", path: "/rider/shift/start", handler: mine(async (r, req, res) => {
      const body = parse(shiftStartBody, req.body);
      sendData(res, await service.startShift(r, { warehouseId: body.warehouseId, location: body.location, accuracyM: body.accuracyM ?? null }));
    }) },
    { method: "post", path: "/rider/shift/switch-warehouse", handler: mine(async (r, req, res) => sendData(res, await service.switchWarehouse(r, parse(switchBody, req.body).warehouseId))) },
    { method: "post", path: "/rider/shift/break", handler: mine(async (r, _req, res) => sendData(res, await service.startBreak(r))) },
    { method: "post", path: "/rider/shift/resume", handler: mine(async (r, _req, res) => sendData(res, await service.resume(r))) },
    { method: "post", path: "/rider/shift/end", handler: mine(async (r, _req, res) => sendData(res, await service.endShift(r))) },
    { method: "put", path: "/rider/profile/photo", handler: mine(async (r, req, res) => {
      await service.setPhoto(r, parse(photoBody, req.body).mediaId);
      sendData(res, { ok: true });
    }) },

    { method: "get", path: "/admin/riders", handler: view(async (ctx, req, res) => {
      const data = await service.list(ctx, parse(ridersQuery, req.query));
      sendData(res, data, 200, { count: data.length });
    }) },
    { method: "post", path: "/admin/riders", handler: manage(async (ctx, req, res) => {
      const body = parse(riderCreate, req.body);
      sendData(res, await service.create(ctx, { ...body, vehicle: body.vehicle ?? null }), 201);
    }) },
    { method: "get", path: "/admin/riders/:id", handler: view(async (ctx, req, res) => sendData(res, await service.get(ctx, pathId(req, "id", "Rider")))) },
    { method: "put", path: "/admin/riders/:id", handler: manage(async (ctx, req, res) => sendData(res, await service.update(ctx, pathId(req, "id", "Rider"), parse(riderUpdate, req.body)))) },
    { method: "post", path: "/admin/riders/:id/deactivate", handler: manage(async (ctx, req, res) => sendData(res, await service.deactivate(ctx, pathId(req, "id", "Rider")))) },
    { method: "post", path: "/admin/riders/:id/reactivate", handler: manage(async (ctx, req, res) => sendData(res, await service.reactivate(ctx, pathId(req, "id", "Rider")))) },
    { method: "post", path: "/admin/riders/:id/force-offline", handler: manage(async (ctx, req, res) =>
      sendData(res, await service.forceOffline(ctx, pathId(req, "id", "Rider"), parse(forceBody, req.body ?? {}).force))) },
    { method: "get", path: "/admin/riders/:id/shifts", handler: view(async (ctx, req, res) => {
      const q = parse(shiftsQuery, req.query);
      const page = await service.shiftsOf(ctx, pathId(req, "id", "Rider"), q);
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "get", path: "/admin/shifts", handler: view(async (ctx, req, res) => {
      const page = await service.shifts(ctx, parse(shiftsQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
  ];
}
