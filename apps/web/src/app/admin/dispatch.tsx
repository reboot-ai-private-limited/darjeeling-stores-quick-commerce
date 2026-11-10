"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type Alert = {
  type: "ack_overdue" | "rider_problem" | "order_delayed" | "rider_offline" | "failed_delivery" | string;
  orderId?: string;
  riderId?: string;
  problem?: string;
  note?: string;
  since?: string;
  message?: string;
  minutes?: number;
  hasActiveOrder?: boolean;
  reason?: string;
};

type SuggestionItem = {
  riderId: string;
  name: string;
  activeOrders: number;
  distanceMeters: number | null;
  lastAssignedAt: string | null;
  score: number;
};

type IneligibleItem = {
  riderId: string;
  name: string;
  reasons: string[];
};

type SuggestionsResponse = {
  orderId: string;
  suggested: SuggestionItem[];
  ineligible: IneligibleItem[];
};

type AssignmentItem = {
  id: string;
  orderId: string;
  orderNo: string;
  riderId: string;
  riderName: string;
  status: "assigned" | "acknowledged" | "reassigned" | "cancelled" | "completed";
  ackDeadlineAt: string;
  overdue: boolean;
};

type BatchItem = {
  id: string;
  riderId: string;
  orderIds: string[];
  status: "planned" | "active" | "done" | "cancelled";
  stops?: { type: "pickup" | "drop"; orderIds: string[]; status?: string }[];
  createdAt?: string;
};

