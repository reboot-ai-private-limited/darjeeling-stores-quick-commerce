import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("mock OTP configuration", () => {
  const base = { MONGODB_URI: "mongodb://localhost/test" };
  it("defaults to disabled and requires explicit development mode", () => {
    expect(loadConfig(base).mockOTP).toBe(false);
    for (const NODE_ENV of [undefined, "production", "test"]) {
      expect(() => loadConfig({ ...base, NODE_ENV, mockOTP: "true" })).toThrow("mockOTP");
    }
    expect(loadConfig({ ...base, NODE_ENV: "development", mockOTP: "true" }).mockOTP).toBe(true);
    expect(() => loadConfig({ ...base, NODE_ENV: "development", mockOTP: "yes" })).toThrow("mockOTP");
  });
});
