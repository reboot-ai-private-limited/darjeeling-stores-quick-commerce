/** Business error carrying a stable code from docs/api/00-conventions.md. HTTP status mapping lives in the interface layer. */
export type ErrorCode =
  | "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"
  | "VERSION_CONFLICT" | "PRICE_CONFLICT" | "INSUFFICIENT_STOCK" | "UPLOAD_REJECTED" | "SERVICE_UNAVAILABLE" | "OTP_DELIVERY_FAILED"
  | "RIDER_NOT_ELIGIBLE" | "INVALID_TRANSITION" | "ALREADY_ACKNOWLEDGED" | "OTP_MISMATCH" | "OTP_LOCKED" | "PAYMENT_MISMATCH";

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

export const validation = (message: string, details?: unknown) => new AppError("VALIDATION_ERROR", message, details);
export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError("CONFLICT", message, details);
export const forbidden = (message = "You do not have permission to do this") => new AppError("FORBIDDEN", message);