type RiderOption = {
  id: string;
  name: string;
  phone: string;
  status: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Alerts Tab ──────────────────────────────────────────────────────────────

function AlertsTab({ onJumpToOrder }: { onJumpToOrder: (orderId: string) => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const body = await api<{ data: Alert[] }>("dispatch/alerts");
        if (active) {
          setAlerts(body.data ?? []);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load alerts.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [attempt]);

  function getSeverity(type: string): "high" | "medium" {
    if (type === "ack_overdue" || type === "failed_delivery" || type === "rider_offline") return "high";
    return "medium";
  }

  function getTitle(alert: Alert): string {
    switch (alert.type) {
      case "ack_overdue": return "Acknowledgement Overdue";
      case "rider_problem": return `Rider Issue: ${alert.problem?.replace("_", " ") ?? "Reported"}`;
      case "order_delayed": return `Order Delayed: Ready for ${alert.minutes ?? 0}m without pickup`;
      case "rider_offline": return `Rider went offline ${alert.hasActiveOrder ? "with active order!" : "during shift"}`;
      case "failed_delivery": return `Failed Delivery: ${alert.reason?.replace("_", " ") ?? "Unresolved"}`;
      default: return alert.type.replace("_", " ");
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="alerts-title">
      <div className="admin-panel-toolbar">
        <h2 id="alerts-title">Escalations &amp; Real-time Alerts</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--admin-muted)" }}>Auto-refreshes every 30s</span>
          <button className="admin-text-button" disabled={loading} onClick={() => setAttempt((v) => v + 1)}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="admin-role-error" style={{ margin: 16 }}>{error}</p>
      ) : loading ? (
        <p className="admin-roles-message" role="status">Checking live alerts…</p>
      ) : alerts.length === 0 ? (
        <div className="admin-empty" style={{ minHeight: 220 }}>
          <span className="admin-badge admin-badge-active" style={{ marginBottom: 12, fontSize: 12 }}>All Clear</span>
          <h2>No Active Alerts</h2>
          <p>No SLA breaches, delayed assignments, or unattended rider problems at this moment.</p>
        </div>
      ) : (
        <div>
          {alerts.map((alert, i) => {
            const sev = getSeverity(alert.type);
            return (
              <div key={i} className={`admin-dispatch-alert severity-${sev}`}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className={`admin-badge ${sev === "high" ? "admin-badge-inactive" : "admin-badge-paused"}`}>
                      {alert.type.toUpperCase().replace("_", " ")}
                    </span>
                    <strong>{getTitle(alert)}</strong>
                  </div>
                  {alert.message && <p style={{ margin: "2px 0 6px", fontSize: 12 }}>{alert.message}</p>}
                  {alert.note && <p style={{ margin: "2px 0 6px", fontSize: 12, color: "var(--admin-muted)" }}>Note: {alert.note}</p>}
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--admin-muted)" }}>
                    {alert.orderId && <span>Order: <code>{alert.orderId}</code></span>}
                    {alert.riderId && <span>Rider: <code>{alert.riderId}</code></span>}
                    {alert.since && <span>Since: {fmtDate(alert.since)}</span>}
                  </div>
                </div>
                {alert.orderId && (
                  <button
                    className="admin-role-button"
                    style={{ minHeight: 32, padding: "4px 10px", fontSize: 12 }}
                    onClick={() => onJumpToOrder(alert.orderId!)}
                  >
                    View order
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Suggestions & Assign Tab ────────────────────────────────────────────────

function SuggestionsTab({ initialOrderId = "" }: { initialOrderId?: string }) {
  const [orderId, setOrderId] = useState(initialOrderId);
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialOrderId) {
      setOrderId(initialOrderId);
      void fetchSuggestions(initialOrderId);
    }
  }, [initialOrderId]);

  async function fetchSuggestions(idToLookup: string) {
    if (!idToLookup.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    setNotice("");
    try {
      const res = await api<{ data: SuggestionsResponse }>(`dispatch/suggestions?orderId=${encodeURIComponent(idToLookup.trim())}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suggestions.");
    } finally {
      setLoading(false);
    }
  }

  async function assignRider(riderId: string) {
    if (!data?.orderId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`orders/${data.orderId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ riderId }),
      });
      setNotice(`Order ${data.orderId} successfully assigned to rider.`);
      setData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="admin-panel" style={{ marginBottom: 20 }}>
        <div className="admin-panel-toolbar">
          <h2>Rider Recommendations &amp; Manual Assignment</h2>
        </div>
        <form
          className="admin-staff-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void fetchSuggestions(orderId);
          }}
          style={{ border: 0 }}
        >
          <label style={{ flex: 2 }}>
            Ready Order ID (24-char hex)
            <input
              type="text"
              required
              pattern="[a-f0-9]{24}"
              value={orderId}
              placeholder="e.g. 64b8a2e1d0f9a2b3c4d5e6f7"
              onChange={(e) => setOrderId(e.target.value)}
              disabled={loading || busy}
            />
          </label>
          <button className="admin-role-button" disabled={loading || busy}>
            {loading ? "Calculating…" : "Find Candidates"}
          </button>
        </form>
      </section>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12, fontSize: 13 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {data && (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="admin-panel">
            <div className="admin-panel-toolbar">
              <h2>Suggested Riders for Order <code>{data.orderId}</code></h2>
              <span>{data.suggested.length} ranked candidate(s)</span>
            </div>
            {data.suggested.length === 0 ? (
              <p className="admin-roles-message">No active riders match eligibility for this order right now.</p>
            ) : (
              <div style={{ padding: "8px 20px" }}>
                {data.suggested.map((c) => (
                  <div key={c.riderId} className="admin-suggestion-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="admin-badge admin-badge-active">Rank #{c.score}</span>
                        <strong style={{ fontSize: 14 }}>{c.name}</strong>
                      </div>
                      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--admin-muted)", marginTop: 4 }}>
                        <span>Active loads: <strong>{c.activeOrders}</strong></span>
                        {c.distanceMeters !== null && <span>Distance: {(c.distanceMeters / 1000).toFixed(1)} km</span>}
                        {c.lastAssignedAt && <span>Last assigned: {fmtDate(c.lastAssignedAt)}</span>}
                      </div>
                    </div>
                    <button
                      className="admin-role-button"
                      disabled={busy}
                      onClick={() => assignRider(c.riderId)}
                    >
                      {busy ? "Assigning…" : "Assign Order"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.ineligible.length > 0 && (
            <details className="admin-panel" style={{ padding: "16px 20px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                Ineligible Riders ({data.ineligible.length})
              </summary>
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {data.ineligible.map((i) => (
                  <div key={i.riderId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid var(--admin-border)", padding: "6px 0" }}>
                    <span>{i.name}</span>
                    <span style={{ color: "#a73535" }}>{i.reasons.join(", ").replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );
}

// ─── Assignments Live Board Tab ──────────────────────────────────────────────

function AssignmentsTab({ onInspectOrder }: { onInspectOrder: (orderId: string) => void }) {
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Handover modal / inline form
  const [handoverTarget, setHandoverTarget] = useState<AssignmentItem | null>(null);
  const [toRiderId, setToRiderId] = useState("");
  const [handoverReason, setHandoverReason] = useState("");

  // Resolve failed delivery modal / form
  const [resolveTarget, setResolveTarget] = useState<AssignmentItem | null>(null);
  const [resolveAction, setResolveAction] = useState<"redispatch" | "cancel_return">("redispatch");
  const [goodsCondition, setGoodsCondition] = useState<"good" | "spoiled">("good");
  const [resolveNote, setResolveNote] = useState("");

  // Available riders list for handover select
  const [riders, setRiders] = useState<RiderOption[]>([]);

  useEffect(() => {
    void api<{ data: RiderOption[] }>("riders?status=active").then((res) => {
      setRiders(res.data ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
        const body = await api<{ data: AssignmentItem[] }>(`assignments${query}`);
        if (active) {
          setAssignments(body.data ?? []);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load assignments.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [statusFilter, attempt]);

  async function unassignOrder(orderId: string) {
    if (!confirm("Revoke unacknowledged order from rider and return to READY state?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`orders/${orderId}/unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ reason: "Manual unassign by admin" }),
      });
      setNotice(`Order unassigned.`);
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unassign failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitHandover(e: FormEvent) {
    e.preventDefault();
    if (!handoverTarget) return;
    setBusy(true);
    setError("");
    try {
      await api(`orders/${handoverTarget.orderId}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ toRiderId, reason: handoverReason }),
      });
      setHandoverTarget(null);
      setToRiderId("");
      setHandoverReason("");
      setNotice("Order handed over to new rider.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handover failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitResolve(e: FormEvent) {
    e.preventDefault();
    if (!resolveTarget) return;
    setBusy(true);
    setError("");
    try {
      await api(`orders/${resolveTarget.orderId}/failed/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({
          action: resolveAction,
          ...(resolveAction === "cancel_return" && { goodsCondition }),
          note: resolveNote || undefined,
        }),
      });
      setResolveTarget(null);
      setResolveNote("");
      setNotice(`Failed delivery resolved with ${resolveAction}.`);
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {/* Handover Form */}
      {handoverTarget && (
        <form className="admin-panel admin-role-form" onSubmit={submitHandover} style={{ marginBottom: 20 }}>
          <h2>Handover Order #{handoverTarget.orderNo || handoverTarget.orderId}</h2>
          <p style={{ fontSize: 12, color: "var(--admin-muted)" }}>
            Current Rider: <strong>{handoverTarget.riderName}</strong>. Handing over transfers the live assignment to another active rider.
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 500 }}>
            <label style={{ fontSize: 12 }}>
              Select Destination Rider *
              <select
                required
                value={toRiderId}
                onChange={(e) => setToRiderId(e.target.value)}
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              >
                <option value="">— Select an active rider —</option>
                {riders.filter((r) => r.id !== handoverTarget.riderId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Reason for Handover *
              <input
                required
                maxLength={500}
                placeholder="e.g. Vehicle breakdown, puncture, emergency"
                value={handoverReason}
                onChange={(e) => setHandoverReason(e.target.value)}
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              />
            </label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Transferring…" : "Confirm Handover"}
            </button>
            <button type="button" disabled={busy} onClick={() => setHandoverTarget(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Resolve Failed Delivery Form */}
      {resolveTarget && (
        <form className="admin-panel admin-role-form" onSubmit={submitResolve} style={{ marginBottom: 20 }}>
          <h2>Resolve Failed Delivery: #{resolveTarget.orderNo || resolveTarget.orderId}</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 500 }}>
            <label style={{ fontSize: 12 }}>
              Resolution Action *
              <select
                value={resolveAction}
                onChange={(e) => setResolveAction(e.target.value as "redispatch" | "cancel_return")}
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              >
                <option value="redispatch">Re-dispatch Order (Send back to Ready)</option>
                <option value="cancel_return">Cancel &amp; Return Goods</option>
              </select>
            </label>
            {resolveAction === "cancel_return" && (
              <label style={{ fontSize: 12 }}>
                Goods Condition *
                <select
                  value={goodsCondition}
                  onChange={(e) => setGoodsCondition(e.target.value as "good" | "spoiled")}
                  disabled={busy}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                >
                  <option value="good">Good (Restockable)</option>
                  <option value="spoiled">Spoiled / Damaged</option>
                </select>
              </label>
            )}
            <label style={{ fontSize: 12 }}>
              Resolution Notes
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                maxLength={500}
                placeholder="Optional explanation of failure resolution"
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", minHeight: 60, padding: 8, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              />
            </label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Confirm Resolution"}
            </button>
            <button type="button" disabled={busy} onClick={() => setResolveTarget(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="assignments-title">
        <form className="admin-staff-filters" onSubmit={(e) => { e.preventDefault(); setAttempt((v) => v + 1); }}>
          <label>
            Filter by Status:
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Active &amp; Recent</option>
              <option value="assigned">Assigned</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="reassigned">Reassigned</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <button className="admin-role-button" disabled={loading}>Filter</button>
        </form>

        <div className="admin-panel-toolbar">
          <h2 id="assignments-title">Live Assignments Board</h2>
          <span>{loading ? "Refreshing…" : `${assignments.length} assignments`}</span>
        </div>

        {loading ? (
          <p className="admin-roles-message" role="status">Loading assignments…</p>
        ) : assignments.length === 0 ? (
          <p className="admin-roles-message">No assignments found matching criteria.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-product-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Rider</th>
                  <th>Status</th>
                  <th>Ack Deadline</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} style={{ background: a.overdue ? "#fff8f7" : undefined }}>
                    <td>
                      <button
                        className="admin-text-button"
                        style={{ padding: 0, fontWeight: 600, textAlign: "left" }}
                        onClick={() => onInspectOrder(a.orderId)}
                      >
                        #{a.orderNo || a.orderId.slice(-6)}
                      </button>
                    </td>
                    <td>{a.riderName || <span style={{ color: "var(--admin-muted)" }}>{a.riderId}</span>}</td>
                    <td>
                      <span className={`admin-badge ${a.status === "acknowledged" ? "admin-badge-active" : a.status === "assigned" ? (a.overdue ? "admin-badge-inactive" : "admin-badge-paused") : ""}`}>
                        {a.status}
                      </span>
                      {a.overdue && <small style={{ display: "block", color: "#a73535", fontWeight: 600, fontSize: 10 }}>ACK OVERDUE</small>}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--admin-muted)" }}>{fmtDate(a.ackDeadlineAt)}</td>
                    <td>
                      <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                        {a.status === "assigned" && (
                          <button
                            disabled={busy}
                            onClick={() => unassignOrder(a.orderId)}
                            style={{ border: "1px solid #cbc5ba", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11, color: "#a73535" }}
                          >
                            Unassign
                          </button>
                        )}
                        {(a.status === "assigned" || a.status === "acknowledged") && (
                          <button
                            disabled={busy}
                            onClick={() => setHandoverTarget(a)}
                            style={{ border: "1px solid #cbc5ba", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11 }}
                          >
                            Handover
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => setResolveTarget(a)}
                          style={{ border: "1px solid #cbc5ba", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11 }}
                        >
                          Resolve
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ─── Batches Tab ─────────────────────────────────────────────────────────────

function BatchesTab() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // New batch form
  const [creating, setCreating] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [orderIdsText, setOrderIdsText] = useState("");
  const [createError, setCreateError] = useState("");
  const [riders, setRiders] = useState<RiderOption[]>([]);

  useEffect(() => {
    void api<{ data: RiderOption[] }>("riders?status=active").then((res) => {
      setRiders(res.data ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api<{ data: BatchItem[] }>("batches");
        if (active) {
          setBatches(res.data ?? []);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load batches.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [attempt]);

  async function createBatch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCreateError("");
    try {
      const orderIds = orderIdsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      await api("batches", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ riderId, orderIds }),
      });
      setCreating(false);
      setRiderId("");
      setOrderIdsText("");
      setNotice("Delivery batch created successfully.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create batch.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBatch(batchId: string) {
    if (!confirm("Cancel this delivery batch?")) return;
    setBusy(true);
    setError("");
    try {
      await api(`batches/${batchId}/cancel`, {
        method: "POST",
        headers: { "X-CSRF-Token": "1" },
      });
      setNotice("Batch cancelled.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel batch.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>Route Batches</h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--admin-muted)" }}>Group multiple ready orders for single-rider multi-drop routes.</p>
        </div>
        <button className="admin-role-button" onClick={() => setCreating(!creating)}>
          {creating ? "Cancel" : "Create Batch"}
        </button>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {creating && (
        <form className="admin-panel admin-role-form" onSubmit={createBatch} style={{ marginBottom: 20 }}>
          <h2>Create Multi-Order Batch</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
            <label style={{ fontSize: 12 }}>
              Select Delivery Rider *
              <select
                required
                value={riderId}
                onChange={(e) => setRiderId(e.target.value)}
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              >
                <option value="">— Select an active rider —</option>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Ready Order IDs (1–10 IDs, comma or newline separated) *
              <textarea
                required
                value={orderIdsText}
                onChange={(e) => setOrderIdsText(e.target.value)}
                placeholder="64b8a2e1d0f9a2b3c4d5e6f7&#10;64b8a2e1d0f9a2b3c4d5e6f8"
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", minHeight: 90, padding: 8, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", resize: "vertical" }}
              />
            </label>
          </div>
          {createError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{createError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Save Batch"}
            </button>
            <button type="button" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="batches-title">
        <div className="admin-panel-toolbar">
          <h2 id="batches-title">Active Batches</h2>
          <span>{loading ? "Loading…" : `${batches.length} batches`}</span>
        </div>
        {loading ? (
          <p className="admin-roles-message" role="status">Loading batches…</p>
        ) : batches.length === 0 ? (
          <p className="admin-roles-message">No route batches created yet.</p>
        ) : (
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            {batches.map((b) => (
              <div key={b.id} className="admin-batch-card">
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span className={`admin-badge ${b.status === "active" ? "admin-badge-active" : b.status === "cancelled" ? "admin-badge-disabled" : "admin-badge-paused"}`}>
                      {b.status.toUpperCase()}
                    </span>
                    <strong>Batch <code>{b.id.slice(-6)}</code></strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 13 }}>Rider ID: <code>{b.riderId}</code></p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--admin-muted)" }}>
                    {b.orderIds.length} orders: {b.orderIds.map((id) => id.slice(-6)).join(", ")}
                  </p>
                </div>
                {b.status !== "cancelled" && b.status !== "done" && (
                  <button
                    disabled={busy}
                    onClick={() => cancelBatch(b.id)}
                    style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "6px 12px", background: "#fff", cursor: "pointer", fontSize: 12, color: "#a73535" }}
                  >
                    Cancel Batch
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ─── Root Dispatch Desk Component ─────────────────────────────────────────────

type DispatchTab = "alerts" | "assignments" | "suggestions" | "batches";

export default function Dispatch({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<DispatchTab>("alerts");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");

  const canManage =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("dispatch:manage");

  if (!canManage) {
    return (
      <div className="admin-heading">
        <div>
          <h1>Dispatch Desk</h1>
          <p>Permission denied: dispatch:manage required to access live dispatch controls.</p>
        </div>
      </div>
    );
  }

  function handleJumpToOrder(orderId: string) {
    setSelectedOrderId(orderId);
    setTab("suggestions");
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 12 }}>
        <div>
          <h1>Dispatch Desk</h1>
          <p>Live order dispatch, SLA breach alerts, rider assignment &amp; batching.</p>
        </div>
      </div>

      <div className="admin-tab-nav" role="tablist" aria-label="Dispatch Desk Sections">
        {([
          { key: "alerts", label: "Alerts & Escalations" },
          { key: "assignments", label: "Live Assignments" },
          { key: "suggestions", label: "Suggestions & Assign" },
          { key: "batches", label: "Route Batches" },
        ] as { key: DispatchTab; label: string }[]).map((t) => (
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

      {tab === "alerts" && <AlertsTab onJumpToOrder={handleJumpToOrder} />}
      {tab === "assignments" && <AssignmentsTab onInspectOrder={handleJumpToOrder} />}
      {tab === "suggestions" && <SuggestionsTab initialOrderId={selectedOrderId} />}
      {tab === "batches" && <BatchesTab />}
    </>
  );
}
