"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type RiderCashBalance = {
  riderId: string;
  name: string;
  cashInHand: number; // in paise
  byWarehouse: { warehouseId: string; amount: number }[];
  lastDepositAt: string | null;
};

type LedgerEntry = {
  id: string;
  riderId: string;
  warehouseId: string;
  type: "collected" | "deposit" | "adjustment";
  amount: number; // in paise
  orderId?: string | null;
  orderNo?: string | null;
  note: string | null;
  at: string;
};

type ReconciliationItem = {
  id: string;
  type: "upi_unverified" | "overpaid" | "unmatched" | string;
  status: "open" | "resolved";
  orderId: string;
  orderNo: string;
  riderId: string;
  riderName: string;
  warehouseId: string;
  amount: number; // in paise
  at: string;
  resolvedAt?: string | null;
  resolution?: {
    outcome: string;
    note: string | null;
    bankReference: string | null;
  } | null;
};

type OfflineReviewItem = {
  orderId: string;
  orderNo: string;
  riderName: string;
  deliveredAt: string;
  syncedAt: string;
  flags: string[];
  distanceFromAddressM: number | null;
  amountDue: number; // in paise
  collection?: { method: string; amount: number } | null;
  deliveryPending: boolean;
  reviewStatus: "open" | "resolved";
  outcome?: "accepted" | "rejected";
  note?: string | null;
};

