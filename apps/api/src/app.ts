import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { API_PREFIX } from "@darjeeling/shared";
import { createContainer } from "./container.js";
import type { Route } from "./platform/routes.js";

type AppOptions = { isReady?: () => boolean; corsOrigins?: string[]; trustProxyHops?: number; additionalRoutes?: Route[] };
const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
  const [status, code, message] = type === "entity.parse.failed"
    ? [400, "INVALID_JSON", "Invalid JSON body"] as const
    : type === "charset.unsupported" || type === "encoding.unsupported"
      ? [415, "UNSUPPORTED_ENCODING", "Unsupported request encoding"] as const
    : type === "request.aborted" || type === "request.size.invalid"
      ? [400, "INVALID_REQUEST", "Invalid request body"] as const
    : type === "entity.too.large"
      ? [413, "BODY_TOO_LARGE", "Request body is too large"] as const
      : [500, "INTERNAL_ERROR", "Internal server error"] as const;
  if (status === 500) console.error(JSON.stringify({ event: "http_error", requestId: res.getHeader("X-Request-Id") }));
  res.status(status).json({ error: { code, message, requestId: res.getHeader("X-Request-Id") } });
};

export function createApp({ isReady = () => false, corsOrigins = [], trustProxyHops = 0, additionalRoutes = [] }: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxyHops);
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => console.info(JSON.stringify({ event: "http_request", requestId, method: req.method, status: res.statusCode, durationMs: Date.now() - started })));
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get("Origin");
    res.vary("Origin");
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      if (req.method === "OPTIONS" && req.get("Access-Control-Request-Method")) {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token");
        return res.sendStatus(204);
      }
    }
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(API_PREFIX, createContainer(isReady, additionalRoutes).router);
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found", requestId: res.getHeader("X-Request-Id") } }));
  app.use(handleError);
  return app;
}
