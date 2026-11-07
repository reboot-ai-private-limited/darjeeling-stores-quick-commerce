import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { createAdminModules } from "../src/composition/admin.js";
import { dev2Routes } from "../src/composition/dev2.js";
import { changeOf } from "../src/modules/audit/audit-reader.js";
import { escapeRegex, searchFilter } from "../src/modules/customers/domain/customer.js";
import { addDays, csvCell, dayRange, dayStart, istDay, toCsv } from "../src/modules/reports/domain/reports.js";
import { changeProblems, defsOf, dependencyProblems, DEFS, GROUPS, REGISTRY, resolveKey, valueProblem, type Layer } from "../src/modules/settings/domain/registry.js";
import { assertUniqueRoutes } from "../src/platform/routes.js";

describe("the settings registry", () => {
  it("has unique keys, defaults that pass their own rules, and only known groups", () => {
    expect(new Set(REGISTRY.map(d => `${d.group}.${d.key}`)).size).toBe(REGISTRY.length);
    for (const def of REGISTRY) {
      expect(GROUPS).toContain(def.group);
      expect(valueProblem(def, def.default), `${def.group}.${def.key}`).toBeNull();
      expect(def.scopes.length).toBeGreaterThan(0);
    }
  });
  it("names every group and key in a form the audit record accepts", () => {
    for (const def of REGISTRY) {
      expect(def.group).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/);
      expect(def.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/);
    }
  });
  it("never offers a secret as a setting", () => {
    for (const def of REGISTRY) expect(def.key).not.toMatch(/secret|password|apikey|token(?!TtlHours)|razorpay|s3key/i);
  });
  it("rejects bad values, unknown keys and keys that cannot be set at the scope", () => {
    const zone = { type: "zone" as const, id: "a".repeat(24) };
    expect(changeProblems("eta", zone, { packMinutes: 6 })).toEqual([]);
    expect(changeProblems("eta", zone, { packMinutes: 6.5 })[0]?.key).toBe("packMinutes");
    expect(changeProblems("eta", zone, { packMinutes: 999 })[0]?.key).toBe("packMinutes");
    expect(changeProblems("eta", zone, { packMinutes: "6" })[0]?.key).toBe("packMinutes");
    expect(changeProblems("eta", zone, { nope: 1 })).toEqual([{ key: "nope", message: "Unknown setting" }]);
    expect(changeProblems("stock", zone, { zonePriceConflictMode: "warn" })[0]?.message).toMatch(/zone scope/);
    expect(changeProblems("stock", { type: "global", id: null }, { zonePriceConflictMode: "maybe" })[0]?.message).toMatch(/block, warn/);
    expect(changeProblems("eta", zone, { packMinutes: null })).toEqual([]);
  });
  it("lets the most specific scope win and falls back to the default", () => {
    const def = DEFS.get("eta.packMinutes")!;
    const layers: Layer[] = [{ scope: "global", value: 8, version: 1 }, { scope: "zone", value: 7, version: 2 }, { scope: "warehouse", value: 6, version: 3 }];
    expect(resolveKey(def, layers)).toEqual({ value: 6, source: "warehouse", version: 3 });
    expect(resolveKey(def, layers.slice(0, 2))).toEqual({ value: 7, source: "zone", version: 2 });
    expect(resolveKey(def, layers.slice(0, 1))).toEqual({ value: 8, source: "global", version: 1 });
    expect(resolveKey(def, [])).toEqual({ value: 5, source: "default", version: 0 });
  });
  it("checks rules that tie several keys together", () => {
    expect(dependencyProblems({ rainSurchargeAmount: 6000, surchargeCap: 5000 })[0]?.key).toBe("rainSurchargeAmount");
    expect(dependencyProblems({ rainSurchargeAmount: 1500, surchargeCap: 5000 })).toEqual([]);
    expect(dependencyProblems({ rainSurchargeAmount: 1500, surchargeCap: 0 })).toEqual([]);
    expect(dependencyProblems({ slaPackMinutes: 2, slaConfirmMinutes: 5 })[0]?.key).toBe("slaPackMinutes");
  });
  it("lists every spec group and gives each key to exactly one group", () => {
    expect(GROUPS).toHaveLength(15);
    expect(defsOf("eta").map(d => d.key)).toContain("packMinutes");
  });
});

