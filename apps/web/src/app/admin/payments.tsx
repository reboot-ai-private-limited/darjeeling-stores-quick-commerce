"use client";

import { useState, type FormEvent } from "react";
import { api, Badge, can, dateTime, errorText, Field, Heading, inputStyle, json, money, Notice, Tabs, usePolling } from "./admin-kit";
import type { AdminSession } from "./session-client";

type RefundStatus = "requested" | "approved" | "done" | "rejected";
type Refund = {
  id: string; orderNo: string; amount: number; reason: string; source: string; status: RefundStatus; customerNote: string | null; rejectReason: string | null;
  method: string | null; reference: string | null; note: string | null; createdAt: string; markedDoneAt: string | null;
  customer: { name: string; phone: string }; paymentMethod: "cod" | "online";
};
type Payment = {
  id: string; groupNo: string | null; customerName: string | null; method: string; amount: number; status: string; razorpayOrderId: string | null;
  razorpayPaymentId: string | null; failureReason: string | null; capturedAt: string | null; flag?: string;
};
type Mismatch = { type: string; razorpayPaymentId?: string; paymentId?: string; amount?: number; expected?: number; actual?: number };
type Reconciliation = { date: string; matched: number; mismatches: Mismatch[] };

const words = (value: string) => value.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
const refundTone = (s: RefundStatus) => (s === "done" ? "active" : s === "rejected" ? "inactive" : "paused") as "active" | "inactive" | "paused";
const paymentTone = (s: string) => (s === "captured" || s === "cod_collected" ? "active" : s === "failed" ? "inactive" : "paused") as "active" | "inactive" | "paused";
const methodLabel = (m: string | null) => (m === "razorpay_api" ? "Razorpay (sent from here)" : m === "razorpay_dashboard" ? "Razorpay dashboard" : m ? words(m) : "—");
const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export default function PaymentsDesk({ session }: { session: AdminSession }) {
  const permissions = session.user.permissions;
  const canRefunds = can(permissions, "refunds:manage");
  const canPayments = can(permissions, "payments:view");
  const [tab, setTab] = useState<"refunds" | "payments" | "reconciliation">(canRefunds ? "refunds" : "payments");
  const tabs = [
    ...(canRefunds ? [{ key: "refunds" as const, label: "Refunds" }] : []),
    ...(canPayments ? [{ key: "payments" as const, label: "Online payments" }, { key: "reconciliation" as const, label: "Daily check" }] : []),
  ];
  if (tabs.length === 0) return <section className="admin-panel"><p className="admin-roles-message">Permission denied: payments:view or refunds:manage required.</p></section>;
  return (
    <>
      <Heading title="Payments & refunds" subtitle="Online payments received through Razorpay, and money going back to customers." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Payments sections" />
      {tab === "refunds" ? <Refunds /> : tab === "payments" ? <Payments canManage={can(permissions, "payments:manage")} /> : <Reconcile canManage={can(permissions, "payments:manage")} />}
    </>
  );
}

