import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { AppError, forbidden, parse, pathId, requestIdOf, sendData, sendError } from "../../catalog/catalog.public.js";
import type { MediaService } from "../application/media-service.js";
import { KINDS, OWNER_TYPES, hasAny, type Principal } from "../domain/media.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
export const uploadBody = z.object({
  kind: z.enum(KINDS as [string, ...string[]]),
  contentType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.number().int().min(1).max(1_000_000_000),
  durationSec: z.number().min(0).max(3600).nullable().optional(),
  ownerRef: z.object({ type: z.enum(OWNER_TYPES as [string, ...string[]]), id }).strict().nullable().optional(),
}).strict();
export const completeBody = z.object({ mediaId: id }).strict();

/** Who is calling: a customer, a rider or a staff member. Supplied by the identity module's session; until then nobody is logged in. */
export type PrincipalResolver = (req: Request) => Promise<Principal | undefined> | Principal | undefined;
export const noPrincipals: PrincipalResolver = () => undefined;

type Handler = (principal: Principal, requestId: string, req: Request, res: Response) => Promise<void> | void;

function authed(resolve: PrincipalResolver, handler: Handler, permission?: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const principal = await resolve(req);
      if (!principal) return sendError(res, new AppError("UNAUTHORIZED", "Authentication required"));
      if (permission && !(principal.kind === "staff" && hasAny(principal, [permission]))) return sendError(res, forbidden());
      await handler(principal, requestIdOf(res), req, res);
    } catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}

/** The 7 endpoints of docs/api/F24-media-storage.md. Paths are relative to the API prefix. */
export function mediaRoutes(service: MediaService, resolve: PrincipalResolver): Route[] {
  return [
    { method: "post", path: "/media/upload-url", handler: authed(resolve, async (p, _r, req, res) => {
      const body = parse(uploadBody, req.body);
      sendData(res, await service.requestUpload(p, {
        kind: body.kind as never, contentType: body.contentType, sizeBytes: body.sizeBytes, durationSec: body.durationSec ?? null,
        ownerRef: body.ownerRef ? { type: body.ownerRef.type as never, id: body.ownerRef.id } : null,
      }), 201);
    }) },
    { method: "post", path: "/media/complete", handler: authed(resolve, async (p, _r, req, res) => sendData(res, await service.complete(p, parse(completeBody, req.body).mediaId))) },
    { method: "get", path: "/media/:id", handler: authed(resolve, async (p, _r, req, res) => sendData(res, await service.get(p, pathId(req, "id", "Media")))) },
    { method: "get", path: "/media/:id/url", handler: authed(resolve, async (p, _r, req, res) => sendData(res, await service.readUrl(p, pathId(req, "id", "Media")))) },
    { method: "delete", path: "/media/:id", handler: authed(resolve, async (p, requestId, req, res) => {
      await service.remove({ principal: p, requestId }, pathId(req, "id", "Media"));
      sendData(res, { ok: true });
    }) },
    { method: "get", path: "/admin/media/failed", handler: authed(resolve, async (_p, _r, _req, res) => sendData(res, await service.failedDeletions()), "catalog:manage") },
    { method: "post", path: "/admin/media/:id/retry-delete", handler: authed(resolve, async (p, requestId, req, res) =>
      sendData(res, await service.retryDelete({ principal: p, requestId }, pathId(req, "id", "Media"))), "catalog:manage") },
  ];
}
