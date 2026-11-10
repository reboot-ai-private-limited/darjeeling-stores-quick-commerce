"use client";

import { useState } from "react";
import { api, can, Heading, inputStyle, money, Notice, usePolling, useWarehouses } from "./admin-kit";
import type { AdminSession } from "./session-client";

type Dashboard = {
  date: string;
  orders: { today: number; active: number; delivered: number; cancelled: number };
  revenue: { today: number };
  riders: { online: number; onBreak: number; offline: number };
  pendingRefunds: number; lowStock: number; offlineDeliveryReviews: number; reconciliationOpen: number; riderCashOutstanding: number;
  unacknowledgedAssignments: number; delayedOrders: number;
  byWarehouse: { warehouseId: string; orders: number; revenue: number }[];
};

type Tone = "good" | "warn" | "bad" | "plain";
const TONES: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: "#f6f3ee", fg: "#1b6b3a" }, warn: { bg: "#fff6e5", fg: "#8a5a00" }, bad: { bg: "#fdf0ee", fg: "#b3261e" }, plain: { bg: "#fff", fg: "var(--admin-text)" },
};

function Tile({ label, value, note, tone = "plain", onClick }: { label: string; value: string | number; note?: string; tone?: Tone; onClick?: (() => void) | undefined }) {
  const colours = TONES[tone];
  const body = (
    <>
      <span style={{ fontSize: 11, color: "var(--admin-muted)", letterSpacing: 0.2 }}>{label}</span>
      <strong style={{ fontSize: 24, lineHeight: 1.1, color: colours.fg }}>{value}</strong>
      {note && <span style={{ fontSize: 11, color: "var(--admin-muted)" }}>{note}</span>}
    </>
  );
  const style = { display: "grid", gap: 4, padding: "14px 16px", border: "1px solid var(--admin-border)", borderRadius: 12, background: colours.bg, textAlign: "left" as const, font: "inherit" };
  return onClick
    ? <button type="button" onClick={onClick} style={{ ...style, cursor: "pointer" }}>{body}</button>
    : <div style={style}>{body}</div>;
}

