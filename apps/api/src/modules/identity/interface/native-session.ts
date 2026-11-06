import type { Request } from "express";
export function nativeClient(req: Request): "customer" | "rider" | null {
  if (req.get("Origin") || req.get("Cookie")) return null;
  return req.get("X-Client") === "customer-app" ? "customer" : req.get("X-Client") === "rider-app" ? "rider" : null;
}
