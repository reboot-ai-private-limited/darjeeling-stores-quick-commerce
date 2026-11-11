"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, Badge, can, dateTime, errorText, Field, inputStyle, json, money, Notice, rupeesToPaise, useWarehouses, useZones } from "./admin-kit";
import type { AdminSession } from "./session-client";

type Tier = { from: number; to: number | null; fee: number };
type Rule = {
  id: string; type: "delivery_fee" | "surcharge"; kind?: "rain" | "late_night" | "other"; zoneIds: string[]; isActive: boolean;
  alwaysFree?: boolean; minOrder?: number | null; feeBasis?: "afterDiscount" | "beforeDiscount"; tiers?: Tier[];
  activeUntil?: string | null; amount?: number; extraMinutes?: number; waivedByFreeDelivery?: boolean;
  window?: { start: string; end: string; tz: string; days: number[] } | null;
};
type Preview = { charges: { type: string; label: string; amount: number }[]; surchargeCapApplied: boolean; extraMinutes: number; total: number; nextFreeDeliveryAt: number | null };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const rupees = (paise: number) => String(paise / 100);
const KIND_LABEL: Record<string, string> = { rain: "Rain surcharge", late_night: "Late-night fee", other: "Other surcharge" };
const cleanErrors = (cause: unknown) => {
  if (cause instanceof ApiError && Array.isArray(cause.details)) return `${cause.message} ${(cause.details as { message?: string }[]).map(d => d.message).filter(Boolean).join("; ")}`.trim();
  return errorText(cause);
};

// ─── Fee tiers ───────────────────────────────────────────────────────────────

type TierRow = { from: string; fee: string };

