import { describe, expect, it } from "vitest";
import { assertUniqueRoutes, type Route } from "../src/platform/routes.js";

const handler: Route["handler"] = (_req, res) => { res.sendStatus(204); };
describe("route registration", () => {
  it("rejects duplicate method and path across compositions", () => {
    expect(() => assertUniqueRoutes([{ method: "get", path: "/health", handler }, { method: "get", path: "/health", handler }])).toThrow("Duplicate route: GET /health");
  });
  it("allows different methods on the same path", () => {
    expect(() => assertUniqueRoutes([{ method: "get", path: "/health", handler }, { method: "post", path: "/health", handler }])).not.toThrow();
  });
});