export default function Overview({ session, onNavigate }: { session: AdminSession; onNavigate: (section: string) => void }) {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const allowed = can(session.user.permissions, "dashboard:view");
  const { data, error, loading, reload } = usePolling<Dashboard | null>(
    async () => (allowed ? (await api<{ data: Dashboard }>(`dashboard${warehouseId ? `?warehouseId=${warehouseId}` : ""}`)).data : null), 30_000, [warehouseId, allowed],
  );
  const nameOf = (id: string) => warehouses.find(w => w.id === id)?.name ?? `Warehouse …${id.slice(-4)}`;
  const go = (section: string, permission?: string) => (!permission || can(session.user.permissions, permission) ? () => onNavigate(section) : undefined);

  if (!allowed) {
    return <><Heading title="Overview" subtitle="Your store operations, in one place." /><Notice kind="info">Your role does not include the dashboard. Use the menu to open the sections you can access.</Notice></>;
  }

  return (
    <>
      <Heading title="Overview" subtitle={data ? `Today, ${new Date(`${data.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}` : "Your store operations, in one place."}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {warehouses.length > 1 && (
            <label className="admin-warehouse" style={{ display: "flex", gap: 8 }}>
              <span className="admin-sr-only">Warehouse</span>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={inputStyle} aria-label="Warehouse">
                <option value="">All warehouses</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          )}
          <button className="admin-text-button" onClick={reload} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </Heading>
      {error && <Notice>{error}</Notice>}

      {!data && loading && <p role="status" style={{ color: "var(--admin-muted)", fontSize: 12 }}>Loading today&apos;s numbers…</p>}
      {data && (
        <>
          <section aria-label="Today" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", marginBottom: 16 }}>
            <Tile label="Orders today" value={data.orders.today} note={`${data.orders.delivered} delivered · ${data.orders.cancelled} cancelled`} onClick={go("Orders", "orders:view")} />
            <Tile label="Active now" value={data.orders.active} note="Placed, packing or on the road" tone={data.orders.active > 0 ? "good" : "plain"} onClick={go("Orders", "orders:view")} />
            <Tile label="Revenue today" value={money(data.revenue.today)} note="Items and fees, tips excluded" />
            <Tile label="Delayed orders" value={data.delayedOrders} note="Past their promised time" tone={data.delayedOrders > 0 ? "bad" : "good"} onClick={go("Orders", "orders:view")} />
          </section>

          <h2 style={{ fontSize: 13, margin: "4px 0 8px" }}>Needs attention</h2>
          <section aria-label="Needs attention" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", marginBottom: 16 }}>
            <Tile label="Unacknowledged assignments" value={data.unacknowledgedAssignments} note="Riders yet to confirm" tone={data.unacknowledgedAssignments > 0 ? "bad" : "good"} onClick={go("Dispatch board", "dispatch:manage")} />
            <Tile label="Pending refunds" value={data.pendingRefunds} note="Waiting for a decision" tone={data.pendingRefunds > 0 ? "warn" : "good"} />
            <Tile label="Low stock items" value={data.lowStock} note="Below the low-stock level" tone={data.lowStock > 0 ? "warn" : "good"} onClick={go("Offerings & stock", "stock:view")} />
            <Tile label="Offline delivery reviews" value={data.offlineDeliveryReviews} note="Deliveries flagged for a check" tone={data.offlineDeliveryReviews > 0 ? "warn" : "good"} onClick={go("Cash & settlement", "cash:manage")} />
            <Tile label="Cash items to reconcile" value={data.reconciliationOpen} note="Open reconciliation items" tone={data.reconciliationOpen > 0 ? "warn" : "good"} onClick={go("Cash & settlement", "cash:manage")} />
            <Tile label="Rider cash outstanding" value={money(data.riderCashOutstanding)} note="Collected, not yet handed in" tone={data.riderCashOutstanding > 0 ? "warn" : "plain"} onClick={go("Cash & settlement", "cash:manage")} />
          </section>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", alignItems: "start" }}>
            <section className="admin-panel" aria-labelledby="ov-wh">
              <div className="admin-panel-toolbar"><h2 id="ov-wh">By warehouse</h2><span>Today</span></div>
              {data.byWarehouse.length === 0
                ? <p style={{ padding: "18px 20px", margin: 0, fontSize: 12, color: "var(--admin-muted)" }}>No orders yet today.</p>
                : (
                  <table className="admin-product-table">
                    <thead><tr><th>Warehouse</th><th style={{ textAlign: "right" }}>Orders</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead>
                    <tbody>{data.byWarehouse.map(row => (
                      <tr key={row.warehouseId}><td>{nameOf(row.warehouseId)}</td><td style={{ textAlign: "right" }}>{row.orders}</td><td style={{ textAlign: "right" }}>{money(row.revenue)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
            </section>

            <section className="admin-panel" aria-labelledby="ov-riders">
              <div className="admin-panel-toolbar"><h2 id="ov-riders">Riders</h2><span>Right now</span></div>
              <div style={{ display: "grid", gap: 10, padding: "14px 20px 18px", fontSize: 13 }}>
                {([["Online", data.riders.online, "#1b6b3a"], ["On a break", data.riders.onBreak, "#8a5a00"], ["Offline", data.riders.offline, "#716e68"]] as const).map(([label, value, colour]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: colour }} />{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
                {can(session.user.permissions, "riders:view") && <button className="admin-text-button" style={{ justifySelf: "start" }} onClick={() => onNavigate("Riders & fleet")}>Open riders &amp; fleet</button>}
              </div>
            </section>
          </div>
          <p style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 12 }}>Numbers refresh every 30 seconds. Revenue leaves out rider tips and orders that are cancelled or still waiting for payment.</p>
        </>
      )}
    </>
  );
}
