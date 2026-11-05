import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("HTTP errors", () => {
  it("returns a safe error and request ID for malformed JSON", async () => {
    const response = await request(createApp()).post("/api/v1/health").set("Content-Type", "application/json").send("{broken");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });
  it("limits JSON bodies", async () => {
    const response = await request(createApp()).post("/api/v1/health").send({ data: "x".repeat(110_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("BODY_TOO_LARGE");
  });
  it.each([
    ["Content-Type", "application/json; charset=iso-8859-1"],
    ["Content-Encoding", "unsupported"],
  ])("rejects unsupported %s with a safe client error", async (header, value) => {
    const response = await request(createApp()).post("/api/v1/health")
      .set("Content-Type", "application/json").set(header, value).send("{}");
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_ENCODING");
  });
  it("returns a structured 404 without reflecting the path", async () => {
    const response = await request(createApp()).get("/secret-path");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(response.body)).not.toContain("secret-path");
  });
});
