"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { adminFetch } from "./session-client";

/** Shared pieces for the newer admin screens (overview, orders, settings). */

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const text = await res.text();
  let body: { error?: { message?: string; code?: string; details?: unknown } } & Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(body.error?.message ?? "The request could not be completed.", res.status, body.error?.code, body.error?.details);
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) { super(message); }
}

export const json = (method: "POST" | "PUT" | "DELETE", body?: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const errorText = (error: unknown, fallback = "Something went wrong. Please try again.") => (error instanceof Error ? error.message : fallback);

/** Paise to a rupee amount, such as ₹1,234.50 (whole rupees without decimals). */
export function money(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} min ago` : `${Math.floor(hours / 24)} d ago`;
}

export const can = (permissions: readonly string[], permission: string) => permissions.includes("*") || permissions.includes(permission);

/** Runs `load` now and then every `everyMs`, keeps the latest result, and lets the screen refresh on demand. */
export function usePolling<T>(load: () => Promise<T>, everyMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let active = true;
    const run = async () => {
      try { const value = await loader.current(); if (active) { setData(value); setError(""); } }
      catch (cause) { if (active) setError(errorText(cause, "Could not load. Retrying…")); }
      finally { if (active) setLoading(false); }
    };
    setLoading(true);
    void run();
    const timer = everyMs > 0 ? setInterval(run, everyMs) : undefined;
    return () => { active = false; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs, tick, ...deps]);
  return { data, error, loading, reload: () => setTick(value => value + 1), setData };
}

export type Warehouse = { id: string; name: string; code?: string; zoneId: string; isEnabled?: boolean };
export type Zone = { id: string; name: string };

/** Warehouses the signed-in staff member may see. */
export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => { void api<{ data: Warehouse[] }>("warehouses").then(r => setWarehouses(r.data ?? []), () => setWarehouses([])); }, []);
  return warehouses;
}

/** Zones, with a fallback to zone ids taken from the warehouses for staff who may not list zones. */
export function useZones(warehouses: Warehouse[]): Zone[] {
  const [zones, setZones] = useState<Zone[] | null>(null);
  useEffect(() => { void api<{ data: Zone[] }>("zones").then(r => setZones(r.data ?? []), () => setZones([])); }, []);
  if (zones && zones.length > 0) return zones;
  return [...new Set(warehouses.map(w => w.zoneId))].map(id => ({ id, name: `Zone …${id.slice(-4)}` }));
}

export function Heading({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="admin-heading" style={{ marginBottom: 12 }}>
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {children}
    </div>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  const colours = { error: ["#fdf0ee", "#b3261e"], ok: ["#f6f3ee", "#1b6b3a"], info: ["#f5f4f2", "#5a554c"] }[kind];
  return <p role={kind === "error" ? "alert" : "status"} style={{ margin: "10px 0", padding: "9px 12px", borderRadius: 8, background: colours[0], color: colours[1], fontSize: 12 }}>{children}</p>;
}

export function Badge({ tone = "paused", children }: { tone?: "active" | "paused" | "inactive" | "disabled" | "enabled"; children: ReactNode }) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>;
}

export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: string; badge?: number }[]; value: K; onChange: (key: K) => void; label: string }) {
  return (
    <div className="admin-tab-nav" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? "is-active" : ""} onClick={() => onChange(t.key)}>
          {t.label}{t.badge ? <span className="admin-count">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 12, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <small style={{ color: "var(--admin-muted)" }}>{hint}</small>}
    </label>
  );
}

export const inputStyle = { padding: "7px 9px", border: "1px solid #d8d5cf", borderRadius: 6, font: "inherit", background: "#fff", minWidth: 0 } as const;
