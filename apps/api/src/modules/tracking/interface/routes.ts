import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { customerGuarded, notFound, open, parse, pathId, sendData, type CustomerResolver } from "../../catalog/catalog.public.js";
import { riderGuarded, type RiderResolver, type RiderService } from "../../riders/riders.public.js";
import type { TrackingService } from "../application/tracking-service.js";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
export const pingBody = z.object({
  points: z.array(z.object({
    location: point, accuracyM: z.number().min(0).max(100_000).nullish(), speedKmh: z.number().min(0).max(300).nullish(), at: z.coerce.date(),
  }).strict()).min(1).max(200),
}).strict();

export const routeQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/** The 4 endpoints of docs/api/F20-eta-and-live-tracking.md. Paths are relative to the API prefix. */
export function trackingRoutes(service: TrackingService, riders: Pick<RiderService, "forUser">, rider: RiderResolver, customer: CustomerResolver): Route[] {
  return [
    { method: "get", path: "/orders/:id/tracking", handler: customerGuarded(customer, async (who, req, res) => sendData(res, await service.forCustomer(who.userId, pathId(req, "id", "Order")))) },
    // The page behind a WhatsApp link needs no login. Anything wrong with the link, including an expired one, is the same 404.
    { method: "get", path: "/track/:token", handler: open(async (req, res) => {
      const token = req.params.token;
      if (typeof token !== "string") throw notFound("Tracking link");
      sendData(res, await service.forToken(token));
    }) },
    // The road to the customer for the rider's in-app map. Only the order's own rider gets it.
    { method: "get", path: "/rider/orders/:id/route", handler: riderGuarded(rider, riders.forUser, async (r, req, res) => {
      const q = parse(routeQuery, req.query);
      sendData(res, await service.routeForRider(r, pathId(req, "id", "Order"), { lat: q.lat, lng: q.lng }));
    }) },
    { method: "post", path: "/rider/location", handler: riderGuarded(rider, riders.forUser, async (r, req, res) => {
      const body = parse(pingBody, req.body);
      sendData(res, await service.ingest(r, body.points));
    }) },
  ];
}