type RiderOption = { id: string; name: string; phone: string };
type WarehouseOption = { id: string; name: string; code: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

function fmtCurrency(paise: number): string {
  const rs = paise / 100;
  return `₹${rs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ─── Cash in Hand (Riders Cash) Tab ──────────────────────────────────────────

function CashInHandTab({
  warehouses,
  onOpenDeposit,
}: {
  warehouses: WarehouseOption[];
  onOpenDeposit: (riderId: string, warehouseId: string) => void;
}) {
  const [data, setData] = useState<RiderCashBalance[]>([]);
  const [totalInHand, setTotalInHand] = useState(0);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (warehouseFilter) params.set("warehouseId", warehouseFilter);
    const query = params.toString() ? `?${params.toString()}` : "";

    api<{ data: RiderCashBalance[]; meta?: { totalInHand: number } }>(`cash/riders${query}`)
      .then((res) => {
        if (active) {
          setData(res.data ?? []);
          setTotalInHand(res.meta?.totalInHand ?? 0);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load rider cash balances.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [warehouseFilter, attempt]);

  return (
    <>
      <div className="admin-stat-grid">
        <div className="admin-stat is-accent">
          <span>Total cash with fleet</span>
          <strong>{fmtCurrency(totalInHand)}</strong>
        </div>
        <div className="admin-stat">
          <span>Riders holding cash</span>
          <strong>{data.filter((r) => r.cashInHand > 0).length}</strong>
        </div>
      </div>

      <section className="admin-panel" aria-labelledby="cash-desk-title">
        <form
          className="admin-staff-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setAttempt((v) => v + 1);
          }}
        >
          <label>
            Filter by Store / Warehouse:
            <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
              <option value="">All Stores</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
          </label>
          <button className="admin-role-button" disabled={loading}>Filter</button>
        </form>

        <div className="admin-panel-toolbar">
          <h2 id="cash-desk-title">Rider Cash-in-Hand Monitor</h2>
          <button className="admin-text-button" disabled={loading} onClick={() => setAttempt((v) => v + 1)}>
            Refresh
          </button>
        </div>

        {error ? (
          <p role="alert" className="admin-role-error" style={{ margin: 16 }}>{error}</p>
        ) : loading ? (
          <p className="admin-roles-message" role="status">Loading balances…</p>
        ) : data.length === 0 ? (
          <p className="admin-roles-message">No riders currently hold cash for this criteria.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-product-table">
              <thead>
                <tr>
                  <th>Rider</th>
                  <th className="num">Cash Held</th>
                  <th>Store Breakdown</th>
                  <th>Last Deposit</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => {
                  const isHigh = r.cashInHand >= 500_000; // >= ₹5,000 threshold
                  const primaryWh = r.byWarehouse[0]?.warehouseId ?? warehouses[0]?.id ?? "";
                  return (
                    <tr key={r.riderId} style={{ background: isHigh ? "#fffbf2" : undefined }}>
                      <td>
                        <strong>{r.name || `Rider ${r.riderId.slice(-6)}`}</strong>
                        {isHigh && (
                          <span className="admin-badge admin-badge-paused" style={{ marginLeft: 8, fontSize: 12 }}>
                            HIGH BALANCE
                          </span>
                        )}
                      </td>
                      <td className="num" style={{ fontSize: 17, fontWeight: 700 }}>{fmtCurrency(r.cashInHand)}</td>
                      <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>
                        {r.byWarehouse.map((w) => {
                          const whCode = warehouses.find((item) => item.id === w.warehouseId)?.code ?? w.warehouseId.slice(-4);
                          return `${whCode}: ${fmtCurrency(w.amount)}`;
                        }).join(" | ") || "—"}
                      </td>
                      <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{fmtDate(r.lastDepositAt)}</td>
                      <td>
                        <button
                          className="admin-role-button"
                          style={{ padding: "4px 10px", fontSize: 13 }}
                          onClick={() => onOpenDeposit(r.riderId, primaryWh)}
                        >
                          Collect Deposit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ─── Transaction Ledger Tab ──────────────────────────────────────────────────

function LedgerTab({
  warehouses,
  riders,
}: {
  warehouses: WarehouseOption[];
  riders: RiderOption[];
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [riderFilter, setRiderFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const cursor = cursors.at(-1)!;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    if (typeFilter) params.set("type", typeFilter);
    if (riderFilter) params.set("riderId", riderFilter);

    api<{ data: LedgerEntry[]; meta?: { nextCursor: string | null } }>(`cash/ledger?${params.toString()}`)
      .then((res) => {
        if (active) {
          setEntries(res.data ?? []);
          setNextCursor(res.meta?.nextCursor ?? null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load ledger entries.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [typeFilter, riderFilter, cursor, attempt]);

  return (
    <section className="admin-panel" aria-labelledby="ledger-title">
      <form
        className="admin-staff-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setCursors([""]);
          setAttempt((v) => v + 1);
        }}
      >
        <label>
          Filter by Type:
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Transactions</option>
            <option value="collected">Collected (Customer)</option>
            <option value="deposit">Deposit (Handed in)</option>
            <option value="adjustment">Adjustment (Dispute/Correction)</option>
          </select>
        </label>
        <label>
          Filter by Rider:
          <select value={riderFilter} onChange={(e) => setRiderFilter(e.target.value)}>
            <option value="">All Riders</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <button className="admin-role-button" disabled={loading}>Filter</button>
      </form>

      <div className="admin-panel-toolbar">
        <h2 id="ledger-title">Cash &amp; Deposit Ledger</h2>
        <span>{loading ? "Loading…" : `${entries.length} entries shown`}</span>
      </div>

      {loading ? (
        <p className="admin-roles-message" role="status">Loading ledger…</p>
      ) : entries.length === 0 ? (
        <p className="admin-roles-message">No ledger records found.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Rider</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Order / Ref</th>
                <th>Store</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const rName = riders.find((r) => r.id === e.riderId)?.name ?? e.riderId.slice(-6);
                const whCode = warehouses.find((w) => w.id === e.warehouseId)?.code ?? e.warehouseId.slice(-4);
                const isDeposit = e.type === "deposit";
                const isCollected = e.type === "collected";
                return (
                  <tr key={e.id}>
                    <td className="nowrap" style={{ fontSize: 14 }}>{fmtDate(e.at)}</td>
                    <td><strong>{rName}</strong></td>
                    <td>
                      <span className={`admin-badge ${isDeposit ? "admin-badge-active" : isCollected ? "admin-badge-paused" : ""}`}>
                        {e.type}
                      </span>
                    </td>
                    <td className="num" style={{ fontWeight: 700, color: isDeposit ? "#137333" : isCollected ? "#b06000" : undefined }}>
                      {isDeposit ? "-" : "+"}{fmtCurrency(Math.abs(e.amount))}
                    </td>
                    <td style={{ fontSize: 14, fontFamily: "monospace" }}>{e.orderNo || (e.orderId ? `#${e.orderId.slice(-6)}` : "—")}</td>
                    <td style={{ fontSize: 14 }}>{whCode}</td>
                    <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{e.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-staff-pagination">
        <button disabled={loading || cursors.length <= 1} onClick={() => setCursors((v) => v.slice(0, -1))}>
          Previous
        </button>
        <span>Page {cursors.length}</span>
        <button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setCursors((v) => [...v, nextCursor]); }}>
          Next
        </button>
      </div>
    </section>
  );
}

