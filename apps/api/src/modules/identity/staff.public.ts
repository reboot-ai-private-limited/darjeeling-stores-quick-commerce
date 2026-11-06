import type { Connection } from "mongoose";
import type { Route } from "../../platform/routes.js";
import { sessionSettings } from "../../config/env.js";
import { accessCredential, trustedCookieMutation } from "./interface/session-cookies.js";
import { createStaffService } from "./infrastructure/staff.js";
import { createStaffInput, updateStaffInput, resetPasswordInput, emptyStaffInput, staffId, staffListInput, StaffError, type StaffOperation } from "./domain/staff-policy.js";

export function createStaffRoutes(connection: Connection, jwtSecret: string, origins: readonly string[], settings = sessionSettings.parse({}), allowDevelopmentAccounts = false): Route[] {
  const service = createStaffService(connection, jwtSecret, settings, allowDevelopmentAccounts);
  function handler(operation: StaffOperation | "list" | "detail"): Route["handler"] {
    return async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        const token = accessCredential(req);
        const actor = await service.actor(token);
        const mutation = operation !== "list" && operation !== "detail";
        if (mutation && (req.get("Cookie") || req.get("Origin")) && !trustedCookieMutation(req, origins)) throw new StaffError(403, "FORBIDDEN", "Untrusted staff mutation");
        if (operation === "list") {
          const query = staffListInput.safeParse(req.query);
          if (!query.success) throw new StaffError(400, "VALIDATION_ERROR", "Invalid staff query");
          return res.json(await service.list(actor, query.data));
        }
        const parsedId = operation === "create" ? null : staffId.safeParse(req.params.id);
        if (parsedId && !parsedId.success) throw new StaffError(404, "NOT_FOUND", "Staff account not found");
        const id = parsedId?.success ? parsedId.data : undefined;
        if (operation === "detail") return res.json({ data: await service.detail(actor, id!) });
        const schema = operation === "create" ? createStaffInput : operation === "update" ? updateStaffInput : operation === "reset-password" ? resetPasswordInput : emptyStaffInput;
        const parsed = schema.safeParse(req.body ?? {});
        if (!parsed.success) throw new StaffError(400, "VALIDATION_ERROR", "Invalid staff fields");
        const data = await service.mutate(token, operation, id, parsed.data, String(res.getHeader("X-Request-Id")));
        return res.status(operation === "create" ? 201 : 200).json({ data });
      } catch (error) {
        if (error instanceof StaffError) return res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.getHeader("X-Request-Id") } });
        next(error);
      }
    };
  }
  return [
    { method: "get", path: "/admin/staff", handler: handler("list") },
    { method: "post", path: "/admin/staff", handler: handler("create") },
    { method: "get", path: "/admin/staff/:id", handler: handler("detail") },
    { method: "put", path: "/admin/staff/:id", handler: handler("update") },
    ...(["deactivate", "reactivate", "reset-password", "reset-2fa", "force-logout"] as const).map(operation =>
      ({ method: "post" as const, path: `/admin/staff/:id/${operation}`, handler: handler(operation) })),
  ];
}
