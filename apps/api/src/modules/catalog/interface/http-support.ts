import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import type { Actor, Ctx } from "../application/ports.js";
import { AppError, forbidden, notFound, validation, type ErrorCode } from "../domain/errors.js";

/**
 * Resolves the logged-in actor for a request. The real implementation comes with the identity/access modules;
 * until then composition passes `denyAll`, so no admin route answers anything but 401.
 */
export type AuthResolver = (req: Request) => Promise<Actor | undefined> | Actor | undefined;
export const denyAll: AuthResolver = () => undefined;

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  VERSION_CONFLICT: 409, PRICE_CONFLICT: 409, INSUFFICIENT_STOCK: 409, UPLOAD_REJECTED: 422, SERVICE_UNAVAILABLE: 503, OTP_DELIVERY_FAILED: 502,
  RIDER_NOT_ELIGIBLE: 409, INVALID_TRANSITION: 409, ALREADY_ACKNOWLEDGED: 409, OTP_MISMATCH: 401, OTP_LOCKED: 429, PAYMENT_MISMATCH: 422,
  OUT_OF_ZONE: 422, ZONE_PAUSED: 409, STORE_CLOSED: 409, ITEM_UNAVAILABLE: 409, MIN_ORDER_NOT_MET: 422, COD_NOT_ALLOWED: 422, COUPON_INVALID: 422, QUOTE_EXPIRED: 410, QUOTE_CHANGED: 409,
  ZONE_CHANGE_UNCONFIRMED: 409, IDEMPOTENCY_KEY_REUSED: 422, ORDER_NOT_CANCELLABLE: 409, PAYMENT_EXPIRED: 410, REFUND_NOT_ALLOWED: 422, REFUND_EXCEEDS_AMOUNT: 422,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdOf(res: Response): string {
  const header = res.getHeader("X-Request-Id");
  return typeof header === "string" && UUID.test(header) ? header : randomUUID();
}

export function sendError(res: Response, error: AppError): void {
  res.status(STATUS[error.code]).json({
    error: { code: error.code, message: error.message, ...(error.details !== undefined && { details: error.details }), requestId: res.getHeader("X-Request-Id") },
  });
}

export function sendData(res: Response, data: unknown, status = 200, meta?: Record<string, unknown>): void {
  res.status(status).json({ data, ...(meta !== undefined && { meta }) });
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw validation("Invalid request", result.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })));
}

/** Path ids are 24-hex strings; anything else cannot exist, so it is reported as not found. */
export function pathId(req: Request, name: string, what = "Resource"): string {
  const value = req.params[name];
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value)) throw notFound(what);
  return value;
}

export function assertWarehouseScope(actor: Actor, warehouseId: string): void {
  if (!actor.scope.all && !actor.scope.warehouseIds.includes(warehouseId)) throw forbidden("This warehouse is outside your scope");
}

/** Who the logged-in customer is. Supplied by the identity module's session; until then nobody is logged in. */
export type CustomerResolver = (req: Request) => Promise<{ userId: string } | undefined> | { userId: string } | undefined;
export const noCustomers: CustomerResolver = () => undefined;

/** Answers 401 unless a customer is logged in, then runs the handler and converts business errors into the documented envelope. */
export function customerGuarded(
  resolve: CustomerResolver, handler: (customer: { userId: string }, req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const customer = await resolve(req);
      if (!customer) return sendError(res, new AppError("UNAUTHORIZED", "Authentication required"));
      await handler(customer, req, res);
    } catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}

/** Runs a handler for anyone (a guest), converting business errors into the documented envelope. */
export function open(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}

/** Authenticates, checks the permission, runs the handler and converts business errors into the documented envelope. */
export function guarded(
  auth: AuthResolver, permission: string,
  handler: (ctx: Ctx, req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const actor = await auth(req);
      if (!actor) return sendError(res, new AppError("UNAUTHORIZED", "Authentication required"));
      if (!actor.permissions.includes("*") && !actor.permissions.includes(permission)) return sendError(res, forbidden());
      await handler({ actor, requestId: requestIdOf(res) }, req, res);
    } catch (error) {
      if (error instanceof AppError) return sendError(res, error);
      next(error);
    }
  };
}
