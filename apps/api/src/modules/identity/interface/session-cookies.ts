import type { Request, Response } from "express";

const accessName = "ds_access";
const refreshName = "ds_refresh";
export function readSessionCookie(req: Request, name: "access" | "refresh"): string {
  const key = name === "access" ? accessName : refreshName;
  const values = (req.get("Cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${key}=`));
  if (values.length !== 1) return "";
  const token = values[0]?.slice(key.length + 1) ?? "";
  return name === "refresh" ? (/^[a-f0-9]{64}$/.test(token) ? token : "")
    : (token.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : "");
}
export function accessCredential(req: Request) {
  const authorization = req.get("Authorization");
  return authorization ? (authorization.startsWith("Bearer ") ? authorization.slice(7) : "") : readSessionCookie(req, "access");
}
export function setSessionCookies(res: Response, pair: { accessToken: string; refreshToken: string; accessTokenExpiresInSeconds: number; refreshExpiresAt: Date }, secure: boolean, sameSite: "strict" | "lax" | "none" = "strict") {
  const options = { httpOnly: true, sameSite, secure };
  res.cookie(accessName, pair.accessToken, { ...options, path: "/api/v1", maxAge: pair.accessTokenExpiresInSeconds * 1000 });
  res.cookie(refreshName, pair.refreshToken, { ...options, path: "/api/v1/auth", maxAge: Math.max(0, pair.refreshExpiresAt.getTime() - Date.now()) });
  res.setHeader("Cache-Control", "no-store");
}
export function clearSessionCookies(res: Response, secure: boolean, sameSite: "strict" | "lax" | "none" = "strict") {
  const options = { httpOnly: true, sameSite, secure };
  res.clearCookie(accessName, { ...options, path: "/api/v1" });
  res.clearCookie(refreshName, { ...options, path: "/api/v1/auth" });
  res.setHeader("Cache-Control", "no-store");
}
export function trustedCookieMutation(req: Request, origins: readonly string[]) {
  const origin = req.get("Origin");
  return !!origin && origins.includes(origin) && req.get("X-CSRF-Token") === "1";
}