function Refunds() {
  const [status, setStatus] = useState<"open" | RefundStatus | "all">("open");
  const list = usePolling(async () => {
    const query = status === "open" || status === "all" ? "" : `&status=${status}`;
    const r = await api<{ data: Refund[]; meta?: { pendingCount?: number } }>(`refunds?limit=100${query}`);
    return { rows: status === "open" ? r.data.filter(x => x.status === "requested" || x.status === "approved") : r.data, pending: r.meta?.pendingCount ?? 0 };
  }, 30_000, [status]);
  const [acting, setActing] = useState<{ id: string; kind: "reject" | "manual" | "razorpay" } | null>(null);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"razorpay_dashboard" | "upi" | "cash">("upi");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); setActing(null); setReason(""); setReference(""); setNotice(done); list.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const approve = (r: Refund) => run(() => api(`refunds/${r.id}/approve`, json("POST")), `Refund for ${r.orderNo} approved.`);
  const sendBack = (r: Refund) => run(() => api(`refunds/${r.id}/pay-via-razorpay`, json("POST")), `${money(r.amount)} is being sent back to ${r.customer.name || "the customer"} through Razorpay.`);
  const reject = (e: FormEvent, r: Refund) => { e.preventDefault(); void run(() => api(`refunds/${r.id}/reject`, json("POST", { reason: reason.trim() })), `Refund for ${r.orderNo} rejected.`); };
  const markPaid = (e: FormEvent, r: Refund) => { e.preventDefault(); void run(() => api(`refunds/${r.id}/mark-done`, json("POST", { method, reference: reference.trim() || null })), `Refund for ${r.orderNo} recorded as paid.`); };

  const rows = list.data?.rows ?? [];
  return (
    <section className="admin-panel" aria-labelledby="refunds-title">
      <div className="admin-panel-toolbar">
        <h2 id="refunds-title">Refunds{list.data && list.data.pending > 0 ? ` · ${list.data.pending} waiting` : ""}</h2>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="Filter refunds" style={{ ...inputStyle, width: "auto" }}>
          <option value="open">Waiting to be paid</option><option value="done">Paid</option><option value="rejected">Rejected</option><option value="all">All</option>
        </select>
      </div>
      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
      {list.loading && !list.data ? <p className="admin-roles-message" role="status">Loading…</p>
        : list.error && !list.data ? <p className="admin-roles-message" role="alert">{list.error}</p>
        : rows.length === 0 ? <p className="admin-roles-message">No refunds here.</p>
        : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-stock-table">
              <thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Why</th><th>Paid by</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const open = r.status === "requested" || r.status === "approved";
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.orderNo}<small style={{ display: "block", fontWeight: 400, color: "var(--admin-muted)" }}>{dateTime(r.createdAt)}</small></td>
                      <td>{r.customer.name || "—"}<small style={{ display: "block", color: "var(--admin-muted)" }}>{r.customer.phone}</small></td>
                      <td>{money(r.amount)}</td>
                      <td style={{ fontSize: 14 }}>{words(r.reason)}<small style={{ display: "block", color: "var(--admin-muted)" }}>{r.source === "customer_request" ? "Asked by customer" : r.source === "auto" ? "Automatic" : "Added by staff"}{r.customerNote ? ` · “${r.customerNote}”` : ""}{r.rejectReason ? ` · ${r.rejectReason}` : ""}</small></td>
                      <td style={{ fontSize: 14 }}>{r.paymentMethod === "online" ? "Paid online" : "Cash order"}{r.status === "done" && <small style={{ display: "block", color: "var(--admin-muted)" }}>{methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ""}</small>}</td>
                      <td><Badge tone={refundTone(r.status)}>{words(r.status)}</Badge></td>
                      <td>
                        {open && acting?.id !== r.id && (
                          <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                            {r.paymentMethod === "online" && <button className="admin-role-button" disabled={busy} onClick={() => setActing({ id: r.id, kind: "razorpay" })}>Refund via Razorpay</button>}
                            {r.status === "requested" && <button disabled={busy} onClick={() => void approve(r)}>Approve</button>}
                            <button disabled={busy} onClick={() => setActing({ id: r.id, kind: "manual" })}>Mark paid</button>
                            {r.status === "requested" && <button disabled={busy} onClick={() => setActing({ id: r.id, kind: "reject" })}>Reject</button>}
                          </div>
                        )}
                        {open && acting?.id === r.id && acting.kind === "razorpay" && (
                          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
                            <span style={{ fontSize: 14 }}>Send {money(r.amount)} back to the customer’s original payment method?</span>
                            <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                              <button className="admin-role-button" disabled={busy} onClick={() => void sendBack(r)}>{busy ? "Sending…" : "Yes, refund"}</button>
                              <button type="button" disabled={busy} onClick={() => setActing(null)}>Cancel</button>
                            </div>
                          </div>
                        )}
                        {open && acting?.id === r.id && acting.kind === "reject" && (
                          <form onSubmit={e => reject(e, r)} style={{ display: "grid", gap: 8, minWidth: 220 }}>
                            <input required maxLength={500} placeholder="Reason shown to the customer" value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} disabled={busy} />
                            <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                              <button className="admin-role-button" type="submit" disabled={busy || !reason.trim()}>Reject refund</button>
                              <button type="button" disabled={busy} onClick={() => setActing(null)}>Cancel</button>
                            </div>
                          </form>
                        )}
                        {open && acting?.id === r.id && acting.kind === "manual" && (
                          <form onSubmit={e => markPaid(e, r)} style={{ display: "grid", gap: 8, minWidth: 240 }}>
                            <Field label="How was it paid?">
                              <select value={method} onChange={e => setMethod(e.target.value as typeof method)} disabled={busy}>
                                <option value="upi">UPI</option><option value="cash">Cash</option><option value="razorpay_dashboard">Razorpay dashboard</option>
                              </select>
                            </Field>
                            <Field label="Reference (optional)"><input maxLength={100} value={reference} onChange={e => setReference(e.target.value)} style={inputStyle} disabled={busy} /></Field>
                            <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                              <button className="admin-role-button" type="submit" disabled={busy}>Record as paid</button>
                              <button type="button" disabled={busy} onClick={() => setActing(null)}>Cancel</button>
                            </div>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function Payments({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [groupNo, setGroupNo] = useState("");
  const list = usePolling(() => api<{ data: Payment[] }>(`payments?limit=100${status ? `&status=${status}` : ""}${groupNo ? `&groupNo=${encodeURIComponent(groupNo)}` : ""}`).then(r => r.data), 30_000, [status, groupNo]);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function markPaid(e: FormEvent, p: Payment) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`payments/${p.id}/mark-paid`, json("POST", { razorpayPaymentId: paymentId.trim(), note: note.trim() || null }));
      setMarkingId(null); setPaymentId(""); setNote(""); setNotice(`Payment for ${p.groupNo ?? "the order"} marked as received.`); list.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  const rows = list.data ?? [];
  return (
    <section className="admin-panel" aria-labelledby="payments-title">
      <div className="admin-panel-toolbar">
        <h2 id="payments-title">Online payments</h2>
        <form onSubmit={e => { e.preventDefault(); setGroupNo(search.trim()); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Order number" aria-label="Order number" style={{ ...inputStyle, width: 150 }} />
          <button type="submit">Find</button>
          {groupNo && <button type="button" onClick={() => { setSearch(""); setGroupNo(""); }}>Clear</button>}
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter payments" style={{ ...inputStyle, width: "auto" }}>
            <option value="">All</option><option value="captured">Received</option><option value="authorized">Waiting for confirmation</option><option value="created">Started</option><option value="failed">Failed</option>
          </select>
        </form>
      </div>
      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
      {list.loading && !list.data ? <p className="admin-roles-message" role="status">Loading…</p>
        : list.error && !list.data ? <p className="admin-roles-message" role="alert">{list.error}</p>
        : rows.length === 0 ? <p className="admin-roles-message">No payments found.</p>
        : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-stock-table">
              <thead><tr><th>Order</th><th>Amount</th><th>Type</th><th>Razorpay reference</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.groupNo ?? "—"}<small style={{ display: "block", fontWeight: 400, color: "var(--admin-muted)" }}>{p.customerName ?? ""}</small></td>
                    <td>{money(p.amount)}</td>
                    <td style={{ fontSize: 14 }}>{p.method === "razorpay_link" ? "Payment link" : p.method === "cod" ? "Cash" : "Checkout"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{p.razorpayPaymentId ?? p.razorpayOrderId ?? "—"}{p.capturedAt && <small style={{ display: "block", fontFamily: "inherit", color: "var(--admin-muted)" }}>{dateTime(p.capturedAt)}</small>}</td>
                    <td><Badge tone={paymentTone(p.status)}>{words(p.status)}</Badge>{p.flag && <small style={{ display: "block", color: "#a73535" }}>{words(p.flag)}</small>}{p.failureReason && <small style={{ display: "block", color: "var(--admin-muted)" }}>{p.failureReason}</small>}</td>
                    {canManage && (
                      <td>
                        {p.status !== "captured" && p.method !== "cod" && markingId !== p.id && <button disabled={busy} onClick={() => { setMarkingId(p.id); setPaymentId(p.razorpayPaymentId ?? ""); setError(""); }}>Mark as received</button>}
                        {markingId === p.id && (
                          <form onSubmit={e => void markPaid(e, p)} style={{ display: "grid", gap: 8, minWidth: 250 }}>
                            <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>Only after you have seen this money in the Razorpay dashboard.</span>
                            <Field label="Razorpay payment id"><input required maxLength={64} placeholder="pay_…" value={paymentId} onChange={e => setPaymentId(e.target.value)} style={inputStyle} disabled={busy} /></Field>
                            <Field label="Note (optional)"><input maxLength={500} value={note} onChange={e => setNote(e.target.value)} style={inputStyle} disabled={busy} /></Field>
                            <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                              <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm"}</button>
                              <button type="button" disabled={busy} onClick={() => setMarkingId(null)}>Cancel</button>
                            </div>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function Reconcile({ canManage }: { canManage: boolean }) {
  const [date, setDate] = useState(today());
  const result = usePolling(() => api<{ data: Reconciliation }>(`payments/reconciliation?date=${date}`).then(r => r.data), 0, [date]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setError("");
    try { await api("payments/reconcile", json("POST", { date })); result.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  const data = result.data;
  const describe = (m: Mismatch) => m.type === "missing_in_db" ? `Razorpay has ${money(m.amount)} (${m.razorpayPaymentId}) that we have no record of`
    : m.type === "missing_in_provider" ? `We show ${money(m.amount)} received (payment ${m.paymentId}) that Razorpay does not list`
    : m.type === "amount_mismatch" ? `Amounts differ on payment ${m.paymentId}: we expected ${money(m.expected)}, Razorpay shows ${money(m.actual)}`
    : `Status differs on payment ${m.paymentId}`;
  return (
    <section className="admin-panel" aria-labelledby="recon-title">
      <div className="admin-panel-toolbar">
        <h2 id="recon-title">Daily check against Razorpay</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={date} max={today()} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Day to check" style={{ ...inputStyle, width: "auto" }} />
          {canManage && <button className="admin-role-button" disabled={busy} onClick={() => void run()}>{busy ? "Checking…" : "Check this day now"}</button>}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {result.loading && !data ? <p className="admin-roles-message" role="status">Loading…</p>
        : result.error ? <p className="admin-roles-message" role="alert">{result.error}</p>
        : data && (
          <div style={{ padding: "0 24px 20px" }}>
            <p style={{ fontSize: 15 }}><strong>{data.matched}</strong> payments match on {data.date}. <strong style={{ color: data.mismatches.length ? "#a73535" : undefined }}>{data.mismatches.length}</strong> need a look.</p>
            {data.matched === 0 && data.mismatches.length === 0 && <p style={{ fontSize: 14, color: "var(--admin-muted)" }}>Nothing has been checked for this day yet. Press “Check this day now”.</p>}
            {data.mismatches.length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6, fontSize: 14 }}>{data.mismatches.map((m, i) => <li key={i}>{describe(m)}</li>)}</ul>}
          </div>
        )}
    </section>
  );
}
