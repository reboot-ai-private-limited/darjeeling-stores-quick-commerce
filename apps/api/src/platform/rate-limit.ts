import type { RequestHandler } from "express";

export interface RateLimitOptions {
  /** Requests one client address may make per window. `0` turns the limit off. */
  perWindow: number; windowMs?: number;
  /** Paths (under the API prefix) that are never limited: probes and provider callbacks, which come in bursts from a few addresses. */
  skip?: readonly string[]; now?: () => number;
}

/**
 * A simple per-address limit held in memory (the API is one instance, so there is nothing to share). It stops a client from
 * hammering the API or guessing at it; the sign-in routes have their own stricter limits on top. Over the limit the answer is 429
 * with how long to wait. The table is trimmed as windows end, so it cannot grow without bound.
 */
export function rateLimit({ perWindow, windowMs = 60_000, skip = ["/health", "/ready", "/webhooks/"], now = Date.now }: RateLimitOptions): RequestHandler {
  if (perWindow <= 0) return (_req, _res, next) => next();
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = now() + windowMs;
  return (req, res, next) => {
    if (skip.some(prefix => req.path === prefix || (prefix.endsWith("/") && req.path.startsWith(prefix)))) return next();
    const at = now();
    if (at >= nextSweep) { for (const [key, hit] of hits) if (hit.resetAt <= at) hits.delete(key); nextSweep = at + windowMs; }
    const key = req.ip ?? "unknown";
    let hit = hits.get(key);
    if (!hit || hit.resetAt <= at) { hit = { count: 0, resetAt: at + windowMs }; hits.set(key, hit); }
    hit.count += 1;
    res.setHeader("X-RateLimit-Limit", String(perWindow));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, perWindow - hit.count)));
    if (hit.count > perWindow) {
      const wait = Math.max(1, Math.ceil((hit.resetAt - at) / 1000));
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly.", requestId: res.getHeader("X-Request-Id") } });
    }
    next();
  };
}
