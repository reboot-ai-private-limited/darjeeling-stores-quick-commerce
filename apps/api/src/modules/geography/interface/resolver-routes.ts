import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Route } from "../../../platform/routes.js";
import type { ResolverService } from "../application/resolver-service.js";
import { GeographyError } from "../domain/errors.js";
import { resolveLocationSchema } from "./schemas.js";

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

export function createResolverRoutes(service: ResolverService): Route[] {
  const handler: Route["handler"] = async (req: Request, res: Response, next) => {
    try {
      const parsed = resolveLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "VALIDATION_ERROR", "Invalid location resolution parameters", parsed.error.issues);
        return;
      }

      const data = await service.resolve(parsed.data);
      return res.status(200).json({ data });
    } catch (error) {
      handleServiceError(res, error, next);
    }
  };

  return [
    {
      method: "post",
      path: "/location/resolve",
      handler,
    },
    {
      method: "post",
      path: "/zones/check",
      handler,
    },
  ];
}
