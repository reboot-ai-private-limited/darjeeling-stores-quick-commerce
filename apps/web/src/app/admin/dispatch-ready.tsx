"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./session-client";

type Suggested = { riderId: string; name: string; activeOrders: number; distanceMeters: number | null; score: number };
type Ineligible = { riderId: string; name: string; reasons: string[] };
type ReadyOrder = {
  orderId: string; orderNo: string; locality: string; landmark: string; customerName: string; itemCount: number;
  paymentMethod: "cod" | "online"; alreadyPaid: boolean; amountDue: number; readyAt: string | null; minutesWaiting: number;
  suggested: Suggested[]; ineligible: Ineligible[];
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "The request could not be completed.");
  return body as T;
}

/** Plain words for why a rider cannot take the order. */
const WHY: Record<string, string> = {
  offline: "offline or not on shift", on_break: "on a break", wrong_zone: "in another delivery area", wrong_warehouse: "not at this store",
  at_capacity: "already has the most orders allowed", stale_location: "location not updating (app closed?)",
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const km = (m: number | null) => (m === null ? "" : m < 1000 ? ` · ${Math.round(m / 10) * 10} m away` : ` · ${(m / 1000).toFixed(1)} km away`);

/** One screen to assign every ready order: the best rider is already chosen, so it is a single click. */
export function ReadyOrdersTab() {
  const [orders, setOrders] = useState<ReadyOrder[] | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const body = await call<{ data: ReadyOrder[] }>("dispatch/ready");
      setOrders(body.data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the ready orders.");
      setOrders(cur => cur ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function assign(o: ReadyOrder, riderId: string, riderName: string) {
    setBusy(o.orderId); setError(""); setNotice("");
    try {
      await call(`orders/${o.orderId}/assign`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" }, body: JSON.stringify({ riderId }) });
      setNotice(`${o.orderNo} assigned to ${riderName}. Their phone is ringing.`);
      setOrders(cur => (cur ?? []).filter(x => x.orderId !== o.orderId));
    } catch (e) {
      setError(`${o.orderNo}: ${e instanceof Error ? e.message : "Assignment failed."}`);
      void load();
    } finally { setBusy(null); }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-toolbar">
        <h2>Ready orders waiting for a rider</h2>
        <span>{orders ? `${orders.length} waiting` : "Loading…"} · refreshes every 15 seconds <button type="button" className="admin-text-button" onClick={() => void load()}>Refresh now</button></span>
      </div>
      {notice && <p role="status" style={{ color: "#137333", margin: "10px 20px 0", fontSize: 15 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ margin: "10px 20px 0" }}>{error}</p>}

      {orders === null && <p className="admin-roles-message" role="status">Loading ready orders…</p>}
      {orders?.length === 0 && <p className="admin-roles-message">No ready orders are waiting. New ones show up here by themselves.</p>}

      <div style={{ display: "grid", gap: 12, padding: 16 }}>
        {orders?.map(o => {
          const chosenId = picked[o.orderId] ?? o.suggested[0]?.riderId;
          const chosen = o.suggested.find(s => s.riderId === chosenId);
          const late = o.minutesWaiting >= 10 ? "#c62828" : o.minutesWaiting >= 5 ? "#b06000" : "#137333";
          return (
            <div key={o.orderId} style={{ border: "1px solid var(--admin-border)", borderRadius: 10, padding: 14, background: "#fff", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ fontSize: 18 }}>{o.orderNo}</strong>
                  <span style={{ marginLeft: 10, fontSize: 14, fontWeight: 700, color: late }}>Waiting {o.minutesWaiting} min</span>
                  <div style={{ fontSize: 15, color: "var(--admin-muted)", marginTop: 2 }}>
                    {o.customerName} · {o.landmark || o.locality}{o.landmark && o.locality ? `, ${o.locality}` : ""} · {o.itemCount} {o.itemCount === 1 ? "item" : "items"}
                  </div>
                </div>
                <span className={`admin-badge ${o.paymentMethod === "cod" && !o.alreadyPaid && o.amountDue > 0 ? "admin-badge-paused" : ""}`}>
                  {o.paymentMethod === "cod" && !o.alreadyPaid && o.amountDue > 0 ? `Collect ${rupees(o.amountDue)}` : "Paid online"}
                </span>
              </div>

              {o.suggested.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <select
                    aria-label={`Rider for ${o.orderNo}`} value={chosenId} disabled={busy === o.orderId}
                    onChange={e => setPicked(p => ({ ...p, [o.orderId]: e.target.value }))}
                    style={{ flex: "1 1 260px", minHeight: 42, padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 8, font: "inherit" }}
                  >
                    {o.suggested.map((s, i) => (
                      <option key={s.riderId} value={s.riderId}>{s.name}{i === 0 ? " (best match)" : ""} — {s.activeOrders} active{km(s.distanceMeters)}</option>
                    ))}
                  </select>
                  <button className="admin-role-button" style={{ minHeight: 42 }} disabled={busy !== null} onClick={() => chosen && void assign(o, chosen.riderId, chosen.name)}>
                    {busy === o.orderId ? "Assigning…" : `Assign to ${chosen?.name.split(" ")[0] ?? "rider"}`}
                  </button>
                </div>
              ) : (
                <div style={{ background: "#fff7e0", borderRadius: 8, padding: "10px 12px", fontSize: 15 }}>
                  <strong>No rider can take this right now.</strong>
                  {o.ineligible.length === 0
                    ? <div>No riders are set up for this store.</div>
                    : <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{o.ineligible.map(i => <li key={i.riderId}>{i.name}: {i.reasons.map(r => WHY[r] ?? r).join(", ")}</li>)}</ul>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
