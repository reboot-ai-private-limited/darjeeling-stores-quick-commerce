import express from "express";
import { API_PREFIX } from "@darjeeling/shared";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get(`${API_PREFIX}/health`, (_req, res) => res.json({ status: "ok" }));
  return app;
}
