import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import type { SettingsService } from "../application/settings-service.js";
import type { ScopeRef } from "../domain/registry.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const scopeQuery = z.object({ scopeType: z.enum(["global", "zone", "warehouse"]).default("global"), scopeId: id.optional() }).strict();
const scopeBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(), z.object({ type: z.literal("zone"), id }).strict(), z.object({ type: z.literal("warehouse"), id }).strict(),
]);
export const putBody = z.object({ scope: scopeBody, values: z.record(z.string().min(1).max(64), z.union([z.number(), z.boolean(), z.string().max(64), z.null()])).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 60, "Send 1 to 60 values") }).strict();
const historyQuery = z.object({
  group: z.string().max(32).optional(), key: z.string().max(64).optional(), scopeId: id.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(64).optional(),
}).strict();

const toScope = (query: z.infer<typeof scopeQuery>): ScopeRef => {
  if (query.scopeType === "global") return { type: "global", id: query.scopeId ? query.scopeId : null };
  return { type: query.scopeType, id: query.scopeId ?? null };
};

/** The settings endpoints of F25. `/registry` and `/history` are registered before `/:group` so they are not read as group names. */
export function settingsRoutes(service: SettingsService, auth: AuthResolver): Route[] {
  const view = (h: Parameters<typeof guarded>[2]) => guarded(auth, "settings:view", h);
  const manage = (h: Parameters<typeof guarded>[2]) => guarded(auth, "settings:manage", h);
  return [
    { method: "get", path: "/admin/settings/registry", handler: view((_ctx, _req, res) => sendData(res, service.registry())) },
    { method: "get", path: "/admin/settings/history", handler: view(async (ctx, req, res) => {
      const result = await service.history(ctx, parse(historyQuery, req.query));
      sendData(res, result.rows.map(r => ({ group: r.group, key: r.key, scope: r.scope, oldValue: r.oldValue, newValue: r.newValue, by: r.by, at: r.at.toISOString() })), 200, { nextCursor: result.nextCursor });
    }) },
    { method: "get", path: "/admin/settings/:group", handler: view(async (ctx, req, res) => sendData(res, await service.get(ctx, String(req.params.group), toScope(parse(scopeQuery, req.query))))) },
    { method: "put", path: "/admin/settings/:group", handler: manage(async (ctx, req, res) => {
      const body = parse(putBody, req.body);
      const scope: ScopeRef = body.scope.type === "global" ? { type: "global", id: null } : { type: body.scope.type, id: body.scope.id };
      sendData(res, await service.put(ctx, String(req.params.group), { scope, values: body.values }));
    }) },
  ];
}
