import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { requirePermission, type AccessActor } from "../src/modules/access/access.public.js";

describe("HTTP permission enforcement", () => {
  it("rechecks identity, permission and target scope on every request", async () => {
    let actor: AccessActor | null = null;
    const app = createApp({ additionalRoutes: [{ method: "get", path: "/test/warehouses/:id", handler: requirePermission(
      async () => actor,
      "warehouses:view",
      req => ({ kind: "warehouse", warehouseId: String(req.params.id) }),
      (_req, res) => { res.json({ data: { allowed: true } }); },
    ) }] });
    const get = (id = "wh-1") => request(app).get(`/api/v1/test/warehouses/${id}`);
    expect((await get()).status).toBe(401);
    actor = { kind: "staff", permissions: [], scope: { all: false, warehouseIds: ["wh-1"] } };
    const denied = await get();
    expect(denied.status).toBe(403);
    expect(denied.body.error.requestId).toBe(denied.headers["x-request-id"]);
    actor.permissions = ["warehouses:view"];
    expect((await get()).status).toBe(200);
    expect((await get("wh-2")).status).toBe(403);
    actor.scope.warehouseIds = ["wh-2"];
    expect((await get()).status).toBe(403);
    expect((await get("wh-2")).status).toBe(200);
    actor = null;
    expect((await get("wh-2")).status).toBe(401);
  });

  it("fails closed when actor resolution fails", async () => {
    const app = createApp({ additionalRoutes: [{ method: "get", path: "/test/protected", handler: requirePermission(
      async () => { throw new Error("private database failure"); }, "roles:manage", () => ({ kind: "all" }),
      (_req, res) => { res.json({ leaked: true }); },
    ) }] });
    const result = await request(app).get("/api/v1/test/protected");
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toMatch(/private database|leaked/);
  });
});
