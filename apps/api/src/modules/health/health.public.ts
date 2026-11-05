import { Router } from "express";

export function createHealthRouter(isReady: () => boolean) {
  const router = Router();
  router.get("/health", (_req, res) => res.json({ status: "ok" }));
  router.get("/ready", (_req, res) => {
    const ready = isReady();
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable" });
  });
  return router;
}
