import { describe, expect, it } from "vitest";
import { canAccess, canGrantPermissions, type AccessActor } from "../src/modules/access/access.public.js";
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

describe("role grant policy", () => {
  const manager: AccessActor = { kind: "staff", permissions: ["roles:manage", "orders:view"], scope: { all: true, warehouseIds: [] } };
  it("allows only registered permissions the manager already holds", () => {
    expect(canGrantPermissions(manager, ["orders:view"])).toBe(true);
    expect(canGrantPermissions(manager, ["orders:manage"])).toBe(false);
    expect(canGrantPermissions(manager, ["unknown:permission"])).toBe(false);
    expect(canGrantPermissions(manager, ["*"])).toBe(false);
  });
  it("requires an all-scope staff role manager and never permits granting wildcard", () => {
    expect(canGrantPermissions({ ...manager, scope: { all: false, warehouseIds: [] } }, [])).toBe(false);
    expect(canGrantPermissions({ ...manager, kind: "customer" }, [])).toBe(false);
    expect(canGrantPermissions({ ...manager, permissions: ["*"] }, ["orders:manage"])).toBe(true);
    expect(canGrantPermissions({ ...manager, permissions: ["*"] }, ["*"])).toBe(false);
  });
});
