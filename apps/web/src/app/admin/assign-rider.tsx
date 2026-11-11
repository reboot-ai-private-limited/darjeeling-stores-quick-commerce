"use client";

import { useEffect, useState } from "react";
import { api, errorText, json } from "./admin-kit";

type Suggested = { riderId: string; name: string; activeOrders: number; distanceMeters: number | null };
type Ineligible = { riderId: string; name: string; reasons: string[] };
type Mode = "assign" | "reassign" | "handover";

const WHY: Record<string, string> = {
  offline: "offline or not on shift", on_break: "on a break", wrong_zone: "in another delivery area", wrong_warehouse: "not at this store",
  at_capacity: "has the most orders allowed", stale_location: "location not updating",
};
const km = (m: number | null) => (m === null ? "" : m < 1000 ? ` · ${Math.round(m / 10) * 10} m` : ` · ${(m / 1000).toFixed(1)} km`);

/** Statuses in which the rider already has the goods, so changing the rider is a hand-over that needs a reason. */
const PICKED_UP = ["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"];

/**
 * Picks a rider for one order. The best rider is already chosen, so giving the order to them is one click.
 * `assign`: a Ready order. `reassign`: assigned, not picked up yet. `handover`: already picked up (a reason is required).
 * `compact` fits it in a table row; otherwise it fills the order panel and explains why nobody is available.
 */
function RiderPicker({ orderId, mode, compact = false, onDone, onCancel }: { orderId: string; mode: Mode; compact?: boolean; onDone: () => void; onCancel?: () => void }) {
  const [riders, setRiders] = useState<Suggested[] | null>(null);
  const [out, setOut] = useState<Ineligible[]>([]);
  const [riderId, setRiderId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let live = true;
    setRiders(null); setError("");
    api<{ data: { suggested: Suggested[]; ineligible: Ineligible[] } }>(`dispatch/suggestions?orderId=${encodeURIComponent(orderId)}`)
      .then(r => { if (!live) return; setRiders(r.data.suggested); setOut(r.data.ineligible); setRiderId(r.data.suggested[0]?.riderId ?? ""); })
      .catch(e => { if (!live) return; if ((e as { status?: number }).status === 403) setDenied(true); else setError(errorText(e, "Could not load riders.")); setRiders([]); });
    return () => { live = false; };
  }, [orderId]);

  if (denied) return null; // this staff member cannot dispatch
  if (riders === null) return <small style={{ color: "var(--admin-muted)" }}>Finding riders…</small>;

  const chosen = riders.find(r => r.riderId === riderId);
  const needsReason = mode === "handover";
  async function go() {
    if (!chosen) return;
    if (needsReason && !reason.trim()) { setError("Say why the order is changing hands."); return; }
    setBusy(true); setError("");
    try {
      if (mode === "assign") await api(`orders/${orderId}/assign`, json("POST", { riderId: chosen.riderId }));
      else if (mode === "reassign") await api(`orders/${orderId}/reassign`, json("POST", { toRiderId: chosen.riderId, ...(reason.trim() && { reason: reason.trim() }) }));
      else await api(`orders/${orderId}/handover`, json("POST", { toRiderId: chosen.riderId, reason: reason.trim() }));
      onDone();
    } catch (e) { setError(errorText(e, "Could not change the rider.")); }
    finally { setBusy(false); }
  }

  if (riders.length === 0) {
    const text = mode === "assign" ? "No rider can take this order right now." : "No other rider can take this order right now.";
    return compact
      ? <small style={{ color: "#b06000" }} title={out.map(i => `${i.name}: ${i.reasons.map(r => WHY[r] ?? r).join(", ")}`).join("\n")}>No rider available</small>
      : (
        <div style={{ background: "#fff7e0", borderRadius: 8, padding: "10px 12px", fontSize: 15 }}>
          <strong>{text}</strong>
          {out.length === 0 ? <div>No other riders are set up for this store.</div>
            : <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{out.map(i => <li key={i.riderId}>{i.name}: {i.reasons.map(r => WHY[r] ?? r).join(", ")}</li>)}</ul>}
          {error && <div role="alert" className="admin-role-error">{error}</div>}
          {onCancel && <button type="button" className="admin-text-button" onClick={onCancel}>Close</button>}
        </div>
      );
  }

  const verb = mode === "assign" ? "Assign to" : mode === "reassign" ? "Move to" : "Hand over to";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} onClick={e => e.stopPropagation()}>
      <select aria-label="Choose a rider" value={riderId} disabled={busy} onChange={e => setRiderId(e.target.value)}
        style={{ minHeight: compact ? 32 : 40, padding: "4px 8px", border: "1px solid #cbc5ba", borderRadius: 8, font: "inherit", fontSize: compact ? 12 : 13, maxWidth: compact ? 170 : undefined }}>
        {riders.map((r, i) => <option key={r.riderId} value={r.riderId}>{r.name}{i === 0 ? " (best)" : ""} · {r.activeOrders} active{km(r.distanceMeters)}</option>)}
      </select>
      {mode !== "assign" && (
        <input
          aria-label={needsReason ? "Reason for the hand-over" : "Reason (optional)"} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} maxLength={300}
          placeholder={needsReason ? "Why? (required) e.g. scooter breakdown" : "Reason (optional)"}
          style={{ minHeight: compact ? 32 : 40, padding: "4px 8px", border: "1px solid #cbc5ba", borderRadius: 8, font: "inherit", fontSize: compact ? 12 : 13, flex: compact ? "0 1 170px" : "1 1 220px" }}
        />
      )}
      <button className="admin-role-button" style={compact ? { minHeight: 32, padding: "4px 10px" } : { minHeight: 40 }} disabled={busy} onClick={() => void go()}>
        {busy ? "Saving…" : `${verb} ${chosen?.name.split(" ")[0] ?? "rider"}`}
      </button>
      {onCancel && <button type="button" className="admin-text-button" disabled={busy} onClick={onCancel}>Cancel</button>}
      {error && <span role="alert" style={{ color: "#b3261e", fontSize: 14 }}>{error}</span>}
    </div>
  );
}

/** For a Ready order: pick a rider and assign in one click. */
export function AssignRider({ orderId, compact = false, onAssigned }: { orderId: string; compact?: boolean; onAssigned: () => void }) {
  return <RiderPicker orderId={orderId} mode="assign" compact={compact} onDone={onAssigned} />;
}

/**
 * For an order that already has a rider: shows who, with a button to change them.
 * Before pickup the order simply moves to the new rider; after pickup it is a hand-over and a reason is required.
 */
export function ChangeRider({ orderId, status, riderName, compact = false, onChanged }: { orderId: string; status: string; riderName?: string | null | undefined; compact?: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const mode: Mode = PICKED_UP.includes(status) ? "handover" : "reassign";
  const label = mode === "handover" ? "Hand over…" : "Change rider";
  if (open) return <RiderPicker orderId={orderId} mode={mode} compact={compact} onDone={() => { setOpen(false); onChanged(); }} onCancel={() => setOpen(false)} />;
  return compact
    ? <button type="button" className="admin-text-button" style={{ minHeight: 30, padding: "4px 10px" }} onClick={e => { e.stopPropagation(); setOpen(true); }}>{label}</button>
    : (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <span>Rider: <strong>{riderName ?? "—"}</strong></span>
        <button type="button" className="admin-text-button" onClick={() => setOpen(true)}>{mode === "handover" ? "Hand over to another rider" : "Change rider"}</button>
      </div>
    );
}