function FeeEditor({ zoneId, rule, canEdit, onSaved }: { zoneId: string; rule: Rule | null; canEdit: boolean; onSaved: () => void }) {
  const [alwaysFree, setAlwaysFree] = useState(false);
  const [minOrder, setMinOrder] = useState("");
  const [basis, setBasis] = useState<"afterDiscount" | "beforeDiscount">("afterDiscount");
  const [tiers, setTiers] = useState<TierRow[]>([{ from: "0", fee: "40" }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setMsg(null);
    setAlwaysFree(rule?.alwaysFree ?? false);
    setMinOrder(rule?.minOrder ? rupees(rule.minOrder) : "");
    setBasis(rule?.feeBasis ?? "afterDiscount");
    setTiers(rule?.tiers?.length ? rule.tiers.map(t => ({ from: rupees(t.from), fee: rupees(t.fee) })) : [{ from: "0", fee: "40" }]);
  }, [rule]);

  function build(): { tiers: Tier[] } | { problem: string } {
    const parsed = tiers.map(t => ({ from: Number(t.from), fee: Number(t.fee) }));
    if (parsed.some(t => !Number.isFinite(t.from) || !Number.isFinite(t.fee) || t.from < 0 || t.fee < 0)) return { problem: "Enter the order value and the fee for every row." };
    if (parsed[0]!.from !== 0) return { problem: "The first row must start at ₹0." };
    for (let i = 1; i < parsed.length; i++) if (parsed[i]!.from <= parsed[i - 1]!.from) return { problem: "Each row must start at a higher order value than the one above." };
    return { tiers: parsed.map((t, i) => ({ from: rupeesToPaise(t.from), to: i < parsed.length - 1 ? rupeesToPaise(parsed[i + 1]!.from) - 1 : null, fee: rupeesToPaise(t.fee) })) };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const built = build();
    if ("problem" in built) { setMsg({ kind: "error", text: built.problem }); return; }
    const body = { zoneIds: [zoneId], isActive: true, alwaysFree, minOrder: minOrder.trim() ? rupeesToPaise(Number(minOrder)) : null, feeBasis: basis, tiers: built.tiers };
    setBusy(true); setMsg(null);
    try {
      if (rule) await api(`delivery-rules/${rule.id}`, json("PUT", body)); else await api("delivery-rules", json("POST", { type: "delivery_fee", ...body }));
      setMsg({ kind: "ok", text: "Delivery fee saved. New quotes use it straight away; quotes already shown keep their price until they expire." }); onSaved();
    } catch (cause) { setMsg({ kind: "error", text: cleanErrors(cause) }); } finally { setBusy(false); }
  }

  const tierEnd = (i: number) => (i < tiers.length - 1 && Number.isFinite(Number(tiers[i + 1]!.from)) ? `up to ₹${Number(tiers[i + 1]!.from) - 0.01 > 0 ? Math.round((Number(tiers[i + 1]!.from) - 0.01) * 100) / 100 : 0}` : "and above");

  return (
    <form className="admin-panel" onSubmit={e => void save(e)} aria-labelledby="fee-title">
      <div className="admin-panel-toolbar"><h2 id="fee-title">Delivery fee</h2><span>{rule ? "Saved for this zone" : "Not set up yet"}</span></div>
      <div style={{ padding: "0 20px 18px", display: "grid", gap: 12 }}>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}><input type="checkbox" disabled={!canEdit} checked={alwaysFree} onChange={e => setAlwaysFree(e.target.checked)} /> Always free in this zone (for example the area next to the warehouse)</label>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Field label="Smallest order accepted (₹)" hint="Leave empty for no minimum."><input type="number" min={0} step="0.01" disabled={!canEdit} value={minOrder} onChange={e => setMinOrder(e.target.value)} style={{ ...inputStyle, width: 140 }} /></Field>
          <Field label="Fee is worked out on"><select disabled={!canEdit} value={basis} onChange={e => setBasis(e.target.value as typeof basis)} style={inputStyle}><option value="afterDiscount">Order value after discount</option><option value="beforeDiscount">Order value before discount</option></select></Field>
        </div>
        <table className="admin-product-table" style={{ maxWidth: 560 }}>
          <thead><tr><th>Order value from (₹)</th><th>Range</th><th>Delivery fee (₹)</th><th /></tr></thead>
          <tbody>{tiers.map((t, i) => (
            <tr key={i}>
              <td><input aria-label={`Row ${i + 1} order value from`} type="number" min={0} step="0.01" disabled={!canEdit || i === 0} value={t.from} onChange={e => setTiers(rows => rows.map((r, j) => (j === i ? { ...r, from: e.target.value } : r)))} style={{ ...inputStyle, width: 120 }} /></td>
              <td style={{ color: "var(--admin-muted)", fontSize: 14 }}>{tierEnd(i)}</td>
              <td><input aria-label={`Row ${i + 1} fee`} type="number" min={0} step="0.01" disabled={!canEdit} value={t.fee} onChange={e => setTiers(rows => rows.map((r, j) => (j === i ? { ...r, fee: e.target.value } : r)))} style={{ ...inputStyle, width: 110 }} /></td>
              <td>{canEdit && i > 0 && <button type="button" className="admin-text-button" onClick={() => setTiers(rows => rows.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {canEdit && <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="admin-text-button" onClick={() => setTiers(rows => [...rows, { from: String((Number(rows.at(-1)?.from) || 0) + 300), fee: "0" }])}>Add a row</button>
          <button className="admin-role-button" disabled={busy}>{busy ? "Saving…" : rule ? "Save delivery fee" : "Create delivery fee"}</button>
        </div>}
        <p style={{ margin: 0, fontSize: 13, color: "var(--admin-muted)" }}>Example: from ₹0 pay ₹40, from ₹300 pay ₹20, from ₹600 pay ₹0 (free). The last row covers every larger order.</p>
      </div>
    </form>
  );
}

// ─── Surcharges ──────────────────────────────────────────────────────────────

function SurchargeCard({ rule, canEdit, onSaved }: { rule: Rule; canEdit: boolean; onSaved: () => void }) {
  const [amount, setAmount] = useState(rupees(rule.amount ?? 0));
  const [extra, setExtra] = useState(String(rule.extraMinutes ?? 0));
  const [active, setActive] = useState(rule.isActive);
  const [waived, setWaived] = useState(rule.waivedByFreeDelivery ?? false);
  const [start, setStart] = useState(rule.window?.start ?? "22:00");
  const [end, setEnd] = useState(rule.window?.end ?? "06:00");
  const [days, setDays] = useState<number[]>(rule.window?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const dirty = amount !== rupees(rule.amount ?? 0) || extra !== String(rule.extraMinutes ?? 0) || active !== rule.isActive || waived !== (rule.waivedByFreeDelivery ?? false)
    || (rule.kind === "late_night" && (start !== rule.window?.start || end !== rule.window?.end || days.join() !== (rule.window?.days ?? []).join()));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api(`delivery-rules/${rule.id}`, json("PUT", {
        amount: rupeesToPaise(Number(amount)), extraMinutes: Number(extra), isActive: active, waivedByFreeDelivery: waived,
        ...(rule.kind === "late_night" ? { window: { start, end, tz: "Asia/Kolkata", days } } : {}),
      }));
      setMsg({ kind: "ok", text: "Saved." }); onSaved();
    } catch (cause) { setMsg({ kind: "error", text: cleanErrors(cause) }); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: "12px 0", borderTop: "1px solid var(--admin-border)", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>{KIND_LABEL[rule.kind ?? "other"]}</strong>
        <Badge tone={active ? "active" : "inactive"}>{active ? "On" : "Off"}</Badge>
        {rule.kind === "rain" && rule.activeUntil && <small style={{ color: "var(--admin-muted)" }}>until {dateTime(rule.activeUntil)}</small>}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <Field label="Extra charge (₹)"><input type="number" min={0} step="0.01" disabled={!canEdit} value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, width: 110 }} /></Field>
        <Field label="Adds delivery minutes"><input type="number" min={0} step={1} disabled={!canEdit} value={extra} onChange={e => setExtra(e.target.value)} style={{ ...inputStyle, width: 90 }} /></Field>
        {rule.kind === "late_night" && (
          <>
            <Field label="From (Indian time)"><input type="time" disabled={!canEdit} value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></Field>
            <Field label="Until (next morning)"><input type="time" disabled={!canEdit} value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} /></Field>
          </>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, paddingBottom: 8 }}><input type="checkbox" disabled={!canEdit} checked={waived} onChange={e => setWaived(e.target.checked)} /> Free when delivery is free</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, paddingBottom: 8 }}><input type="checkbox" disabled={!canEdit} checked={active} onChange={e => setActive(e.target.checked)} /> Switched on</label>
      </div>
      {rule.kind === "late_night" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Days it applies">
          {DAYS.map((d, i) => <label key={d} style={{ fontSize: 14, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" disabled={!canEdit} checked={days.includes(i)} onChange={() => setDays(cur => (cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort()))} />{d}</label>)}
        </div>
      )}
      {canEdit && <div><button className="admin-role-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></div>}
    </div>
  );
}

function NewLateNight({ zoneId, onSaved }: { zoneId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("20");
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("06:00");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      await api("delivery-rules", json("POST", { type: "surcharge", kind: "late_night", zoneIds: [zoneId], isActive: true, window: { start, end, tz: "Asia/Kolkata", days: [0, 1, 2, 3, 4, 5, 6] }, amount: rupeesToPaise(Number(amount)), extraMinutes: 5, waivedByFreeDelivery: false }));
      setOpen(false); onSaved();
    } catch (cause) { setMsg(cleanErrors(cause)); } finally { setBusy(false); }
  }
  if (!open) return <button className="admin-text-button" onClick={() => setOpen(true)}>Add a late-night fee</button>;
  return (
    <form onSubmit={e => void create(e)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", padding: "10px 0" }}>
      <Field label="Extra charge (₹)"><input type="number" min={0} step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, width: 100 }} /></Field>
      <Field label="From"><input type="time" required value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></Field>
      <Field label="Until"><input type="time" required value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} /></Field>
      <button className="admin-role-button" disabled={busy}>Create</button><button type="button" className="admin-text-button" onClick={() => setOpen(false)}>Cancel</button>
      {msg && <Notice>{msg}</Notice>}
    </form>
  );
}

// ─── Rain mode and preview ───────────────────────────────────────────────────

function RainMode({ zoneId, rain, canEdit, onSaved }: { zoneId: string; rain: Rule | null; canEdit: boolean; onSaved: () => void }) {
  const [hours, setHours] = useState("3");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const on = !!rain?.isActive && (!rain.activeUntil || new Date(rain.activeUntil).getTime() > Date.now());
  async function set(next: boolean) {
    setBusy(true); setMsg(null);
    try {
      await api("ops/rain", json("POST", { on: next, ...(next ? { until: new Date(Date.now() + Number(hours) * 3_600_000).toISOString() } : {}), zoneIds: [zoneId] }));
      setMsg({ kind: "ok", text: next ? `Rain mode is on for ${hours} hour${hours === "1" ? "" : "s"}. It switches itself off.` : "Rain mode is off." }); onSaved();
    } catch (cause) { setMsg({ kind: "error", text: cleanErrors(cause) }); } finally { setBusy(false); }
  }
  return (
    <section className="admin-panel" aria-labelledby="rain-title">
      <div className="admin-panel-toolbar"><h2 id="rain-title">Rain mode</h2><Badge tone={on ? "active" : "inactive"}>{on ? "On" : "Off"}</Badge></div>
      <div style={{ padding: "0 20px 16px", display: "grid", gap: 10, fontSize: 14 }}>
        <p style={{ margin: 0, color: "var(--admin-muted)" }}>Adds a small charge and extra minutes to every order in this zone while it rains. {rain?.amount !== undefined ? <>Currently {money(rain.amount)} and {rain.extraMinutes ?? 0} extra minutes (change it below under Surcharges).</> : "The amount comes from the Surcharges settings."}</p>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        {on && rain?.activeUntil && <span>Switches off by itself at <strong>{dateTime(rain.activeUntil)}</strong>.</span>}
        {canEdit ? (
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <Field label="For how many hours"><input type="number" min={1} max={24} step={1} value={hours} onChange={e => setHours(e.target.value)} style={{ ...inputStyle, width: 90 }} /></Field>
            <button className="admin-role-button" disabled={busy} onClick={() => void set(true)}>{on ? "Extend rain mode" : "Turn rain mode on"}</button>
            {on && <button className="admin-text-button" disabled={busy} onClick={() => void set(false)}>Turn off now</button>}
          </div>
        ) : <Notice kind="info">Turning rain mode on needs the &ldquo;ops mode&rdquo; permission.</Notice>}
      </div>
    </section>
  );
}

function BillPreview({ zoneId }: { zoneId: string }) {
  const [subtotal, setSubtotal] = useState("250");
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  async function run(e: FormEvent) {
    e.preventDefault(); setError("");
    try { setResult((await api<{ data: Preview }>("delivery-rules/preview", json("POST", { zoneId, subtotal: rupeesToPaise(Number(subtotal)), discount: 0, at: new Date().toISOString(), splitIntoWarehouses: 1 }))).data); }
    catch (cause) { setResult(null); setError(cleanErrors(cause)); }
  }
  return (
    <section className="admin-panel" aria-labelledby="preview-title">
      <div className="admin-panel-toolbar"><h2 id="preview-title">Try a bill</h2><span>Nothing is saved</span></div>
      <form onSubmit={e => void run(e)} style={{ padding: "0 20px 16px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <Field label="Order value (₹)"><input type="number" min={0} step="0.01" value={subtotal} onChange={e => setSubtotal(e.target.value)} style={{ ...inputStyle, width: 130 }} /></Field>
          <button className="admin-role-button">Show what a customer pays now</button>
        </div>
        {error && <Notice>{error}</Notice>}
        {result && (
          <div style={{ fontSize: 15, display: "grid", gap: 4 }}>
            {result.charges.length === 0 ? <span>No delivery charges: free delivery.</span> : result.charges.map((c, i) => <span key={i}>{c.label}: <strong>{money(c.amount)}</strong></span>)}
            {result.surchargeCapApplied && <small style={{ color: "#8a5a00" }}>Surcharges were limited by the surcharge cap.</small>}
            {result.extraMinutes > 0 && <small>Adds {result.extraMinutes} minutes to the delivery time.</small>}
            {result.nextFreeDeliveryAt !== null && <small style={{ color: "var(--admin-muted)" }}>Free delivery from {money(result.nextFreeDeliveryAt)}.</small>}
            <strong>Total charges: {money(result.total)}</strong>
          </div>
        )}
      </form>
    </section>
  );
}

// ─── Fees screen ─────────────────────────────────────────────────────────────

export default function Fees({ session }: { session: AdminSession }) {
  const permissions = session.user.permissions;
  const canEdit = can(permissions, "delivery_rules:manage");
  const warehouses = useWarehouses();
  const zones = useZones(warehouses);
  const [zoneId, setZoneId] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { if (!zoneId && zones[0]) setZoneId(zones[0].id); }, [zones, zoneId]);
  useEffect(() => {
    if (!zoneId) return;
    let active = true;
    setLoading(true); setError("");
    void api<{ data: Rule[] }>(`delivery-rules?zoneId=${zoneId}`).then(r => { if (active) setRules(r.data); }, cause => { if (active) { setRules([]); setError(errorText(cause)); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [zoneId, tick]);

  const refresh = () => setTick(n => n + 1);
  const fee = rules.find(r => r.type === "delivery_fee" && r.isActive) ?? rules.find(r => r.type === "delivery_fee") ?? null;
  const surcharges = rules.filter(r => r.type === "surcharge");
  const rain = surcharges.find(r => r.kind === "rain") ?? null;

  if (!canEdit) return <Notice kind="info">Your role does not include delivery fees. Ask the owner for the &ldquo;delivery rules&rdquo; permission.</Notice>;
  if (zones.length === 0) return <Notice kind="info">Add a delivery zone first (Zones &amp; localities), then set its fees here.</Notice>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 15, fontWeight: 600 }}>Zone{" "}
          <select value={zoneId} onChange={e => setZoneId(e.target.value)} style={inputStyle}>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        </label>
        <span style={{ fontSize: 14, color: "var(--admin-muted)" }}>Fees and surcharges are set per delivery zone.</span>
      </div>
      {error && <Notice>{error}</Notice>}
      {loading && !rules.length ? <p role="status" style={{ fontSize: 14 }}>Loading…</p> : (
        <>
          <FeeEditor zoneId={zoneId} rule={fee} canEdit={canEdit} onSaved={refresh} />
          <section className="admin-panel" aria-labelledby="sur-title">
            <div className="admin-panel-toolbar"><h2 id="sur-title">Surcharges</h2><span>Late-night, rain and others</span></div>
            <div style={{ padding: "0 20px 14px" }}>
              {surcharges.length === 0 && <p style={{ fontSize: 14, color: "var(--admin-muted)", margin: "0 0 8px" }}>No surcharges yet for this zone.</p>}
              {surcharges.map(r => <SurchargeCard key={`${r.id}-${r.amount}-${r.isActive}`} rule={r} canEdit={canEdit} onSaved={refresh} />)}
              <div style={{ borderTop: surcharges.length ? "1px solid var(--admin-border)" : undefined, paddingTop: 8 }}><NewLateNight zoneId={zoneId} onSaved={refresh} /></div>
              <p style={{ fontSize: 13, color: "var(--admin-muted)", margin: "6px 0 0" }}>All surcharges together are limited by the &ldquo;surcharge cap&rdquo; in Store settings → Surcharges.</p>
            </div>
          </section>
          <RainMode zoneId={zoneId} rain={rain} canEdit={can(permissions, "ops_mode:manage")} onSaved={refresh} />
          <BillPreview zoneId={zoneId} />
        </>
      )}
    </div>
  );
}
