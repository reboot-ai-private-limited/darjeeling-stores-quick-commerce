import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, pathId, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import { riderGuarded, type RiderResolver, type RiderService } from "../../riders/riders.public.js";
import type { CashService } from "../application/cash-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const paise = z.number().int().min(1).max(100_000_000);
const note = z.string().trim().max(500);

export const collectBody = z.object({ amount: paise, note: note.nullish(), collectedAt: z.coerce.date().nullish() }).strict();
export const ridersCashQuery = z.object({ warehouseId: id.optional(), zoneId: id.optional() });
export const ledgerQuery = z.object({
  riderId: id.optional(), warehouseId: id.optional(), type: z.enum(["collected", "deposit", "adjustment"]).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional(),
});
export const depositBody = z.object({ riderId: id, warehouseId: id, amount: paise, note: note.nullish() }).strict();
export const adjustBody = z.object({ riderId: id, warehouseId: id, amount: z.number().int().min(-100_000_000).max(100_000_000).refine(v => v !== 0, "An adjustment cannot be zero"), note: note.min(1) }).strict();
export const reconciliationQuery = z.object({
  type: z.enum(["upi_unverified", "overpaid", "unmatched"]).optional(), status: z.enum(["open", "resolved"]).optional(), warehouseId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: id.optional(),
});
export const resolveBody = z.object({
  outcome: z.enum(["verified", "not_received", "refund", "keep", "adjust"]), note: note.nullish(), bankReference: z.string().trim().min(1).max(100).nullish(),
  amount: z.number().int().min(-100_000_000).max(100_000_000).optional(),
}).strict();
export const fixBody = z.object({ method: z.enum(["cash", "upi"]), amount: paise, reason: note.min(1) }).strict();

/** The 10 endpoints of docs/api/F22-rider-cash-and-settlement.md. Paths are relative to the API prefix. */
export function cashRoutes(service: CashService, riders: Pick<RiderService, "forUser">, rider: RiderResolver, staff: AuthResolver): Route[] {
  const mine = (h: Parameters<typeof riderGuarded>[2]) => riderGuarded(rider, riders.forUser, h);
  const cash = (h: Parameters<typeof guarded>[2]) => guarded(staff, "cash:manage", h);
  const orders = (h: Parameters<typeof guarded>[2]) => guarded(staff, "orders:manage", h);
  return [
    { method: "get", path: "/rider/cash", handler: mine(async (r, _req, res) => sendData(res, await service.myCash(r))) },
    { method: "post", path: "/rider/orders/:id/collect-cash", handler: mine(async (r, req, res) => {
      const body = parse(collectBody, req.body);
      sendData(res, await service.collect(r, pathId(req, "id", "Order"), "cash", body));
    }) },
    { method: "post", path: "/rider/orders/:id/collect-upi", handler: mine(async (r, req, res) => {
      const body = parse(collectBody, req.body);
      sendData(res, await service.collect(r, pathId(req, "id", "Order"), "upi", body));
    }) },
    { method: "get", path: "/admin/cash/riders", handler: cash(async (ctx, req, res) => {
      const result = await service.ridersCash(ctx, parse(ridersCashQuery, req.query));
      sendData(res, result.data, 200, { totalInHand: result.totalInHand });
    }) },
    { method: "get", path: "/admin/cash/ledger", handler: cash(async (ctx, req, res) => {
      const result = await service.ledger(ctx, parse(ledgerQuery, req.query));
      sendData(res, result.data, 200, { nextCursor: result.nextCursor });
    }) },
    { method: "post", path: "/admin/cash/deposit", handler: cash(async (ctx, req, res) => sendData(res, await service.deposit(ctx, { ...parse(depositBody, req.body), note: parse(depositBody, req.body).note ?? null }), 201)) },
    { method: "post", path: "/admin/cash/adjust", handler: cash(async (ctx, req, res) => sendData(res, await service.adjust(ctx, parse(adjustBody, req.body)), 201)) },
    { method: "get", path: "/admin/reconciliation", handler: cash(async (ctx, req, res) => {
      const result = await service.reconciliation(ctx, parse(reconciliationQuery, req.query));
      sendData(res, result.data, 200, { openCount: result.openCount, nextCursor: result.nextCursor });
    }) },
    { method: "post", path: "/admin/reconciliation/:id/resolve", handler: cash(async (ctx, req, res) => {
      const body = parse(resolveBody, req.body);
      sendData(res, await service.resolve(ctx, pathId(req, "id", "Reconciliation item"), { outcome: body.outcome, note: body.note ?? null, bankReference: body.bankReference ?? null, amount: body.amount }));
    }) },
    { method: "post", path: "/admin/orders/:id/fix-collection", handler: orders(async (ctx, req, res) => sendData(res, await service.fixCollection(ctx, pathId(req, "id", "Order"), parse(fixBody, req.body)))) },
  ];
}
