import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("mock OTP configuration", () => {
  const base = { MONGODB_URI: "mongodb://localhost/test", JWT_SECRET: "a".repeat(64) };
  it("defaults to disabled and requires explicit development mode", () => {
    expect(loadConfig(base).mockOTP).toBe(false);
    for (const NODE_ENV of [undefined, "production", "test"]) {
      expect(() => loadConfig({ ...base, NODE_ENV, mockOTP: "true" })).toThrow("mockOTP");
    }
    expect(loadConfig({ ...base, NODE_ENV: "development", mockOTP: "true" }).mockOTP).toBe(true);
    expect(() => loadConfig({ ...base, NODE_ENV: "development", mockOTP: "yes" })).toThrow("mockOTP");
    expect(() => loadConfig({ MONGODB_URI: base.MONGODB_URI, NODE_ENV: "development", mockOTP: "true" })).toThrow("JWT_SECRET");
  });
  it("validates session lifetimes and cookie security settings", () => {
    expect(loadConfig(base)).toMatchObject({ ACCESS_TOKEN_TTL: "30m", REFRESH_TOKEN_TTL: "15d", AUTH_COOKIE_SECURE: true });
    expect(loadConfig({ ...base, NODE_ENV: "development", ACCESS_TOKEN_TTL: "1m", REFRESH_TOKEN_TTL: "1h", AUTH_COOKIE_SECURE: "false", AUTH_COOKIE_SAME_SITE: "lax" })).toMatchObject({ ACCESS_TOKEN_TTL: "1m", REFRESH_TOKEN_TTL: "1h", AUTH_COOKIE_SECURE: false, AUTH_COOKIE_SAME_SITE: "lax" });
    for (const values of [
      { ACCESS_TOKEN_TTL: "0" }, { ACCESS_TOKEN_TTL: "bad" },
      { ACCESS_TOKEN_TTL: "1800" }, { ACCESS_TOKEN_TTL: "1.5h" }, { ACCESS_TOKEN_TTL: "-1m" },
      { ACCESS_TOKEN_TTL: "2h" }, { REFRESH_TOKEN_TTL: "31d" }, { REFRESH_TOKEN_TTL: "2w" },
      { REFRESH_TOKEN_TTL: "1m", ACCESS_TOKEN_TTL: "1m" },
      { AUTH_COOKIE_SECURE: "false" }, { AUTH_COOKIE_SECURE: "yes" },
      { NODE_ENV: "development", AUTH_COOKIE_SECURE: "false", AUTH_COOKIE_SAME_SITE: "none" },
    ]) expect(() => loadConfig({ ...base, ...values })).toThrow("Invalid configuration");
  });
});
