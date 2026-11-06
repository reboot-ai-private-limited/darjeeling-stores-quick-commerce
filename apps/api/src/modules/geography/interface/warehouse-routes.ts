import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Route } from "../../../platform/routes.js";
import type { WarehouseService } from "../application/warehouse-service.js";
import type { GeographyActor } from "../application/ports.js";
import { GeographyError } from "../domain/errors.js";
import {
  createWarehouseSchema,
  hexIdSchema,
  updateWarehouseSchema,
} from "./schemas.js";
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

export function createWarehouseRoutes(
  service: WarehouseService,
  resolveActor: AuthResolver,
  validateCsrf: CsrfValidator = () => true
): Route[] {
  async function authenticateStaff(
    req: Request,
    res: Response,
    requiredPermission: "warehouses:view" | "warehouses:manage"
  ): Promise<GeographyActor | null> {
    const actor = await resolveActor(req);
    if (!actor) {
      sendError(res, 401, "UNAUTHORIZED", "Authentication required");
      return null;
    }
    const hasPermission =
      actor.permissions.includes("*") ||
      actor.permissions.includes(requiredPermission) ||
      (requiredPermission === "warehouses:view" && actor.permissions.includes("warehouses:manage"));
    if (!hasPermission) {
      sendError(res, 403, "FORBIDDEN", `Permission denied: ${requiredPermission} required`);
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
      path: "/admin/warehouses",
      handler: async (req, res, next) => {
        try {
          const actor = await authenticateStaff(req, res, "warehouses:view");
          if (!actor) return;

          res.setHeader("Cache-Control", "no-store");
          const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : undefined;
          let isEnabled: boolean | undefined = undefined;
          if (req.query.isEnabled === "true") isEnabled = true;
          if (req.query.isEnabled === "false") isEnabled = false;

          const data = await service.listAdminWarehouses(actor, { zoneId, isEnabled });
          return res.json({ data, meta: { count: data.length } });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
    {
      method: "get",
      path: "/admin/warehouses/:id",
      handler: async (req, res, next) => {
        try {
          const actor = await authenticateStaff(req, res, "warehouses:view");
          if (!actor) return;

          const id = req.params.id;
          if (typeof id !== "string" || !hexIdSchema.safeParse(id).success) {
            sendError(res, 404, "NOT_FOUND", "Warehouse not found");
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          const data = await service.getAdminWarehouse(id, actor);
          return res.json({ data });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
    {
      method: "post",
      path: "/admin/warehouses",
      handler: async (req, res, next) => {
        try {
          if (!checkCsrf(req, res)) return;
          const actor = await authenticateStaff(req, res, "warehouses:manage");
          if (!actor) return;

          if (!actor.scope.all) {
            sendError(res, 403, "FORBIDDEN", "Permission denied: all-warehouse scope required for warehouse creation");
            return;
          }

          const parsed = createWarehouseSchema.safeParse(req.body);
          if (!parsed.success) {
            sendError(res, 400, "VALIDATION_ERROR", "Invalid warehouse fields", parsed.error.issues);
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          const data = await service.createWarehouse(parsed.data, actor, requestIdOf(res));
          return res.status(201).json({ data });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
    {
      method: "put",
      path: "/admin/warehouses/:id",
      handler: async (req, res, next) => {
        try {
          if (!checkCsrf(req, res)) return;
          const actor = await authenticateStaff(req, res, "warehouses:manage");
          if (!actor) return;

          const id = req.params.id;
          if (typeof id !== "string" || !hexIdSchema.safeParse(id).success) {
            sendError(res, 404, "NOT_FOUND", "Warehouse not found");
            return;
          }

          const parsed = updateWarehouseSchema.safeParse(req.body);
          if (!parsed.success) {
            sendError(res, 400, "VALIDATION_ERROR", "Invalid warehouse fields", parsed.error.issues);
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          const data = await service.updateWarehouse(id, parsed.data, actor, requestIdOf(res));
          return res.status(200).json({ data });
        } catch (error) {
          handleServiceError(res, error, next);
        }
      },
    },
  ];
}
