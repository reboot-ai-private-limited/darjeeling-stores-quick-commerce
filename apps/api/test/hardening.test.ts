import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { rateLimit } from "../src/platform/rate-limit.js";

function limited(perWindow: number, clock: { now: number }) {
  const app = express();
  app.use(rateLimit({ perWindow, now: () => clock.now }));
  app.get("/thing", (_req, res) => { res.json({ ok: true }); });
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.post("/webhooks/razorpay", (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe("rate limit", () => {
  it("lets a client make its allowance and then answers 429 with how long to wait", async () => {
    const clock = { now: 1_000_000 };
    const app = limited(3, clock);
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get("/thing");
      expect(ok.status).toBe(200);
      expect(ok.headers["x-ratelimit-limit"]).toBe("3");
      expect(ok.headers["x-ratelimit-remaining"]).toBe(String(2 - i));
    }
    const over = await request(app).get("/thing");
    expect(over.status).toBe(429);
    expect(over.body.error).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(over.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(over.headers["retry-after"])).toBeLessThanOrEqual(60);
  });
  it("starts a fresh window once the old one has ended", async () => {
    const clock = { now: 5_000_000 };
    const app = limited(1, clock);
    expect((await request(app).get("/thing")).status).toBe(200);
    expect((await request(app).get("/thing")).status).toBe(429);
    clock.now += 60_001;
    expect((await request(app).get("/thing")).status).toBe(200);
  });
  it("never limits the health probe or the providers' callbacks", async () => {
    const app = limited(1, { now: 1 });
    await request(app).get("/thing");
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get("/health")).status).toBe(200);
      expect((await request(app).post("/webhooks/razorpay")).status).toBe(200);
    }
  });
  it("is off when the allowance is 0", async () => {
    const app = limited(0, { now: 1 });
    for (let i = 0; i < 20; i++) expect((await request(app).get("/thing")).status).toBe(200);
  });
});

describe("API headers", () => {
  it("sets the safety headers on every answer, including errors", async () => {
    const app = createApp({ isReady: () => true });
    for (const url of ["/api/v1/health", "/api/v1/nothing-here"]) {
      const res = await request(app).get(url);
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      expect(res.headers["x-frame-options"], url).toBe("DENY");
      expect(res.headers["referrer-policy"], url).toBe("no-referrer");
      expect(res.headers["x-powered-by"], url).toBeUndefined();
    }
  });
  it("lets a browser page send the order idempotency key, but only from an allowed origin", async () => {
    const app = createApp({ corsOrigins: ["https://shop.example"] });
    const ok = await request(app).options("/api/v1/orders").set("Origin", "https://shop.example").set("Access-Control-Request-Method", "POST");
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
    const other = await request(app).options("/api/v1/orders").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("applies the configured limit to the API but not to the health probe", async () => {
    const app = createApp({ isReady: () => true, rateLimitPerMinute: 2 });
    expect((await request(app).get("/api/v1/nothing")).status).toBe(404);
    expect((await request(app).get("/api/v1/nothing")).status).toBe(404);
    expect((await request(app).get("/api/v1/nothing")).status).toBe(429);
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
  });
  it("reads the limit from the environment, 600 a minute by default", () => {
    const base = { MONGODB_URI: "mongodb://localhost/x" } as NodeJS.ProcessEnv;
    expect(loadConfig(base).RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(loadConfig({ ...base, RATE_LIMIT_PER_MINUTE: "0" }).RATE_LIMIT_PER_MINUTE).toBe(0);
    expect(() => loadConfig({ ...base, RATE_LIMIT_PER_MINUTE: "-1" })).toThrow(/RATE_LIMIT_PER_MINUTE/);
  });
});
