import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, pathId, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import { riderGuarded, type RiderResolver, type RiderService } from "../../riders/riders.public.js";
import type { SyncEvent, SyncService } from "../application/sync-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
const gps = point.extend({ accuracyM: z.number().min(0).max(100_000).nullish() }).strict();
const note = z.string().trim().max(500);
const amount = z.number().int().min(1).max(100_000_000);
const otp = z.string().trim().regex(/^\d{4,8}$/, "Use the digits the customer reads out");

const base = {
  clientEventId: z.string().trim().min(8).max(64), seq: z.number().int().min(0).max(2_000_000_000),
  orderId: id.nullish(), deviceTime: z.coerce.date(), gps: gps.nullish(),
};
const event = <T extends string, P extends z.ZodType>(type: readonly [T, ...T[]], payload: P) => z.object({ ...base, type: z.enum(type), payload }).strict();

const syncEvent = z.union([
  event(["ack_assignment"], z.object({ assignmentId: id }).strict()),
  event(["picked_up"], z.object({ checklist: z.object({ itemsVerified: z.boolean(), bagCount: z.number().int().min(0).max(50).nullish() }).strict() }).strict()),
  event(["start_ride", "arrived"], z.object({}).strict()),
  event(["deliver", "deliver_offline"], z.object({ otp: otp.nullish(), otpCheckedLocally: z.boolean().optional() }).strict()),
  event(["collect_cash"], z.object({ amount }).strict()),
  event(["collect_upi_unverified"], z.object({ amount, note: note.nullish() }).strict()),
  event(["failed_delivery"], z.object({ reason: z.enum(["customer_unreachable", "wrong_address", "refused", "road_blocked", "weather", "other"]), note: note.nullish(), photoMediaId: id.nullish() }).strict()),
  event(["location_batch"], z.object({
    points: z.array(z.object({ location: point, accuracyM: z.number().min(0).max(100_000).nullish(), speedKmh: z.number().min(0).max(300).nullish(), at: z.coerce.date() }).strict()).min(1).max(200),
  }).strict()),
]).superRefine((e, ctx) => {
  const needsOrder = e.type !== "ack_assignment" && e.type !== "location_batch";
  if (needsOrder && !e.orderId) ctx.addIssue({ code: "custom", path: ["orderId"], message: "orderId is required for this event" });
});
export const syncBody = z.object({ events: z.array(syncEvent).min(1).max(50) }).strict()
  .refine(b => new Set(b.events.map(e => e.clientEventId)).size === b.events.length, { path: ["events"], message: "clientEventId must be different for every event" });

export const reviewsQuery = z.object({
  warehouseId: id.optional(), status: z.enum(["open", "resolved"]).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional(),
});
export const reviewResolveBody = z.object({ outcome: z.enum(["accepted", "rejected"]), note: note.nullish() }).strict();

/** The 4 endpoints of docs/api/F21-offline-and-low-network.md. Paths are relative to the API prefix. */
export function syncRoutes(service: SyncService, riders: Pick<RiderService, "forUser">, rider: RiderResolver, staff: AuthResolver): Route[] {
  const mine = (h: Parameters<typeof riderGuarded>[2]) => riderGuarded(rider, riders.forUser, h);
  const orders = (h: Parameters<typeof guarded>[2]) => guarded(staff, "orders:manage", h);
  return [
    { method: "get", path: "/rider/orders/:id/bundle", handler: mine(async (r, req, res) => sendData(res, await service.bundle(r, pathId(req, "id", "Order")))) },
    { method: "post", path: "/rider/sync", handler: mine(async (r, req, res) => {
      const body = parse(syncBody, req.body);
      sendData(res, await service.sync(r, body.events as unknown as SyncEvent[]));
    }) },
    { method: "get", path: "/admin/offline-reviews", handler: orders(async (ctx, req, res) => {
      const result = await service.reviews(ctx, parse(reviewsQuery, req.query));
      sendData(res, result.data, 200, { openCount: result.openCount, nextCursor: result.nextCursor });
    }) },
    { method: "post", path: "/admin/offline-reviews/:orderId/resolve", handler: orders(async (ctx, req, res) => {
      const body = parse(reviewResolveBody, req.body);
      sendData(res, await service.resolveReview(ctx, pathId(req, "orderId", "Offline delivery review"), { outcome: body.outcome, note: body.note ?? null }));
    }) },
  ];
}