describe("report dates and CSV", () => {
  it("works out Indian days across the UTC boundary", () => {
    expect(istDay(new Date("2026-11-05T18:29:59Z"))).toBe("2026-11-05");
    expect(istDay(new Date("2026-11-05T18:30:00Z"))).toBe("2026-11-06");
    expect(dayStart("2026-11-06").toISOString()).toBe("2026-11-05T18:30:00.000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("defaults to the last seven days and rejects bad ranges", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(dayRange({}, now)).toMatchObject({ from: "2026-10-30", to: "2026-11-05" });
    expect(dayRange({ from: "2026-11-05", to: "2026-11-05" }, now)).toMatchObject({ start: dayStart("2026-11-05"), end: dayStart("2026-11-06") });
    expect(dayRange({ from: "2026-11-06", to: "2026-11-05" }, now)).toHaveProperty("error");
    expect(dayRange({ from: "2026-02-30" }, now)).toHaveProperty("error");
    expect(dayRange({ from: "2024-01-01", to: "2026-01-01" }, now)).toHaveProperty("error");
  });
  it("keeps spreadsheet formulas from running and quotes awkward text", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91")).toBe("'+91");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("Rai, Asha")).toBe("\"Rai, Asha\"");
    expect(csvCell(null)).toBe("");
    expect(toCsv({ columns: ["a", "b"], rows: [["x", 1]] })).toBe("a,b\r\nx,1\r\n");
  });
});

describe("customer search and audit views", () => {
  it("reads a phone number or a name", () => {
    expect(searchFilter("98765 43210")).toEqual({ phone: "+919876543210" });
    expect(searchFilter("+919876543210")).toEqual({ phone: "+919876543210" });
    expect(searchFilter("Asha")).toEqual({ namePrefix: "Asha" });
    expect(escapeRegex("a.b(c)")).toBe("a\\.b\\(c\\)");
  });
  it("shows the before and after of whichever change an audit record carries", () => {
    expect(changeOf({ customerChange: { before: { status: "active" }, after: { status: "blocked" } } })).toEqual({ before: { status: "active" }, after: { status: "blocked" } });
    expect(changeOf({ action: "x" })).toEqual({ before: null, after: null });
  });
});

describe("F25 routes", () => {
  const docs = fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/api/F25-admin-panel-settings-and-reports.md"), "utf8").replace(/\r\n/g, "\n");
  const documented = [...docs.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)` \|/gm)].map(([, m, p]) => `${m} ${p!.replace(/:[A-Za-z]+/g, ":p")}`).filter(r => r !== "GET /health");
  const { routes } = createAdminModules({ connection: mongoose.createConnection(), resolveStaff: () => null, trustedOrigins: [], env: {} });
  const registered = routes.map(r => `${r.method.toUpperCase()} ${r.path.replace(/:[A-Za-z]+/g, ":p")}`);

  it("registers every endpoint the document lists", () => {
    expect(documented).toHaveLength(15);
    expect(documented.filter(r => !registered.includes(r))).toEqual([]);
    expect(registered).toHaveLength(15);
  });
  it("does not clash with Dev 2's routes", () => {
    expect(() => assertUniqueRoutes([...dev2Routes(), ...routes])).not.toThrow();
  });
  it("registers the fixed paths before the ones with a parameter", () => {
    const at = (r: string) => registered.indexOf(r);
    expect(at("GET /admin/settings/registry")).toBeLessThan(at("GET /admin/settings/:p"));
    expect(at("GET /admin/settings/history")).toBeLessThan(at("GET /admin/settings/:p"));
    expect(at("GET /admin/customers/export")).toBeLessThan(at("GET /admin/customers/:p"));
  });
  it("answers 401 without a session", async () => {
    const { createApp } = await import("../src/app.js");
    const { default: request } = await import("supertest");
    const app = createApp({ isReady: () => true, dev2Routes: routes });
    for (const url of ["/admin/settings/registry", "/admin/dashboard", "/admin/reports", "/admin/customers", "/admin/audit"]) {
      expect((await request(app).get(`/api/v1${url}`)).status, url).toBe(401);
    }
  });
});
