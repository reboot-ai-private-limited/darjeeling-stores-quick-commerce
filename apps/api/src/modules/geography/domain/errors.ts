export type GeographyErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_POLYGON"
  | "ZONE_OVERLAP"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export class GeographyError extends Error {
  constructor(
    readonly status: number,
    readonly code: GeographyErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "GeographyError";
  }
}

export const validationError = (message: string, details?: unknown) =>
  new GeographyError(400, "VALIDATION_ERROR", message, details);

export const invalidPolygon = (message: string, details?: unknown) =>
  new GeographyError(400, "INVALID_POLYGON", message, details);

export const zoneOverlap = (message: string, details?: { zoneId: string; name: string }) =>
  new GeographyError(409, "ZONE_OVERLAP", message, details);

export const unauthorized = (message = "Authentication required") =>
  new GeographyError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Permission denied") =>
  new GeographyError(403, "FORBIDDEN", message);

export const notFound = (what: string) =>
  new GeographyError(404, "NOT_FOUND", `${what} not found`);

export const conflict = (message: string, details?: unknown) =>
  new GeographyError(409, "CONFLICT", message, details);
