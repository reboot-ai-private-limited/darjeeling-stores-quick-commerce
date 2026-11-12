"use client";

import { useState } from "react";
import { api, can, inputStyle, money, Notice, usePolling, useWarehouses } from "./admin-kit";
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

const RED = "#b3261e";
const AMBER = "#8a5a00";

/** One number. Flat, with a hairline border; it goes red only when it needs someone. */
function Stat({ label, value, sub, colour, onClick }: { label: string; value: string | number; sub?: string; colour?: string | undefined; onClick?: (() => void) | undefined }) {
  const body = (
    <>
      <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>{label}</span>
      <strong style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.5, color: colour ?? "var(--admin-text)" }}>{value}</strong>
      {sub && <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>{sub}</span>}
    </>
  );
  const style = { display: "grid", gap: 6, padding: "16px 18px", border: "1px solid var(--admin-border)", borderRadius: 10, background: "#fff", textAlign: "left" as const, font: "inherit" };
  return onClick
    ? <button type="button" onClick={onClick} style={{ ...style, cursor: "pointer" }}>{body}</button>
    : <div style={style}>{body}</div>;
}

const dot = (colour: string) => <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: colour, flex: "0 0 auto" }} />;

export default function Overview({ session, onNavigate }: { session: AdminSession; onNavigate: (section: string) => void }) {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const allowed = can(session.user.permissions, "dashboard:view");
  const { data, error, loading, reload } = usePolling<Dashboard | null>(
    async () => (allowed ? (await api<{ data: Dashboard }>(`dashboard${warehouseId ? `?warehouseId=${warehouseId}` : ""}`)).data : null), 30_000, [warehouseId, allowed],
  );
  const nameOf = (id: string) => warehouses.find(w => w.id === id)?.name ?? `Warehouse …${id.slice(-4)}`;
  const go = (section: string, permission?: string) => (!permission || can(session.user.permissions, permission) ? () => onNavigate(section) : undefined);

  if (!allowed) return <Notice kind="info">Your role does not include the dashboard. Use the menu to open the sections you can access.</Notice>;

  const attention = data ? ([
    { label: "Delayed orders", value: data.delayedOrders, colour: RED, open: go("Orders", "orders:view") },
    { label: "Riders yet to confirm", value: data.unacknowledgedAssignments, colour: RED, open: go("Dispatch board", "dispatch:manage") },
    { label: "Pending refunds", value: data.pendingRefunds, colour: AMBER, open: undefined },
    { label: "Low stock items", value: data.lowStock, colour: AMBER, open: go("Offerings & stock", "stock:view") },
    { label: "Deliveries to review", value: data.offlineDeliveryReviews, colour: AMBER, open: go("Cash & settlement", "cash:manage") },
    { label: "Cash items to reconcile", value: data.reconciliationOpen, colour: AMBER, open: go("Cash & settlement", "cash:manage") },
    { label: "Rider cash to collect", value: money(data.riderCashOutstanding), count: data.riderCashOutstanding, colour: AMBER, open: go("Cash & settlement", "cash:manage") },
  ] as { label: string; value: string | number; count?: number; colour: string; open: (() => void) | undefined }[]) : [];

  const day = data ? new Date(`${data.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{day}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {warehouses.length > 1 && (
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={inputStyle} aria-label="Warehouse">
              <option value="">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <button className="admin-text-button" onClick={reload} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {!data && loading && <p role="status" style={{ color: "var(--admin-muted)", fontSize: 14 }}>Loading…</p>}

      {data && (
        <>
          <section aria-label="Today" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 12 }}>
            <Stat label="Orders today" value={data.orders.today} sub={`${data.orders.delivered} delivered · ${data.orders.cancelled} cancelled`} onClick={go("Orders", "orders:view")} />
            <Stat label="Active now" value={data.orders.active} sub="Placed, packing or on the road" onClick={go("Orders", "orders:view")} />
            <Stat label="Revenue today" value={money(data.revenue.today)} sub="Items and fees, tips excluded" />
            <Stat label="Delayed orders" value={data.delayedOrders} sub="Past their promised time" colour={data.delayedOrders > 0 ? RED : undefined} onClick={go("Orders", "orders:view")} />
          </section>
          <section aria-label="Riders" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 16 }}>
            <Stat label="Riders online" value={data.riders.online} colour={data.riders.online > 0 ? "#1b6b3a" : undefined} onClick={go("Riders & fleet", "riders:view")} />
            <Stat label="On a break" value={data.riders.onBreak} onClick={go("Riders & fleet", "riders:view")} />
            <Stat label="Offline" value={data.riders.offline} onClick={go("Riders & fleet", "riders:view")} />
            <Stat label="Rider cash to collect" value={money(data.riderCashOutstanding)} sub="Collected, not yet handed in" colour={data.riderCashOutstanding > 0 ? AMBER : undefined} onClick={go("Cash & settlement", "cash:manage")} />
          </section>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
            <section className="admin-panel" aria-labelledby="ov-attn">
              <div className="admin-panel-toolbar"><h2 id="ov-attn">Needs attention</h2></div>
              {attention.map((row, i) => {
                const none = (row.count ?? Number(row.value)) === 0;
                const inner = (
                  <>
                    <span style={{ display: "flex", gap: 10, alignItems: "center", color: none ? "var(--admin-muted)" : undefined }}>{dot(none ? "#cfcac2" : row.colour)}{row.label}</span>
                    <strong style={{ color: none ? "var(--admin-muted)" : row.colour, fontWeight: none ? 400 : 600 }}>{row.value}</strong>
                  </>
                );
                const style = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%", padding: "10px 20px", font: "inherit", fontSize: 14, textAlign: "left" as const, background: "none", border: 0, borderTop: "1px solid var(--admin-border)" };
                return row.open
                  ? <button key={row.label} type="button" onClick={row.open} style={{ ...style, cursor: "pointer" }}>{inner}</button>
                  : <div key={row.label} style={style}>{inner}</div>;
              })}
            </section>

            {data.byWarehouse.length > 0 && (
              <section className="admin-panel" aria-labelledby="ov-wh">
                <div className="admin-panel-toolbar"><h2 id="ov-wh">By warehouse</h2></div>
                <table className="admin-product-table">
                  <thead><tr><th>Warehouse</th><th style={{ textAlign: "right" }}>Orders</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead>
                  <tbody>{data.byWarehouse.map(row => (
                    <tr key={row.warehouseId}><td>{nameOf(row.warehouseId)}</td><td style={{ textAlign: "right" }}>{row.orders}</td><td style={{ textAlign: "right" }}>{money(row.revenue)}</td></tr>
                  ))}</tbody>
                </table>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
