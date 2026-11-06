import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Route } from "../../../platform/routes.js";
import type { ZoneService } from "../application/zone-service.js";
import type { GeographyActor } from "../application/ports.js";
import { GeographyError } from "../domain/errors.js";
import { createZoneSchema, hexIdSchema, updateZoneSchema } from "./schemas.js";
import type { AuthResolver, CsrfValidator } from "./city-routes.js";

function requestIdOf(res: Response): string {
  const header = res.getHeader("X-Request-Id");
  return typeof header === "string" && header.length > 0 ? header : randomUUID();
}

function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const requestId = requestIdOf(res);
  res.status(status).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
    },
  });
}

function handleServiceError(res: Response, error: unknown, next: (err: unknown) => void): void {
  if (error instanceof GeographyError) {
    sendError(res, error.status, error.code, error.message, error.details);
    return;
  }
  next(error);
}

export function createZoneRoutes(
  service: ZoneService,
  resolveActor: AuthResolver,
  validateCsrf: CsrfValidator = () => true
): Route[] {
  async function authenticateStaff(req: Request, res: Response): Promise<GeographyActor | null> {
    const actor = await resolveActor(req);
    if (!actor) {
      sendError(res, 401, "UNAUTHORIZED", "Authentication required");
      return null;
    }
    const hasPermission = actor.permissions.includes("*") || actor.permissions.includes("zones:manage");
    if (!hasPermission || !actor.scope.all) {
      sendError(res, 403, "FORBIDDEN", "Permission denied: zones:manage with all-warehouse scope required");
      return null;
    }
    return actor;
  }

  function checkCsrf(req: Request, res: Response): boolean {
    if (req.get("Cookie") || req.get("Origin")) {
      if (!validateCsrf(req)) {
        sendError(res, 403, "FORBIDDEN", "Untrusted request origin or missing CSRF token");
        return false;
      }
    }
    return true;
  }

  return [
    {
      method: "get",
      path: "/admin/zones",
      handler: async (req, res, next) => {
        try {
          const actor = await authenticateStaff(req, res);
          if (!actor) return;
          res.setHeader("Cache-Control", "no-store");
          const cityIdQuery = typeof req.query.cityId === "string" ? req.query.cityId : undefined;
          const data = await service.listAdminZones(actor, { cityId: cityIdQuery });
          return res.json({ data, meta: { count: data.length } });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
    {
      method: "get",
      path: "/admin/zones/:id",
      handler: async (req, res, next) => {
        try {
          const actor = await authenticateStaff(req, res);
          if (!actor) return;

          const id = req.params.id;
          if (typeof id !== "string" || !hexIdSchema.safeParse(id).success) {
            sendError(res, 404, "NOT_FOUND", "Zone not found");
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          const data = await service.getAdminZone(id, actor);
          if (!data) {
            sendError(res, 404, "NOT_FOUND", "Zone not found");
            return;
          }
          return res.json({ data });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
    {
      method: "post",
      path: "/admin/zones",
      handler: async (req, res, next) => {
        try {
          if (!checkCsrf(req, res)) return;
          const actor = await authenticateStaff(req, res);
          if (!actor) return;

          const parsed = createZoneSchema.safeParse(req.body);
          if (!parsed.success) {
            sendError(res, 400, "VALIDATION_ERROR", "Invalid zone fields", parsed.error.issues);
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          const data = await service.createZone(parsed.data, actor, requestIdOf(res));
          return res.status(201).json({ data });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
    {
      method: "put",
      path: "/admin/zones/:id",
      handler: async (req, res, next) => {
        try {
          if (!checkCsrf(req, res)) return;
          const actor = await authenticateStaff(req, res);
          if (!actor) return;

          const id = req.params.id;
          if (typeof id !== "string" || !hexIdSchema.safeParse(id).success) {
            sendError(res, 404, "NOT_FOUND", "Zone not found");
            return;
          }

          const parsed = updateZoneSchema.safeParse(req.body);
          if (!parsed.success) {
            sendError(res, 400, "VALIDATION_ERROR", "Invalid zone fields", parsed.error.issues);
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          const data = await service.updateZone(id, parsed.data, actor, requestIdOf(res));
          return res.status(200).json({ data });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
  ];
}
