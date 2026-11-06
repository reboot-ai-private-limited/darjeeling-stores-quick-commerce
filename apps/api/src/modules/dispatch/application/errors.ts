import type { DeliveryOrder, TransitionResult } from "../../../platform/orders.js";
import { AppError, notFound } from "../../catalog/catalog.public.js";
import type { IneligibleReason } from "../domain/dispatch.js";

export const eligibilityError = (reasons: readonly IneligibleReason[]) =>
  new AppError("RIDER_NOT_ELIGIBLE", "This rider cannot take the order right now", { reasons });

/** The orders module refused a status change (or the order is gone). */
export function transitionError(result: Extract<TransitionResult, { ok: false }> | { reason: "not_found" | "invalid_transition"; from?: string }, to?: string, extra: Record<string, unknown> = {}): AppError {
  if (result.reason === "not_found") return notFound("Order");
  return new AppError("INVALID_TRANSITION", "The order is not in a state that allows this", { ...(result.from && { from: result.from }), ...(to && { to }), ...extra });
}

export const invalidTransition = (order: Pick<DeliveryOrder, "status">, message: string, extra: Record<string, unknown> = {}) =>
  new AppError("INVALID_TRANSITION", message, { from: order.status, ...extra });