// ─── Deposit & Adjustment Entry Tab ──────────────────────────────────────────

function DepositFormTab({
  warehouses,
  riders,
  initialRiderId = "",
  initialWarehouseId = "",
  onSuccess,
}: {
  warehouses: WarehouseOption[];
  riders: RiderOption[];
  initialRiderId?: string;
  initialWarehouseId?: string;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<"deposit" | "adjust">("deposit");
  const [riderId, setRiderId] = useState(initialRiderId || (riders[0]?.id ?? ""));
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId || (warehouses[0]?.id ?? ""));
  const [amountRs, setAmountRs] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (initialRiderId) setRiderId(initialRiderId);
    if (initialWarehouseId) setWarehouseId(initialWarehouseId);
  }, [initialRiderId, initialWarehouseId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const parsedRs = parseFloat(amountRs);
      if (isNaN(parsedRs) || parsedRs === 0) {
        throw new Error("Amount must be a non-zero valid number.");
      }
      const paise = Math.round(parsedRs * 100);

      if (mode === "deposit") {
        if (paise <= 0) throw new Error("Deposit amount must be greater than zero.");
        await api("cash/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify({
            riderId,
            warehouseId,
            amount: paise,
            note: note.trim() || undefined,
          }),
        });
        setNotice(`Deposit of ₹${parsedRs.toFixed(2)} recorded successfully.`);
      } else {
        await api("cash/adjust", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify({
            riderId,
            warehouseId,
            amount: paise,
            note: note.trim() || "Manual balance correction",
          }),
        });
        setNotice(`Adjustment of ₹${parsedRs.toFixed(2)} recorded.`);
      }

      setAmountRs("");
      setNote("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record cash transaction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-panel admin-role-form is-wide" onSubmit={submit}>
      <div className="admin-segment" role="group" aria-label="Entry type">
        <button type="button" className={mode === "deposit" ? "is-on" : ""} onClick={() => setMode("deposit")}>Rider deposit (hand-in)</button>
        <button type="button" className={mode === "adjust" ? "is-on" : ""} onClick={() => setMode("adjust")}>Adjustment / dispute</button>
      </div>

      <h2>{mode === "deposit" ? "Record Cash Hand-in" : "Record Ledger Adjustment"}</h2>
      <p style={{ fontSize: 14, color: "var(--admin-muted)" }}>
        {mode === "deposit"
          ? "Confirm cashier receipt of physical cash deposited by a delivery partner."
          : "Debit or credit a rider's cash liability to settle discrepancies or manual cash corrections."}
      </p>

      {notice && <p role="status" style={{ color: "#137333", margin: "8px 0" }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ margin: "8px 0" }}>{error}</p>}

      <div className="admin-form-grid">
        <label className="admin-field">
          Delivery Partner *
          <select
            required
            value={riderId}
            onChange={(e) => setRiderId(e.target.value)}
            disabled={busy}
          >
            <option value="">— Select Rider —</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          Fulfillment Store / Warehouse *
          <select
            required
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={busy}
          >
            <option value="">— Select Warehouse —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          Amount in Rupees (₹) *
          <input
            type="number"
            step="0.01"
            required
            placeholder="e.g. 1500.00"
            value={amountRs}
            onChange={(e) => setAmountRs(e.target.value)}
            disabled={busy}
          />
          {mode === "adjust" && (
            <small style={{ color: "var(--admin-muted)" }}>Negative number reduces rider liability; positive increases liability.</small>
          )}
        </label>

        <label className="admin-field">
          {mode === "deposit" ? "Receipt Note / Reference" : "Adjustment Reason *"}
          <textarea
            required={mode === "adjust"}
            maxLength={500}
            placeholder={mode === "deposit" ? "e.g. Cashier slip #402" : "Explain why the adjustment is needed"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <div className="admin-role-actions" style={{ marginTop: 18, padding: 0 }}>
        <button className="admin-role-button" type="submit" disabled={busy}>
          {busy ? "Saving…" : mode === "deposit" ? "Confirm Deposit Receipt" : "Record Adjustment"}
        </button>
      </div>
    </form>
  );
}

