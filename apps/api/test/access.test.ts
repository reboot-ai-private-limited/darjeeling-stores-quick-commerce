import { describe, expect, it } from "vitest";
import { canAccess, type AccessActor } from "../src/modules/access/access.public.js";
const actor: AccessActor = { kind: "staff", permissions: ["orders:view"], scope: { all: false, warehouseIds: ["warehouse-a"] } };
describe("server access policy", () => {
  it("requires both permission and matching warehouse scope", () => {
    expect(canAccess(actor, "orders:view", { kind: "warehouse", warehouseId: "warehouse-a" })).toBe(true);
    expect(canAccess(actor, "orders:view", { kind: "warehouse", warehouseId: "warehouse-b" })).toBe(false);
    expect(canAccess(actor, "orders:manage", { kind: "warehouse", warehouseId: "warehouse-a" })).toBe(false);
    expect(canAccess(actor, "orders:view", { kind: "all" })).toBe(false);
  });
  it("denies customers even with a forged wildcard and rejects unknown keys", () => {
    expect(canAccess({ ...actor, kind: "customer", permissions: ["*"], scope: { all: true, warehouseIds: [] } }, "orders:view", { kind: "all" })).toBe(false);
    expect(canAccess({ ...actor, permissions: ["*"], scope: { all: true, warehouseIds: [] } }, "unknown:manage" as never, { kind: "all" })).toBe(false);
  });
});
