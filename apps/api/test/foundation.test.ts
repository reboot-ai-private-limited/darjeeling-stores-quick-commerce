import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

describe("configuration", () => {
  it("reports invalid field names without printing secrets", () => {
    expect(() => loadConfig({ MONGODB_URI: "secret", PORT: "bad" })).toThrow(/PORT.*MONGODB_URI|MONGODB_URI.*PORT/);
    try { loadConfig({ MONGODB_URI: "secret" }); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });
  it("validates CORS origins and proxy hops", () => {
    expect(() => loadConfig({ MONGODB_URI: "mongodb://localhost/db", CORS_ORIGINS: "https://example.com/path" })).toThrow("CORS_ORIGINS");
    expect(() => loadConfig({ MONGODB_URI: "mongodb://localhost/db", TRUST_PROXY_HOPS: "-1" })).toThrow("TRUST_PROXY_HOPS");
  });
});
describe("readiness and CORS", () => {
  it("reports readiness separately from liveness", async () => {
    const app = createApp({ isReady: () => false });
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
    expect((await request(app).get("/api/v1/ready")).status).toBe(503);
    expect((await request(createApp({ isReady: () => true })).get("/api/v1/ready")).status).toBe(200);
  });
  it("allows only configured origins", async () => {
    const app = createApp({ corsOrigins: ["https://store.example"] });
    const allowed = await request(app).options("/api/v1/health").set("Origin", "https://store.example").set("Access-Control-Request-Method", "GET");
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://store.example");
    const denied = await request(app).get("/api/v1/health").set("Origin", "https://evil.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
