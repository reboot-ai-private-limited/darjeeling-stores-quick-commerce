"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api, Badge, can, dateTime, errorText, Heading, inputStyle, json, money, Notice, Tabs, useWarehouses, useZones } from "./admin-kit";
import Fees from "./settings-fees";
import Hours from "./settings-hours";
import type { AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type ScopeType = "global" | "zone" | "warehouse";
type Value = number | boolean | string;
type Def = {
  group: string; key: string; type: "integer" | "number" | "boolean" | "enum"; description: string; scopes: ScopeType[];
  min?: number; max?: number; values?: string[]; default: Value; unit?: string;
};
type Row = { key: string; value: Value; source: ScopeType | "default"; version: number };
type GroupView = { group: string; scope: { type: ScopeType; id: string | null }; values: Row[] };
type HistoryRow = { group: string; key: string; scope: { type: ScopeType; id: string | null }; oldValue: unknown; newValue: unknown; by: string; at: string };

const GROUP_LABEL: Record<string, [string, string]> = {
  orders: ["Orders & checkout", "Cart limits, quote time, confirmation, cancellation"],
  payments: ["Payments & refunds", "Cash limit, pay links, refund rules"],
  delivery: ["Delivery, riders & tips", "Rider tips, delivery codes, location updates"],
  assignment: ["Dispatch", "Assignment mode, rider limits, delay alerts"],
  eta: ["Delivery time", "Packing and travel time, tracking links"],
  discounts: ["Surcharges", "Surcharge cap and rain-mode defaults"],
  stock: ["Stock", "Low-stock levels and the same-zone price rule"],
  hours: ["Opening hours defaults", "Used when a warehouse leaves them out"],
  preOrder: ["Pre-order defaults", "Booking cutoff and packing lead"],
  store: ["Store & catalogue", "What customers see in lists"],
  media: ["Photos & voice notes", "Size limits and how long files are kept"],
  tax: ["Tax", "How prices are shown"],
};
const SCOPE_LABEL: Record<ScopeType, string> = { global: "Everywhere", zone: "A zone", warehouse: "One warehouse" };
const SOURCE_LABEL: Record<string, string> = { default: "Built-in default", global: "Everywhere", zone: "Zone", warehouse: "Warehouse" };

const unitText = (def: Def) => (def.unit === "paise" ? "₹" : def.unit ?? "");
/** Paise are edited in rupees. */
const toInput = (def: Def, value: Value) => (def.unit === "paise" && typeof value === "number" ? String(value / 100) : String(value));
const fromInput = (def: Def, text: string): Value | null => {
  if (def.type === "boolean") return text === "true";
  if (def.type === "enum") return text;
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return def.unit === "paise" ? Math.round(n * 100) : n;
};
const show = (def: Def, value: unknown) => (def.type === "boolean" ? (value ? "On" : "Off") : def.unit === "paise" && typeof value === "number" ? money(value) : `${String(value)}${def.unit && def.unit !== "paise" ? ` ${def.unit}` : ""}`);

// ─── Store settings tab ──────────────────────────────────────────────────────

function StoreSettings({ session }: { session: AdminSession }) {
  const permissions = session.user.permissions;
  const canManage = can(permissions, "settings:manage");
  const everywhere = session.user.scope.all;
  const warehouses = useWarehouses();
  const zones = useZones(warehouses);
  const [registry, setRegistry] = useState<Def[] | null>(null);
  const [group, setGroup] = useState("orders");
  const [scopeType, setScopeType] = useState<ScopeType>(everywhere ? "global" : "warehouse");
  const [scopeId, setScopeId] = useState("");
  const [view, setView] = useState<GroupView | null>(null);
  const [draft, setDraft] = useState<Record<string, Value | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => { void api<{ data: Def[] }>("settings/registry").then(r => setRegistry(r.data), cause => setNotice({ kind: "error", text: errorText(cause) })); }, []);
  const groups = useMemo(() => (registry ? [...new Set(registry.map(d => d.group))].filter(g => GROUP_LABEL[g]) : []), [registry]);
  const defs = useMemo(() => (registry ?? []).filter(d => d.group === group), [registry, group]);

  // Pick a sensible place when the scope type changes.
  useEffect(() => {
    if (scopeType === "zone" && !zones.some(z => z.id === scopeId)) setScopeId(zones[0]?.id ?? "");
    if (scopeType === "warehouse" && !warehouses.some(w => w.id === scopeId)) setScopeId(warehouses[0]?.id ?? "");
    if (scopeType === "global") setScopeId("");
  }, [scopeType, zones, warehouses, scopeId]);

  const ready = scopeType === "global" || scopeId !== "";
  useEffect(() => {
    if (!ready || !registry) return;
    let active = true;
    setLoading(true); setDraft({}); setErrors({});
    const query = new URLSearchParams({ scopeType, ...(scopeId ? { scopeId } : {}) });
    void api<{ data: GroupView }>(`settings/${group}?${query}`).then(r => { if (active) setView(r.data); }, cause => { if (active) { setView(null); setNotice({ kind: "error", text: errorText(cause) }); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [group, scopeType, scopeId, ready, registry, reloadTick]);

  const rowOf = (key: string) => view?.values.find(v => v.key === key);
  const current = (def: Def): Value | null => (def.key in draft ? draft[def.key]! : rowOf(def.key)?.value ?? def.default);
  const changed = defs.filter(def => def.key in draft && (draft[def.key] === null ? rowOf(def.key)?.source === scopeType : draft[def.key] !== rowOf(def.key)?.value));

  async function save() {
    setBusy(true); setNotice(null); setErrors({});
    const values: Record<string, Value | null> = {};
    for (const def of changed) values[def.key] = draft[def.key]!;
    try {
      await api(`settings/${group}`, json("PUT", { scope: scopeType === "global" ? { type: "global" } : { type: scopeType, id: scopeId }, values }));
      setNotice({ kind: "ok", text: `Saved. The change applies from the next request, with no restart.` });
      setReloadTick(n => n + 1);
    } catch (cause) {
      if (cause instanceof ApiError && Array.isArray(cause.details)) setErrors(Object.fromEntries((cause.details as { key?: string; path?: string; message: string }[]).map(d => [d.key ?? d.path ?? "", d.message])));
      setNotice({ kind: "error", text: cause instanceof ApiError && cause.status === 403 ? "You can only change settings for your own warehouses." : "Some values were not accepted. Check the highlighted rows." });
    } finally { setBusy(false); }
  }

  if (!registry) return <p role="status" style={{ fontSize: 14 }}>Loading settings…</p>;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <nav className="admin-panel" aria-label="Settings groups" style={{ flex: "0 0 230px", padding: 8 }}>
        {groups.map(g => (
          <button key={g} onClick={() => setGroup(g)} aria-current={g === group ? "true" : undefined}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 10px", border: 0, borderRadius: 8, background: g === group ? "#f3f1ee" : "transparent", color: g === group ? "var(--admin-accent)" : "inherit", fontWeight: g === group ? 600 : 400, cursor: "pointer", font: "inherit", fontSize: 15 }}>
            {GROUP_LABEL[g]![0]}<small style={{ display: "block", fontWeight: 400, color: "var(--admin-muted)", fontSize: 13 }}>{GROUP_LABEL[g]![1]}</small>
          </button>
        ))}
      </nav>

      <section className="admin-panel" aria-labelledby="settings-title" style={{ flex: "1 1 520px", minWidth: 0 }}>
        <div className="admin-panel-toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2 id="settings-title">{GROUP_LABEL[group]?.[0]}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 14 }}>Applies to{" "}
              <select value={scopeType} onChange={e => setScopeType(e.target.value as ScopeType)} style={inputStyle} aria-label="Where the setting applies">
                {(everywhere ? (["global", "zone", "warehouse"] as ScopeType[]) : (["warehouse"] as ScopeType[])).map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
              </select>
            </label>
            {scopeType === "zone" && <select value={scopeId} onChange={e => setScopeId(e.target.value)} style={inputStyle} aria-label="Zone">{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>}
            {scopeType === "warehouse" && <select value={scopeId} onChange={e => setScopeId(e.target.value)} style={inputStyle} aria-label="Warehouse">{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
          </div>
        </div>
        <div style={{ padding: "0 20px 16px" }}>
          <p style={{ fontSize: 14, color: "var(--admin-muted)", margin: "0 0 12px" }}>
            A value set for a warehouse wins over its zone, which wins over &ldquo;Everywhere&rdquo;, which wins over the built-in default. Changes apply to the next request.
          </p>
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
          {changed.length > 0 && <Notice kind="info">You have unsaved changes. Save them before switching to another group or place, or they are discarded.</Notice>}
          {loading && <p role="status" style={{ fontSize: 14 }}>Loading…</p>}
          {!loading && ready && defs.map(def => {
            const row = rowOf(def.key);
            const here = row?.source === scopeType && scopeType !== "global" ? true : row?.source === "global" && scopeType === "global";
            const allowed = def.scopes.includes(scopeType);
            const value = current(def);
            const touched = def.key in draft;
            return (
              <div key={def.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "11px 0", borderTop: "1px solid var(--admin-border)", background: touched ? "#fcfbf8" : undefined }}>
                <div>
                  <div style={{ fontSize: 15 }}>{def.description}</div>
                  <div style={{ fontSize: 13, color: "var(--admin-muted)", marginTop: 2 }}>
                    <code>{def.key}</code> · {allowed ? <Badge tone={here ? "active" : "inactive"}>{here ? "Set here" : `From ${SOURCE_LABEL[row?.source ?? "default"]!.toLowerCase()}`}</Badge> : <>Only for {def.scopes.map(s => SCOPE_LABEL[s].toLowerCase()).join(" or ")}</>}
                    {def.min !== undefined && def.max !== undefined && def.type !== "boolean" && def.type !== "enum" && <> · allowed {show(def, def.min)} to {show(def, def.max)}</>}
                    {def.key === "surchargeCap" && <> · 0 means no limit</>}
                  </div>
                  {errors[def.key] && <div role="alert" style={{ color: "#b3261e", fontSize: 13, marginTop: 3 }}>{errors[def.key]}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {def.type === "boolean" ? (
                    <select aria-label={def.description} disabled={!canManage || !allowed} value={String(value)} onChange={e => setDraft(d => ({ ...d, [def.key]: e.target.value === "true" }))} style={inputStyle}><option value="true">On</option><option value="false">Off</option></select>
                  ) : def.type === "enum" ? (
                    <select aria-label={def.description} disabled={!canManage || !allowed} value={String(value)} onChange={e => setDraft(d => ({ ...d, [def.key]: e.target.value }))} style={inputStyle}>{def.values!.map(v => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select>
                  ) : (
                    <>
                      {def.unit === "paise" && <span aria-hidden="true">₹</span>}
                      <input aria-label={def.description} type="number" disabled={!canManage || !allowed} value={toInput(def, value as Value)} step={def.type === "number" ? 0.1 : def.unit === "paise" ? 0.01 : 1}
                        onChange={e => { const v = fromInput(def, e.target.value); if (v !== null) setDraft(d => ({ ...d, [def.key]: v })); }} style={{ ...inputStyle, width: 110, textAlign: "right" }} />
                      {def.unit && def.unit !== "paise" && <span style={{ fontSize: 13, color: "var(--admin-muted)", width: 50 }}>{unitText(def)}</span>}
                    </>
                  )}
                  {canManage && allowed && (row?.source === scopeType || touched) && (
                    <button className="admin-text-button" title={row?.source === scopeType ? "Remove this value so it is inherited again" : "Undo"} onClick={() => setDraft(d => { const { [def.key]: _gone, ...rest } = d; return row?.source === scopeType && !(def.key in d && d[def.key] === null) ? { ...rest, [def.key]: null } : rest; })}>
                      {def.key in draft && draft[def.key] === null ? "Undo reset" : row?.source === scopeType ? "Reset" : "Undo"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {canManage && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 14, borderTop: "1px solid var(--admin-border)" }}>
              <button className="admin-role-button" disabled={busy || changed.length === 0} onClick={() => void save()}>{busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}</button>
              {changed.length > 0 && <button className="admin-text-button" onClick={() => { setDraft({}); setErrors({}); }}>Discard</button>}
            </div>
          )}
          {!canManage && <Notice kind="info">You can view these settings but not change them.</Notice>}
        </div>
      </section>
    </div>
  );
}

// ─── History tab ─────────────────────────────────────────────────────────────

function History({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const [registry, setRegistry] = useState<Def[]>([]);
  const [group, setGroup] = useState("");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void api<{ data: Def[] }>("settings/registry").then(r => setRegistry(r.data), () => undefined); }, []);
  async function load(after: string | null, replace: boolean) {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ limit: "50", ...(group ? { group } : {}), ...(after ? { cursor: after } : {}) });
      const res = await api<{ data: HistoryRow[]; meta: { nextCursor: string | null } }>(`settings/history?${p}`);
      setRows(prev => (replace ? res.data : [...prev, ...res.data])); setCursor(res.meta.nextCursor);
    } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(null, true); }, [group]); // eslint-disable-line react-hooks/exhaustive-deps

  const defOf = (r: HistoryRow) => registry.find(d => d.group === r.group && d.key === r.key);
  const where = (r: HistoryRow) => (r.scope.type === "global" ? "Everywhere" : r.scope.type === "warehouse" ? warehouses.find(w => w.id === r.scope.id)?.name ?? "A warehouse" : "A zone");
  const val = (r: HistoryRow, v: unknown) => (v === null || v === undefined ? "not set" : defOf(r) ? show(defOf(r)!, v) : String(v));

  return (
    <section className="admin-panel" aria-labelledby="hist-title">
      <div className="admin-panel-toolbar"><h2 id="hist-title">Who changed what</h2>
        <select value={group} onChange={e => setGroup(e.target.value)} style={inputStyle} aria-label="Group"><option value="">All groups</option>{Object.keys(GROUP_LABEL).map(g => <option key={g} value={g}>{GROUP_LABEL[g]![0]}</option>)}</select>
      </div>
      {error && <Notice>{error}</Notice>}
      {rows.length === 0 && !loading ? <p style={{ padding: 20, margin: 0, fontSize: 14, color: "var(--admin-muted)" }}>No settings have been changed yet.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-product-table" style={{ width: "100%" }}>
            <thead><tr><th>When</th><th>Setting</th><th>Applies to</th><th>Was</th><th>Now</th><th>By</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}><td>{dateTime(r.at)}</td><td>{defOf(r)?.description ?? `${r.group}.${r.key}`}<br /><small style={{ color: "var(--admin-muted)" }}><code>{r.key}</code></small></td><td>{where(r)}</td><td>{val(r, r.oldValue)}</td><td><strong>{val(r, r.newValue)}</strong></td><td><small>…{r.by.slice(-6)}</small></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div style={{ padding: 12, textAlign: "center" }}>{loading ? <span role="status" style={{ fontSize: 14 }}>Loading…</span> : cursor && <button className="admin-text-button" onClick={() => void load(cursor, false)}>Show older changes</button>}</div>
    </section>
  );
}

// ─── Settings screen ─────────────────────────────────────────────────────────

type TabKey = "store" | "fees" | "hours" | "history";
export default function Settings({ session }: { session: AdminSession }) {
  const permissions = session.user.permissions;
  const warehouses = useWarehouses();
  const tabs = ([
    { key: "store", label: "Store settings", show: can(permissions, "settings:view") },
    { key: "fees", label: "Delivery fees & surcharges", show: can(permissions, "delivery_rules:manage") },
    { key: "hours", label: "Hours & pre-orders", show: can(permissions, "warehouses:view") || can(permissions, "warehouses:manage") },
    { key: "history", label: "Change history", show: can(permissions, "settings:view") },
  ] as { key: TabKey; label: string; show: boolean }[]).filter(t => t.show);
  const [tab, setTab] = useState<TabKey | null>(null);
  const active = tab && tabs.some(t => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <>
      <Heading title="Settings" subtitle="Change how the store works without touching any code. Everything here applies right away." />
      {tabs.length === 0 ? <Notice kind="info">Your role does not include settings.</Notice> : (
        <>
          <Tabs label="Settings sections" value={active!} onChange={setTab} tabs={tabs.map(t => ({ key: t.key, label: t.label }))} />
          {active === "store" && <StoreSettings session={session} />}
          {active === "fees" && <Fees session={session} />}
          {active === "hours" && <Hours session={session} />}
          {active === "history" && <History warehouses={warehouses} />}
        </>
      )}
    </>
  );
}
