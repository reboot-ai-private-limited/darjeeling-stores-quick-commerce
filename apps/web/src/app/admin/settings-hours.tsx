"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, Badge, can, dateTime, errorText, Field, inputStyle, json, Notice, useWarehouses } from "./admin-kit";
import type { AdminSession } from "./session-client";

type HoursRule = { days: number[]; open: string; close: string };
type Slot = { start: string; end: string; capacity: number };
type Details = {
  warehouseId: string; warehouse: { id: string; name: string; zoneId: string }; configured: boolean;
  hours: HoursRule[]; lastOrderMinutesBeforeClose: number; afterHoursMode: "closed" | "pre_order";
  preOrder: { enabled: boolean; slots: Slot[]; cutoffMinutesBeforeSlot: number; packLeadMinutes: number };
  pause: { active: true; message: string | null; until: string | null } | null;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const problem = (cause: unknown) => (cause instanceof ApiError && Array.isArray(cause.details) ? `${cause.message} ${(cause.details as { message?: string }[]).map(d => d.message).filter(Boolean).join("; ")}`.trim() : errorText(cause));

function HoursCard({ details, canEdit, onSaved }: { details: Details; canEdit: boolean; onSaved: () => void }) {
  const [rules, setRules] = useState<HoursRule[]>(details.hours);
  const [lastOrder, setLastOrder] = useState(String(details.lastOrderMinutesBeforeClose));
  const [after, setAfter] = useState(details.afterHoursMode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { setRules(details.hours); setLastOrder(String(details.lastOrderMinutesBeforeClose)); setAfter(details.afterHoursMode); setMsg(null); }, [details]);

  const update = (i: number, patch: Partial<HoursRule>) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api(`warehouses/${details.warehouseId}/hours`, json("PUT", { hours: rules, lastOrderMinutesBeforeClose: Number(lastOrder), afterHoursMode: after }));
      setMsg({ kind: "ok", text: "Opening hours saved. Customers see the change straight away." }); onSaved();
    } catch (cause) { setMsg({ kind: "error", text: problem(cause) }); } finally { setBusy(false); }
  }

  return (
    <form className="admin-panel" onSubmit={e => void save(e)} aria-labelledby="hours-title">
      <div className="admin-panel-toolbar"><h2 id="hours-title">Opening hours</h2><span>Indian time</span></div>
      <div style={{ padding: "0 20px 18px", display: "grid", gap: 12 }}>
        {!details.configured && <Notice kind="info">No opening hours have been saved for this warehouse yet, so it follows its basic open/closed switch. Add hours below to control exactly when it takes orders.</Notice>}
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        {rules.map((rule, i) => (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", padding: "10px 12px", border: "1px solid var(--admin-border)", borderRadius: 8 }}>
            <div role="group" aria-label={`Days for block ${i + 1}`} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {DAYS.map((d, n) => <label key={d} style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" disabled={!canEdit} checked={rule.days.includes(n)} onChange={() => update(i, { days: rule.days.includes(n) ? rule.days.filter(x => x !== n) : [...rule.days, n].sort() })} />{d}</label>)}
            </div>
            <Field label="Opens"><input type="time" required disabled={!canEdit} value={rule.open} onChange={e => update(i, { open: e.target.value })} style={inputStyle} /></Field>
            <Field label="Closes"><input type="time" required disabled={!canEdit} value={rule.close} onChange={e => update(i, { close: e.target.value })} style={inputStyle} /></Field>
            {canEdit && <button type="button" className="admin-text-button" onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {canEdit && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="admin-text-button" onClick={() => setRules(rs => [...rs, { days: EVERY_DAY, open: "07:00", close: "20:00" }])}>Add opening hours</button>
          {rules.length === 0 && <button type="button" className="admin-text-button" onClick={() => setRules([{ days: EVERY_DAY, open: "07:00", close: "20:00" }])}>Use 7 AM to 8 PM every day</button>}
        </div>}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Field label="Stop taking orders this many minutes before closing"><input type="number" min={0} max={240} step={1} disabled={!canEdit} value={lastOrder} onChange={e => setLastOrder(e.target.value)} style={{ ...inputStyle, width: 120 }} /></Field>
          <Field label="Outside opening hours"><select disabled={!canEdit} value={after} onChange={e => setAfter(e.target.value as typeof after)} style={inputStyle}><option value="closed">Show &ldquo;closed&rdquo;</option><option value="pre_order">Let customers pre-order for the next morning</option></select></Field>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--admin-muted)" }}>For late-night delivery, set a later closing time here and add a late-night fee under Delivery fees &amp; surcharges.</p>
        {canEdit && <div><button className="admin-role-button" disabled={busy}>{busy ? "Saving…" : "Save opening hours"}</button></div>}
      </div>
    </form>
  );
}

function PreOrderCard({ details, canEdit, onSaved }: { details: Details; canEdit: boolean; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(details.preOrder.enabled);
  const [slots, setSlots] = useState<Slot[]>(details.preOrder.slots);
  const [cutoff, setCutoff] = useState(String(details.preOrder.cutoffMinutesBeforeSlot));
  const [lead, setLead] = useState(String(details.preOrder.packLeadMinutes));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { setEnabled(details.preOrder.enabled); setSlots(details.preOrder.slots); setCutoff(String(details.preOrder.cutoffMinutesBeforeSlot)); setLead(String(details.preOrder.packLeadMinutes)); setMsg(null); }, [details]);

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api(`warehouses/${details.warehouseId}/preorder`, json("PUT", { enabled, slots, cutoffMinutesBeforeSlot: Number(cutoff), packLeadMinutes: Number(lead) }));
      setMsg({ kind: "ok", text: "Pre-order settings saved." }); onSaved();
    } catch (cause) { setMsg({ kind: "error", text: problem(cause) }); } finally { setBusy(false); }
  }
  const update = (i: number, patch: Partial<Slot>) => setSlots(ss => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form className="admin-panel" onSubmit={e => void save(e)} aria-labelledby="pre-title">
      <div className="admin-panel-toolbar"><h2 id="pre-title">Pre-order slots</h2><Badge tone={details.preOrder.enabled ? "active" : "inactive"}>{details.preOrder.enabled ? "On" : "Off"}</Badge></div>
      <div style={{ padding: "0 20px 18px", display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--admin-muted)" }}>When the store is closed, customers can book a delivery window for the next morning. Slots need &ldquo;Let customers pre-order&rdquo; selected under Opening hours.</p>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" disabled={!canEdit} checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Accept pre-orders at this warehouse</label>
        {slots.map((slot, i) => (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
            <Field label="Slot starts"><input type="time" required disabled={!canEdit} value={slot.start} onChange={e => update(i, { start: e.target.value })} style={inputStyle} /></Field>
            <Field label="Slot ends"><input type="time" required disabled={!canEdit} value={slot.end} onChange={e => update(i, { end: e.target.value })} style={inputStyle} /></Field>
            <Field label="Orders it can take"><input type="number" min={1} max={1000} required disabled={!canEdit} value={slot.capacity} onChange={e => update(i, { capacity: Number(e.target.value) })} style={{ ...inputStyle, width: 100 }} /></Field>
            {canEdit && <button type="button" className="admin-text-button" onClick={() => setSlots(ss => ss.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {canEdit && <div><button type="button" className="admin-text-button" onClick={() => setSlots(ss => [...ss, ss.length ? { start: ss.at(-1)!.end, end: ss.at(-1)!.end, capacity: 20 } : { start: "07:00", end: "09:00", capacity: 20 }])}>Add a slot</button></div>}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Field label="Booking closes this many minutes before a slot"><input type="number" min={0} max={720} step={1} disabled={!canEdit} value={cutoff} onChange={e => setCutoff(e.target.value)} style={{ ...inputStyle, width: 120 }} /></Field>
          <Field label="Packing starts this many minutes before a slot"><input type="number" min={0} max={240} step={1} disabled={!canEdit} value={lead} onChange={e => setLead(e.target.value)} style={{ ...inputStyle, width: 120 }} /></Field>
        </div>
        {canEdit && <div><button className="admin-role-button" disabled={busy}>{busy ? "Saving…" : "Save pre-order settings"}</button></div>}
      </div>
    </form>
  );
}

function PauseCard({ details, canEdit, onSaved }: { details: Details; canEdit: boolean; onSaved: () => void }) {
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  async function pause(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api("ops/pause", json("POST", { scope: "warehouse", id: details.warehouseId, ...(message.trim() ? { message: message.trim() } : {}), ...(hours ? { until: new Date(Date.now() + Number(hours) * 3_600_000).toISOString() } : {}) }));
      setMsg({ kind: "ok", text: "Orders are paused at this warehouse." }); setMessage(""); setHours(""); onSaved();
    } catch (cause) { setMsg({ kind: "error", text: problem(cause) }); } finally { setBusy(false); }
  }
  async function resume() {
    setBusy(true); setMsg(null);
    try { await api("ops/resume", json("POST", { scope: "warehouse", id: details.warehouseId })); setMsg({ kind: "ok", text: "Orders are open again." }); onSaved(); }
    catch (cause) { setMsg({ kind: "error", text: problem(cause) }); } finally { setBusy(false); }
  }
  return (
    <section className="admin-panel" aria-labelledby="pause-title">
      <div className="admin-panel-toolbar"><h2 id="pause-title">Pause orders</h2><Badge tone={details.pause ? "disabled" : "active"}>{details.pause ? "Paused" : "Taking orders"}</Badge></div>
      <div style={{ padding: "0 20px 16px", display: "grid", gap: 10, fontSize: 12 }}>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        {details.pause ? (
          <>
            <span>Customers see: <strong>{details.pause.message ?? "Deliveries are paused for now"}</strong>{details.pause.until ? <> · ends by itself {dateTime(details.pause.until)}</> : <> · stays paused until you resume</>}</span>
            {canEdit && <div><button className="admin-role-button" disabled={busy} onClick={() => void resume()}>Resume orders</button></div>}
          </>
        ) : canEdit ? (
          <form onSubmit={e => void pause(e)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <Field label="Message customers see (optional)"><input value={message} onChange={e => setMessage(e.target.value)} maxLength={300} placeholder="Road blocked at Chowrasta" style={{ ...inputStyle, width: 280 }} /></Field>
            <Field label="Pause for (hours, empty = until I resume)"><input type="number" min={1} max={72} step={1} value={hours} onChange={e => setHours(e.target.value)} style={{ ...inputStyle, width: 110 }} /></Field>
            <button className="admin-role-button" disabled={busy}>Pause orders</button>
          </form>
        ) : <Notice kind="info">Pausing needs the &ldquo;ops mode&rdquo; permission.</Notice>}
        <span style={{ color: "var(--admin-muted)" }}>While paused, customers can still browse but cannot order from this warehouse.</span>
      </div>
    </section>
  );
}

export default function Hours({ session }: { session: AdminSession }) {
  const permissions = session.user.permissions;
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { if (!warehouseId && warehouses[0]) setWarehouseId(warehouses[0].id); }, [warehouses, warehouseId]);
  useEffect(() => {
    if (!warehouseId) return;
    let active = true;
    setLoading(true); setError("");
    void api<{ data: Details }>(`warehouses/${warehouseId}/hours`).then(r => { if (active) setDetails(r.data); }, cause => { if (active) { setDetails(null); setError(errorText(cause)); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [warehouseId, tick]);

  if (warehouses.length === 0) return <Notice kind="info">Add a warehouse first (Warehouses), then set its hours here.</Notice>;
  const canEdit = can(permissions, "warehouses:manage");
  const refresh = () => setTick(n => n + 1);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Warehouse{" "}
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={inputStyle}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </label>
      {error && <Notice>{error}</Notice>}
      {loading && !details && <p role="status" style={{ fontSize: 12 }}>Loading…</p>}
      {details && details.warehouseId === warehouseId && (
        <>
          {!canEdit && <Notice kind="info">You can view these settings but not change them.</Notice>}
          <HoursCard details={details} canEdit={canEdit} onSaved={refresh} />
          <PreOrderCard details={details} canEdit={canEdit} onSaved={refresh} />
          <PauseCard details={details} canEdit={can(permissions, "ops_mode:manage")} onSaved={refresh} />
        </>
      )}
    </div>
  );
}