// ─── Reconciliation & Offline Reviews Tab ────────────────────────────────────

function ReconciliationTab() {
  const [reconSubTab, setReconSubTab] = useState<"upi" | "offline">("upi");

  // Reconciliation items
  const [recons, setRecons] = useState<ReconciliationItem[]>([]);
  const [openReconCount, setOpenReconCount] = useState(0);

  // Offline reviews
  const [reviews, setReviews] = useState<OfflineReviewItem[]>([]);
  const [openReviewCount, setOpenReviewCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Resolve dialog state
  const [resolvingRecon, setResolvingRecon] = useState<ReconciliationItem | null>(null);
  const [reconOutcome, setReconOutcome] = useState<"verified" | "not_received" | "refund" | "keep" | "adjust">("verified");
  const [bankRef, setBankRef] = useState("");
  const [reconNote, setReconNote] = useState("");

  const [resolvingReview, setResolvingReview] = useState<OfflineReviewItem | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<"accepted" | "rejected">("accepted");
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    if (reconSubTab === "upi") {
      api<{ data: ReconciliationItem[]; meta?: { openCount: number } }>("reconciliation")
        .then((res) => {
          if (active) {
            setRecons(res.data ?? []);
            setOpenReconCount(res.meta?.openCount ?? 0);
          }
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : "Failed to load reconciliations.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      api<{ data: OfflineReviewItem[]; meta?: { openCount: number } }>("offline-reviews")
        .then((res) => {
          if (active) {
            setReviews(res.data ?? []);
            setOpenReviewCount(res.meta?.openCount ?? 0);
          }
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : "Failed to load offline reviews.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => { active = false; };
  }, [reconSubTab, attempt]);

  async function submitResolveRecon(e: FormEvent) {
    e.preventDefault();
    if (!resolvingRecon) return;
    setBusy(true);
    setError("");
    try {
      await api(`reconciliation/${resolvingRecon.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({
          outcome: reconOutcome,
          bankReference: bankRef.trim() || undefined,
          note: reconNote.trim() || undefined,
        }),
      });
      setResolvingRecon(null);
      setBankRef("");
      setReconNote("");
      setNotice("Reconciliation item resolved.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve item.");
    } finally {
      setBusy(false);
    }
  }

  async function submitResolveReview(e: FormEvent) {
    e.preventDefault();
    if (!resolvingReview) return;
    setBusy(true);
    setError("");
    try {
      await api(`offline-reviews/${resolvingReview.orderId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({
          outcome: reviewOutcome,
          note: reviewNote.trim() || undefined,
        }),
      });
      setResolvingReview(null);
      setReviewNote("");
      setNotice(`Offline review ${reviewOutcome}.`);
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve offline review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-segment" role="group" aria-label="Reconciliation sections">
        <button type="button" className={reconSubTab === "upi" ? "is-on" : ""} onClick={() => setReconSubTab("upi")}>Doorstep UPI &amp; discrepancies ({openReconCount} open)</button>
        <button type="button" className={reconSubTab === "offline" ? "is-on" : ""} onClick={() => setReconSubTab("offline")}>Offline delivery reviews ({openReviewCount} open)</button>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {/* Resolve UPI Recon Form */}
      {resolvingRecon && (
        <form className="admin-panel admin-role-form" onSubmit={submitResolveRecon} style={{ marginBottom: 20 }}>
          <h2>Resolve #{resolvingRecon.orderNo} ({resolvingRecon.type})</h2>
          <p style={{ fontSize: 14, color: "var(--admin-muted)" }}>
            Rider: <strong>{resolvingRecon.riderName}</strong> · Discrepancy Amount: <strong>{fmtCurrency(resolvingRecon.amount)}</strong>
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 500 }}>
            <label className="admin-field">
              Outcome Decision *
              <select
                value={reconOutcome}
                onChange={(e) => setReconOutcome(e.target.value as typeof reconOutcome)}
                disabled={busy}
              >
                <option value="verified">Verified (Bank statement matched)</option>
                <option value="not_received">Not Received (Rider owes as cash)</option>
                <option value="refund">Refund Customer</option>
                <option value="keep">Keep Excess</option>
                <option value="adjust">Adjust Ledger</option>
              </select>
            </label>
            {reconOutcome === "verified" && (
              <label className="admin-field">
                Bank Reference / UTR Number
                <input
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  placeholder="e.g. 329019283019"
                  disabled={busy}
                />
              </label>
            )}
            <label className="admin-field">
              Audit Note
              <input
                value={reconNote}
                onChange={(e) => setReconNote(e.target.value)}
                placeholder="Optional explanation"
                disabled={busy}
              />
            </label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Resolving…" : "Confirm Resolution"}
            </button>
            <button type="button" disabled={busy} onClick={() => setResolvingRecon(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Resolve Offline Delivery Review Form */}
      {resolvingReview && (
        <form className="admin-panel admin-role-form" onSubmit={submitResolveReview} style={{ marginBottom: 20 }}>
          <h2>Audit Offline Delivery #{resolvingReview.orderNo}</h2>
          <p style={{ fontSize: 14, color: "var(--admin-muted)" }}>
            Delivered while rider was offline: {fmtDate(resolvingReview.deliveredAt)}. Distance: {resolvingReview.distanceFromAddressM ?? "—"}m.
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 500 }}>
            <label className="admin-field">
              Audit Outcome *
              <select
                value={reviewOutcome}
                onChange={(e) => setReviewOutcome(e.target.value as "accepted" | "rejected")}
                disabled={busy}
              >
                <option value="accepted">Accept Delivery (Mark Order Completed)</option>
                <option value="rejected">Reject Delivery (Send Order to Failed)</option>
              </select>
            </label>
            <label className="admin-field">
              Reason / Review Note
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Document your check (e.g. verified with customer over call)"
                disabled={busy}
              />
            </label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Resolving…" : "Sign Off Review"}
            </button>
            <button type="button" disabled={busy} onClick={() => setResolvingReview(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {reconSubTab === "upi" ? (
        <section className="admin-panel" aria-labelledby="recon-title">
          <div className="admin-panel-toolbar">
            <h2 id="recon-title">Reconciliation Queue</h2>
            <span>{recons.length} items</span>
          </div>
          {loading ? (
            <p className="admin-roles-message" role="status">Loading items…</p>
          ) : recons.length === 0 ? (
            <p className="admin-roles-message">No reconciliation items pending.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-product-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Rider</th>
                    <th>Type</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Timestamp</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recons.map((r) => {
                    const isOpen = r.status === "open";
                    return (
                      <tr key={r.id}>
                        <td><strong>#{r.orderNo}</strong></td>
                        <td>{r.riderName}</td>
                        <td><span className="admin-badge admin-badge-paused">{r.type.replace("_", " ")}</span></td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmtCurrency(r.amount)}</td>
                        <td>
                          <span className={`admin-badge ${isOpen ? "admin-badge-inactive" : "admin-badge-active"}`}>
                            {r.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{fmtDate(r.at)}</td>
                        <td>
                          {isOpen ? (
                            <button
                              className="admin-role-button"
                              style={{ padding: "4px 8px", fontSize: 13 }}
                              onClick={() => setResolvingRecon(r)}
                            >
                              Resolve
                            </button>
                          ) : (
                            <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>
                              {r.resolution?.outcome ?? "Resolved"}
                            </span>
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
      ) : (
        <section className="admin-panel" aria-labelledby="offline-title">
          <div className="admin-panel-toolbar">
            <h2 id="offline-title">Offline Delivery Audits</h2>
            <span>{reviews.length} reviews</span>
          </div>
          {loading ? (
            <p className="admin-roles-message" role="status">Loading reviews…</p>
          ) : reviews.length === 0 ? (
            <p className="admin-roles-message">No offline deliveries pending review.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-product-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Rider</th>
                    <th>Delivered At</th>
                    <th>Flags</th>
                    <th>Distance</th>
                    <th>Collection</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((rev) => {
                    const isOpen = rev.reviewStatus === "open";
                    return (
                      <tr key={rev.orderId}>
                        <td><strong>#{rev.orderNo}</strong></td>
                        <td>{rev.riderName}</td>
                        <td style={{ fontSize: 14 }}>{fmtDate(rev.deliveredAt)}</td>
                        <td>
                          {rev.flags.map((f) => (
                            <span key={f} className="admin-badge admin-badge-paused" style={{ marginRight: 4 }}>
                              {f.replace("_", " ")}
                            </span>
                          ))}
                        </td>
                        <td style={{ fontSize: 14 }}>{rev.distanceFromAddressM !== null ? `${rev.distanceFromAddressM}m` : "—"}</td>
                        <td style={{ fontSize: 14 }}>
                          {rev.collection ? `${rev.collection.method}: ${fmtCurrency(rev.collection.amount)}` : "—"}
                        </td>
                        <td>
                          {isOpen ? (
                            <button
                              className="admin-role-button"
                              style={{ padding: "4px 8px", fontSize: 13 }}
                              onClick={() => setResolvingReview(rev)}
                            >
                              Audit Proof
                            </button>
                          ) : (
                            <span className={`admin-badge ${rev.outcome === "accepted" ? "admin-badge-active" : "admin-badge-disabled"}`}>
                              {rev.outcome}
                            </span>
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
      )}
    </>
  );
}

// ─── Root CashDesk Component ─────────────────────────────────────────────────

type CashTab = "cash-in-hand" | "ledger" | "deposit" | "reconciliation";

export default function CashDesk({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<CashTab>("cash-in-hand");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [riders, setRiders] = useState<RiderOption[]>([]);

  // Pre-fill target for deposit form
  const [depositRiderId, setDepositRiderId] = useState("");
  const [depositWarehouseId, setDepositWarehouseId] = useState("");

  const canManage =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("cash:manage");

  useEffect(() => {
    void api<{ data: WarehouseOption[] }>("warehouses").then((res) => {
      setWarehouses(res.data ?? []);
    }).catch(() => {});

    void api<{ data: RiderOption[] }>("riders").then((res) => {
      setRiders(res.data ?? []);
    }).catch(() => {});
  }, []);

  if (!canManage) {
    return (
      <div className="admin-heading">
        <div>
          <h1>Cash Desk &amp; Settlement</h1>
          <p>Permission denied: cash:manage required.</p>
        </div>
      </div>
    );
  }

  function handleOpenDeposit(riderId: string, warehouseId: string) {
    setDepositRiderId(riderId);
    setDepositWarehouseId(warehouseId);
    setTab("deposit");
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 20 }}>
        <div>
          <h1>Cash Desk &amp; Settlement</h1>
          <p>Cash collection monitoring, daily rider deposits, and delivery reconciliations.</p>
        </div>
      </div>

      <div className="admin-tab-nav" role="tablist" aria-label="Cash desk sections">
        {([
          { key: "cash-in-hand", label: "Cash in Hand" },
          { key: "ledger", label: "Ledger Entries" },
          { key: "deposit", label: "Record Deposit / Adjust" },
          { key: "reconciliation", label: "Reconciliation & Offline" },
        ] as { key: CashTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "is-active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cash-in-hand" && <CashInHandTab warehouses={warehouses} onOpenDeposit={handleOpenDeposit} />}
      {tab === "ledger" && <LedgerTab warehouses={warehouses} riders={riders} />}
      {tab === "deposit" && (
        <DepositFormTab
          warehouses={warehouses}
          riders={riders}
          initialRiderId={depositRiderId}
          initialWarehouseId={depositWarehouseId}
          onSuccess={() => {
            setDepositRiderId("");
            setDepositWarehouseId("");
          }}
        />
      )}
      {tab === "reconciliation" && <ReconciliationTab />}
    </>
  );
}
