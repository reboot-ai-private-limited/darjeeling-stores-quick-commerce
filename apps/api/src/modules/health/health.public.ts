import type { Route } from "../../platform/routes.js";

export function healthRoutes(isReady: () => boolean): Route[] {
  return [
    { method: "get", path: "/health", handler: (_req, res) => { res.json({ status: "ok" }); } },
    { method: "get", path: "/ready", handler: (_req, res) => {
      const ready = isReady();
      res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable" });
    } },
  ];
}
