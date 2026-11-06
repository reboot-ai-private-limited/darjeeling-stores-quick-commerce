import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { compareVersions, createAppConfigModule } from "../src/modules/settings/app-config.public.js";

describe("public app configuration", () => {
  it("compares numeric releases correctly and returns only the requested platform policy", async () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    const module = createAppConfigModule({ customer: { android: { minSupportedVersion: "1.3.0", latestVersion: "1.5.0", downloadUrl: "https://example.com/customer" } }, supportNumber: "+919800000001" });
    const app = createApp({ additionalRoutes: module.routes });
    const old = await request(app).get("/api/v1/app/config").query({ app: "customer", platform: "android", version: "1.2.9" });
    expect(old.status).toBe(200); expect(old.body.data.forceUpdate).toBe(true);
    expect(Object.keys(old.body.data).sort()).toEqual(["downloadUrl", "forceUpdate", "latestVersion", "maintenance", "minSupportedVersion", "supportNumber"]);
    expect((await request(app).get("/api/v1/app/config").query({ app: "customer", platform: "android", version: "1.3.0" })).body.data.forceUpdate).toBe(false);
    expect((await request(app).get("/api/v1/app/config").query({ app: "rider", platform: "ios", version: "1.0.0" })).status).toBe(400);
    expect((await request(app).get("/api/v1/app/config").query({ app: "customer", platform: "android", version: "bad" })).status).toBe(400);
  });
  it("blocks business endpoints during maintenance while keeping config and probes available", async () => {
    const module = createAppConfigModule({ maintenance: { active: true, message: "Back shortly" } });
    const app = createApp({ isReady: () => true, additionalRoutes: module.routes, maintenance: module.maintenance });
    expect((await request(app).post("/api/v1/auth/request-otp").send({ phone: "9800000000" })).status).toBe(503);
    expect((await request(app).get("/api/v1/admin/staff")).body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
    expect((await request(app).get("/api/v1/ready")).status).toBe(200);
    expect((await request(app).get("/api/v1/app/config").query({ app: "customer", platform: "ios", version: "1.0.0" })).body.data.maintenance.active).toBe(true);
  });
  it("validates deployment config and refuses secrets or contradictory version limits", () => {
    const base = { MONGODB_URI: "mongodb://localhost/app_config_test" };
    for (const input of ["{bad", '{"secret":"do-not-publish"}', JSON.stringify({ rider: { android: { minSupportedVersion: "2.0.0", latestVersion: "1.0.0" } } })]) {
      expect(() => loadConfig({ ...base, PUBLIC_APP_CONFIG_JSON: input })).toThrow("PUBLIC_APP_CONFIG_JSON");
    }
    expect(loadConfig(base).PUBLIC_APP_CONFIG_JSON.maintenance.active).toBe(false);
  });
});
