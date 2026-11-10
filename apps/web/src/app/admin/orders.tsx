"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ago, api, Badge, can, dateTime, errorText, Field, Heading, inputStyle, json, money, Notice, Tabs, timeOnly, usePolling, useWarehouses } from "./admin-kit";
import type { AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type Status = "PENDING_PAYMENT" | "PLACED" | "CONFIRMED" | "PACKING" | "READY" | "ASSIGNED" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "ARRIVED" | "DELIVERED" | "FAILED_DELIVERY" | "CANCELLED";
const STATUSES: Status[] = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED", "FAILED_DELIVERY", "CANCELLED"];
const LABEL: Record<Status, string> = {
  PENDING_PAYMENT: "Awaiting payment", PLACED: "New", CONFIRMED: "Confirmed", PACKING: "Packing", READY: "Ready", ASSIGNED: "Rider assigned", PICKED_UP: "Picked up",
  OUT_FOR_DELIVERY: "On the way", ARRIVED: "At the door", DELIVERED: "Delivered", FAILED_DELIVERY: "Delivery failed", CANCELLED: "Cancelled",
};
const TERMINAL: Status[] = ["DELIVERED", "CANCELLED"];
const CANCELLABLE: Status[] = ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED"];
const EDITABLE_LINES: Status[] = ["PLACED", "CONFIRMED", "PACKING", "READY"];
const CHARGE_LABEL: Record<string, string> = { delivery_fee: "Delivery fee", surcharge_rain: "Rain surcharge", surcharge_late_night: "Late-night fee", surcharge_other: "Surcharge", tip: "Rider tip" };

type OrderItem = { index: number; name: string; variantLabel: string; qty: number; unitPrice: number; lineTotal: number; status: "ok" | "unavailable" | "reduced"; unavailableReason?: string };
type AdminOrder = {
  id: string; orderNo: string; groupId: string; warehouse: { id: string; name: string }; status: Status; paymentMethod: "cod" | "online"; paymentStatus: string; refundStatus: string;
  customer: { id: string; name: string; phone: string };
  address: { line1: string; landmark: string; locality: string; contactName: string; contactPhone: string; location: { lat: number; lng: number }; deliveryNotes: string | null };
  items: OrderItem[]; itemsSubtotal: number; allocatedDiscount: number; allocatedCharges: { type: string; amount: number }[]; amountDue: number;
  rider: { id: string; name: string } | null; promisedAt: string; scheduledWindow: { start: string; end: string } | null; isPreOrder: boolean;
  notes: { text: string; by: string; at: string }[];
  timeline: { type: string; from: Status | null; to: Status | null; actor: { role: string; name: string | null }; at: string; meta?: Record<string, unknown> }[];
  delivery: unknown; collection: { method: string; amount: number; at: string } | null; createdAt: string;
};
type Change = { event: string; order: { id: string } };

const orderTotal = (o: AdminOrder) => o.itemsSubtotal - o.allocatedDiscount + o.allocatedCharges.reduce((sum, c) => sum + c.amount, 0);
const tone = (s: Status) => (s === "DELIVERED" ? "active" : s === "CANCELLED" || s === "FAILED_DELIVERY" ? "disabled" : s === "PENDING_PAYMENT" || s === "PLACED" ? "paused" : "enabled") as "active" | "disabled" | "paused" | "enabled";
const isLate = (o: AdminOrder, now = Date.now()) => !TERMINAL.includes(o.status) && !o.isPreOrder && o.status !== "PENDING_PAYMENT" && new Date(o.promisedAt).getTime() < now;

type TabKey = "active" | "action" | "preorders" | "delivered" | "closed" | "all";
const TABS: { key: TabKey; label: string; statuses?: Status[]; preOrder?: boolean }[] = [
  { key: "active", label: "Active", statuses: ["PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"] },
  { key: "action", label: "In the store", statuses: ["PLACED", "CONFIRMED", "PACKING", "READY"] },
  { key: "preorders", label: "Pre-orders", preOrder: true },
  { key: "delivered", label: "Delivered", statuses: ["DELIVERED"] },
  { key: "closed", label: "Cancelled & failed", statuses: ["CANCELLED", "FAILED_DELIVERY"] },
  { key: "all", label: "All" },
];

// ─── Order detail ────────────────────────────────────────────────────────────

function OrderDetail({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { data: order, error, reload, loading } = usePolling<AdminOrder>(async () => (await api<{ data: AdminOrder }>(`orders/${id}`)).data, 10_000, [id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [panel, setPanel] = useState<"" | "cancel" | "force" | "note">("");
  const [reason, setReason] = useState("");
  const [forceTo, setForceTo] = useState<Status>("READY");
  const [note, setNote] = useState("");
  const [lineForm, setLineForm] = useState<{ index: number; mode: "unavailable" | "reduce" } | null>(null);
  const [lineReason, setLineReason] = useState("Out of stock");
  const [lineQty, setLineQty] = useState("");

  useEffect(() => { setPanel(""); setLineForm(null); setMessage(null); setReason(""); setNote(""); }, [id]);

  async function run(label: string, call: () => Promise<unknown>, after?: () => void) {
    setBusy(true); setMessage(null);
    try { await call(); setMessage({ kind: "ok", text: `${label} done.` }); after?.(); reload(); onChanged(); }
    catch (cause) { setMessage({ kind: "error", text: errorText(cause) }); }
    finally { setBusy(false); }
  }
  const post = (path: string, body?: unknown) => api(`orders/${id}/${path}`, json("POST", body ?? {}));

  if (!order) return <section className="admin-panel" style={{ padding: 20 }}>{error ? <Notice>{error}</Notice> : <p role="status" style={{ fontSize: 12 }}>Loading order…</p>}</section>;

  const total = orderTotal(order);
  const step: { label: string; path: string } | null = order.status === "PLACED" ? { label: "Confirm order", path: "confirm" }
    : order.status === "CONFIRMED" ? { label: "Start packing", path: "start-packing" }
      : order.status === "PACKING" ? { label: "Packing done", path: "complete-packing" } : null;
  const late = isLate(order);

  return (
    <section className="admin-panel" aria-label={`Order ${order.orderNo}`} style={{ position: "sticky", top: 12 }}>
      <div className="admin-panel-toolbar">
        <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}>#{order.orderNo} <Badge tone={tone(order.status)}>{LABEL[order.status]}</Badge></h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="admin-text-button" onClick={reload} disabled={loading}>Refresh</button>
          <button className="admin-text-button" onClick={onClose} aria-label="Close order">Close</button>
        </div>
      </div>
      <div style={{ padding: "4px 20px 20px", display: "grid", gap: 14, fontSize: 12 }}>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        {late && <Notice>Promised for {timeOnly(order.promisedAt)} · {ago(order.promisedAt).replace(" ago", "")} late.</Notice>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, color: "var(--admin-muted)" }}>
          <span>{order.warehouse.name}</span><span>·</span><span>Placed {dateTime(order.createdAt)}</span><span>·</span>
          <span>{order.isPreOrder && order.scheduledWindow ? `Slot ${timeOnly(order.scheduledWindow.start)}–${timeOnly(order.scheduledWindow.end)}` : `Promised ${timeOnly(order.promisedAt)}`}</span>
        </div>

        {canManage && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {step && <button className="admin-role-button" disabled={busy} onClick={() => run(step.label, () => post(step.path))}>{step.label}</button>}
            <button className="admin-text-button" onClick={() => setPanel(panel === "note" ? "" : "note")}>Add note</button>
            {CANCELLABLE.includes(order.status) && <button className="admin-text-button" style={{ color: "#b3261e" }} onClick={() => setPanel(panel === "cancel" ? "" : "cancel")}>Cancel order</button>}
            <button className="admin-text-button" onClick={() => setPanel(panel === "force" ? "" : "force")}>Fix status…</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <a className="admin-text-button" href={`/api/v1/admin/orders/${order.id}/print?type=slip`} target="_blank" rel="noreferrer">Print packing slip</a>
          <a className="admin-text-button" href={`/api/v1/admin/orders/${order.id}/print?type=bill`} target="_blank" rel="noreferrer">Print bill</a>
        </div>

        {panel === "note" && (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run("Note added", () => post("notes", { text: note }), () => { setNote(""); setPanel(""); }); }} style={{ display: "grid", gap: 8 }}>
            <Field label="Internal note (staff only)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} required style={inputStyle} /></Field>
            <button className="admin-role-button" disabled={busy || !note.trim()} style={{ justifySelf: "start" }}>Save note</button>
          </form>
        )}
        {panel === "cancel" && (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run("Order cancelled", () => post("cancel", { reason }), () => { setPanel(""); setReason(""); }); }} style={{ display: "grid", gap: 8, padding: 12, border: "1px solid #f0c9c4", borderRadius: 8, background: "#fdf7f6" }}>
            <strong>Cancel this order?</strong>
            <span style={{ color: "var(--admin-muted)" }}>Stock is put back{order.paymentMethod === "online" && order.paymentStatus === "paid" ? ", the customer is refunded" : ""}, and an assigned rider is told. The customer is notified.</span>
            <Field label="Reason (the customer may see this)"><input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} required style={inputStyle} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="admin-role-button" disabled={busy || !reason.trim()} style={{ background: "#b3261e", borderColor: "#b3261e" }}>Yes, cancel order</button>
              <button type="button" className="admin-text-button" onClick={() => setPanel("")}>Keep order</button>
            </div>
          </form>
        )}
        {panel === "force" && (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run("Status changed", () => post("force-status", { to: forceTo, reason }), () => { setPanel(""); setReason(""); }); }} style={{ display: "grid", gap: 8, padding: 12, border: "1px solid var(--admin-border)", borderRadius: 8 }}>
            <strong>Fix the status</strong>
            <span style={{ color: "var(--admin-muted)" }}>Use only when the real situation and the order disagree (for example it was packed but not marked). This is recorded in the audit log.</span>
            <Field label="Set status to"><select value={forceTo} onChange={e => setForceTo(e.target.value as Status)} style={inputStyle}>{STATUSES.map(s => <option key={s} value={s}>{LABEL[s]}</option>)}</select></Field>
            <Field label="Why"><input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} required style={inputStyle} /></Field>
            <button className="admin-role-button" disabled={busy || !reason.trim()} style={{ justifySelf: "start" }}>Change status</button>
          </form>
        )}

        <div style={{ display: "grid", gap: 2 }}>
          <strong>{order.customer.name || "Customer"}</strong>
          <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
          <span>{order.address.line1}{order.address.landmark ? `, near ${order.address.landmark}` : ""}</span>
          <span>{order.address.locality}</span>
          {order.address.deliveryNotes && <span style={{ color: "#8a5a00" }}>Note: {order.address.deliveryNotes}</span>}
          <a href={`https://www.google.com/maps?q=${order.address.location.lat},${order.address.location.lng}`} target="_blank" rel="noreferrer">Open in maps</a>
          {order.rider && <span>Rider: <strong>{order.rider.name}</strong></span>}
        </div>

        <table className="admin-product-table" style={{ width: "100%" }}>
          <thead><tr><th>Item</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Total</th>{canManage && <th />}</tr></thead>
          <tbody>
            {order.items.map(item => {
              const open = lineForm?.index === item.index;
              return (
                <tr key={item.index} style={item.status === "unavailable" ? { opacity: 0.55 } : undefined}>
                  <td>
                    {item.name}<br /><small style={{ color: "var(--admin-muted)" }}>{item.variantLabel}{item.status !== "ok" ? ` · ${item.status === "unavailable" ? "removed" : "reduced"}${item.unavailableReason ? ` (${item.unavailableReason})` : ""}` : ""}</small>
                    {open && lineForm && (
                      <form onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        const body = lineForm.mode === "unavailable" ? { reason: lineReason, ...(lineQty.trim() ? { availableQty: Number(lineQty) } : {}) } : { qty: Number(lineQty) };
                        void run(lineForm.mode === "unavailable" ? "Item updated" : "Quantity changed", () => (lineForm.mode === "unavailable"
                          ? post(`items/${item.index}/unavailable`, body) : api(`orders/${id}/items/${item.index}`, json("PUT", body))), () => { setLineForm(null); setLineQty(""); });
                      }} style={{ display: "grid", gap: 6, marginTop: 8 }}>
                        {lineForm.mode === "unavailable" && (
                          <Field label="Reason"><select value={lineReason} onChange={e => setLineReason(e.target.value)} style={inputStyle}>{["Out of stock", "Damaged", "Poor quality", "Other"].map(r => <option key={r}>{r}</option>)}</select></Field>
                        )}
                        <Field label={lineForm.mode === "unavailable" ? "Quantity still available (leave empty to remove the item)" : "New quantity"}>
                          <input type="number" min={lineForm.mode === "unavailable" ? 0 : 1} max={item.qty - 1} step={1} value={lineQty} onChange={e => setLineQty(e.target.value)} required={lineForm.mode === "reduce"} style={inputStyle} />
                        </Field>
                        <span style={{ color: "var(--admin-muted)" }}>The customer is told. Prepaid orders are refunded the difference; cash orders owe less. The delivery fee does not change.</span>
                        <div style={{ display: "flex", gap: 8 }}><button className="admin-role-button" disabled={busy}>Apply</button><button type="button" className="admin-text-button" onClick={() => setLineForm(null)}>Back</button></div>
                      </form>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{item.qty}</td>
                  <td style={{ textAlign: "right" }}>{money(item.lineTotal)}</td>
                  {canManage && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {EDITABLE_LINES.includes(order.status) && item.status !== "unavailable" && !open && (
                        <>
                          <button className="admin-text-button" onClick={() => { setLineForm({ index: item.index, mode: "unavailable" }); setLineQty(""); }}>Missing</button>
                          {item.qty > 1 && <button className="admin-text-button" onClick={() => { setLineForm({ index: item.index, mode: "reduce" }); setLineQty(String(item.qty - 1)); }}>Reduce</button>}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
          <span>Items {money(order.itemsSubtotal)}</span>
          {order.allocatedDiscount > 0 && <span>Discount −{money(order.allocatedDiscount)}</span>}
          {order.allocatedCharges.map((c, i) => <span key={i}>{CHARGE_LABEL[c.type] ?? c.type} {money(c.amount)}{c.type === "tip" ? " (goes to the rider)" : ""}</span>)}
          <strong style={{ fontSize: 14 }}>Total {money(total)}</strong>
          <span style={{ color: "var(--admin-muted)" }}>
            {order.paymentMethod === "cod" ? `Cash on delivery · ${order.amountDue > 0 ? `${money(order.amountDue)} to collect` : "nothing to collect"}` : "Paid online"} · {order.paymentStatus.replace(/_/g, " ")}
            {order.refundStatus !== "none" ? ` · refund ${order.refundStatus}` : ""}
          </span>
          {order.collection && <span style={{ color: "var(--admin-muted)" }}>Collected {money(order.collection.amount)} ({order.collection.method.replace(/_/g, " ")}) {ago(order.collection.at)}</span>}
        </div>

        {order.notes.length > 0 && (
          <div><strong>Notes</strong>{order.notes.map((n, i) => <p key={i} style={{ margin: "4px 0" }}>{n.text}<br /><small style={{ color: "var(--admin-muted)" }}>{n.by} · {dateTime(n.at)}</small></p>)}</div>
        )}
        <div>
          <strong>Timeline</strong>
          <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            {order.timeline.map((t, i) => (
              <li key={i}>
                {t.type === "status_change" && t.to ? LABEL[t.to] : t.type.replace(/_/g, " ")}
                <small style={{ color: "var(--admin-muted)" }}> · {t.actor.name ?? t.actor.role} · {dateTime(t.at)}{t.meta && "forced" in t.meta ? " · fixed by hand" : ""}</small>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ─── Orders screen ───────────────────────────────────────────────────────────

export default function Orders({ session }: { session: AdminSession }) {
  const permissions = session.user.permissions;
  const canView = can(permissions, "orders:view");
  const canManage = can(permissions, "orders:manage");
  const warehouses = useWarehouses();
  const [tab, setTab] = useState<TabKey>("active");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [more, setMore] = useState<AdminOrder[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [quickError, setQuickError] = useState("");

  const def = TABS.find(t => t.key === tab)!;
  const query = () => {
    const p = new URLSearchParams({ limit: "50" });
    if (def.statuses) p.set("status", def.statuses.join(","));
    if (def.preOrder) p.set("isPreOrder", "true");
    if (search) p.set("q", search);
    if (warehouseId) p.set("warehouseId", warehouseId);
    if (from) p.set("from", new Date(`${from}T00:00:00+05:30`).toISOString());
    if (to) p.set("to", new Date(`${to}T23:59:59+05:30`).toISOString());
    if (flagged) p.set("flagged", "true");
    return p;
  };
  const key = [tab, search, warehouseId, from, to, flagged];
  const list = usePolling<{ data: AdminOrder[]; meta: { nextCursor: string | null } }>(
    async () => (canView ? await api(`orders?${query()}`) : { data: [], meta: { nextCursor: null } }), more.length > 0 ? 0 : 15_000, [...key, canView],
  );
  useEffect(() => { setMore([]); setMoreCursor(undefined); }, key); // eslint-disable-line react-hooks/exhaustive-deps

  // The bell: the changes feed tells us when something new arrives, so the list refreshes at once.
  const cursor = useRef<string | null>(null);
  const reloadRef = useRef(list.reload);
  reloadRef.current = list.reload;
  useEffect(() => {
    if (!canView) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await api<{ data: Change[]; meta: { cursor: string; newCount?: number } }>(`orders/changes${cursor.current ? `?since=${cursor.current}` : ""}`);
        if (!active) return;
        if (cursor.current && res.data.length > 0) { setFresh(n => n + res.data.filter(c => c.event === "created").length); reloadRef.current(); }
        cursor.current = res.meta.cursor;
      } catch { /* keep the last data; the list still refreshes on its own */ }
    };
    void poll();
    const timer = setInterval(poll, 8_000);
    return () => { active = false; clearInterval(timer); };
  }, [canView]);

  if (!canView) return <><Heading title="Orders" subtitle="Orders and packing." /><Notice kind="info">Your role does not include orders.</Notice></>;

  const rows = [...(list.data?.data ?? []), ...more];
  const next = moreCursor === undefined ? list.data?.meta.nextCursor ?? null : moreCursor;
  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try { const p = query(); p.set("cursor", next); const res = await api<{ data: AdminOrder[]; meta: { nextCursor: string | null } }>(`orders?${p}`); setMore(m => [...m, ...res.data]); setMoreCursor(res.meta.nextCursor); }
    catch { /* the button stays; try again */ }
    finally { setLoadingMore(false); }
  }
  const nextAction = (o: AdminOrder) => (o.status === "PLACED" ? ["Confirm", "confirm"] : o.status === "CONFIRMED" ? ["Start packing", "start-packing"] : o.status === "PACKING" ? ["Packing done", "complete-packing"] : null) as [string, string] | null;
  async function quick(o: AdminOrder, path: string) {
    setQuickError("");
    try { await api(`orders/${o.id}/${path}`, json("POST", {})); list.reload(); } catch (cause) { setQuickError(`#${o.orderNo}: ${errorText(cause)}`); }
  }

  return (
    <>
      <Heading title="Orders" subtitle="New orders appear here by themselves. Open one to pack, edit or cancel it.">
        {fresh > 0 && <button className="admin-role-button" onClick={() => { setFresh(0); list.reload(); }}>{fresh} new since you opened this</button>}
      </Heading>
      <Tabs label="Order groups" value={tab} onChange={k => { setTab(k); setSelected(null); }} tabs={TABS.map(t => ({ key: t.key, label: t.label }))} />

      <form className="admin-panel" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(q.trim()); }} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", padding: "12px 16px", marginBottom: 12 }}>
        <Field label="Search"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Order no, name or phone" style={{ ...inputStyle, width: 200 }} /></Field>
        {warehouses.length > 1 && <Field label="Warehouse"><select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={inputStyle}><option value="">All</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} /></Field>
        <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} /></Field>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, paddingBottom: 8 }}><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} /> Offline-delivery flags only</label>
        <button className="admin-role-button">Search</button>
        {(search || warehouseId || from || to || flagged) && <button type="button" className="admin-text-button" onClick={() => { setQ(""); setSearch(""); setWarehouseId(""); setFrom(""); setTo(""); setFlagged(false); }}>Clear</button>}
      </form>
      {list.error && <Notice>{list.error}</Notice>}
      {quickError && <Notice>{quickError}</Notice>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <section className="admin-panel" aria-label="Orders" style={{ flex: "1 1 520px", minWidth: 0 }}>
          <div className="admin-panel-toolbar"><h2>{def.label}</h2><span>{list.loading && !list.data ? "Loading…" : `${rows.length} shown${next ? "+" : ""}`}</span></div>
          {rows.length === 0 && !list.loading
            ? <p style={{ padding: "20px", margin: 0, fontSize: 12, color: "var(--admin-muted)" }}>No orders here{search ? " match your search" : " right now"}.</p>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="admin-product-table" style={{ width: "100%" }}>
                  <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th style={{ textAlign: "right" }}>Total</th><th>Time</th>{canManage && <th />}</tr></thead>
                  <tbody>
                    {rows.map(o => {
                      const act = nextAction(o);
                      const late = isLate(o);
                      return (
                        <tr key={o.id} onClick={() => setSelected(o.id)} style={{ cursor: "pointer", background: selected === o.id ? "#f6f4f1" : undefined }}>
                          <td><strong>#{o.orderNo}</strong><br /><small style={{ color: "var(--admin-muted)" }}>{o.warehouse.name}{o.isPreOrder ? " · pre-order" : ""}</small></td>
                          <td>{o.customer.name || o.customer.phone}<br /><small style={{ color: "var(--admin-muted)" }}>{o.address.locality} · {o.items.filter(i => i.status !== "unavailable").length} items</small></td>
                          <td><Badge tone={tone(o.status)}>{LABEL[o.status]}</Badge><br /><small style={{ color: "var(--admin-muted)" }}>{o.paymentMethod === "cod" ? "Cash" : "Online"}{o.rider ? ` · ${o.rider.name}` : ""}</small></td>
                          <td style={{ textAlign: "right" }}>{money(orderTotal(o))}</td>
                          <td style={late ? { color: "#b3261e" } : undefined}>{o.isPreOrder && o.scheduledWindow ? timeOnly(o.scheduledWindow.start) : TERMINAL.includes(o.status) ? ago(o.createdAt) : timeOnly(o.promisedAt)}{late ? <><br /><small>late</small></> : null}</td>
                          {canManage && <td onClick={e => e.stopPropagation()}>{act && <button className="admin-role-button" onClick={() => void quick(o, act[1])}>{act[0]}</button>}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          {next && <div style={{ padding: 12, textAlign: "center" }}><button className="admin-text-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Show more"}</button></div>}
        </section>

        {selected && (
          <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <OrderDetail id={selected} canManage={canManage} onClose={() => setSelected(null)} onChanged={list.reload} />
          </div>
        )}
      </div>
      <p style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 10 }}>The list refreshes every few seconds{more.length > 0 ? " (paused while older orders are shown)" : ""}. All times are Indian time.</p>
    </>
  );
}
