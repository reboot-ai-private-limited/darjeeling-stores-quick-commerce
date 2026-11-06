import { afterEach, describe, expect, it, vi } from "vitest";
import { adminFetch, readAdminSession } from "../../web/src/app/admin/session-client.js";

afterEach(() => vi.unstubAllGlobals());
describe("browser cookie session client", () => {
  it("refreshes once for parallel failed reads and retries without exposing token headers", async () => {
    let authenticated = false;
    let rotations = 0;
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
      expect(init.credentials).toBe("same-origin");
      expect(init.headers ?? {}).not.toHaveProperty("Authorization");
      if (path === "/api/v1/auth/refresh") {
        expect(init.headers).toMatchObject({ "X-CSRF-Token": "1", "X-Client": "admin" });
        rotations++;
        authenticated = true;
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: authenticated ? 200 : 401 });
    }));
    const responses = await Promise.all([adminFetch("/api/v1/admin/roles"), adminFetch("/api/v1/admin/permissions")]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(rotations).toBe(1);
  });
  it("does not retry revoked sessions indefinitely or mistake an outage for logout", async () => {
    vi.stubGlobal("navigator", {});
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect(await readAdminSession()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(readAdminSession()).rejects.toThrow("Unable to check");
  });
  it("restores custom staff roles without accepting a customer as staff", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { id: "staff-id", kind: "staff", role: "warehouse_manager", name: "Manager", permissions: ["staff:manage"] } }), { status: 200 })));
    expect((await readAdminSession())?.user.role).toBe("warehouse_manager");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { kind: "customer", role: "admin" } }), { status: 200 })));
    expect(await readAdminSession()).toBeNull();
  });
});
