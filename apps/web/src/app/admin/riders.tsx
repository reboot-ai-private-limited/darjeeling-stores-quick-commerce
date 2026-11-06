"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type Rider = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  zoneId: string;
  warehouseIds: string[];
  currentWarehouseId: string | null;
  vehicle: string | null;
  status: "offline" | "online" | "on_break" | "deactivated";
  activeOrderCount: number;
  lastLocation: { lat: number; lng: number } | null;
  lastLocationAt: string | null;
  appVersion: string | null;
  pendingSyncCount: number;
  isActive: boolean;
};

type LiveRider = {
  riderId: string;
  name: string;
  status: string;
  currentWarehouseId: string | null;
  location: { lat: number; lng: number } | null;
  lastLocationAt: string | null;
  activeOrders: { orderId: string; orderNo: string; status: string }[];
};

type Shift = {
  id: string;
  riderId: string;
  warehouseId: string;
  startedAt: string;
  endedAt: string | null;
  punchIn: {
    distanceFromWarehouseM: number;
    verified: boolean;
  };
  breaks: { from: string; to: string | null }[];
  endedBy?: string;
};

type Zone = { id: string; name: string };
type Warehouse = { id: string; name: string; code: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function calcDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffM = Math.max(0, Math.floor((end - start) / 60000));
  const h = Math.floor(diffM / 60);
  const m = diffM % 60;
  return `${h}h ${m}m`;
}

// ─── Rider Directory Tab ─────────────────────────────────────────────────────

function RiderDirectory({
  canManage,
  zones,
  warehouses,
  onViewShifts,
}: {
  canManage: boolean;
  zones: Zone[];
  warehouses: Warehouse[];
  onViewShifts: (riderId: string, riderName: string) => void;
}) {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Create / Edit modal
  const [editing, setEditing] = useState<Rider | "new" | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formZoneId, setFormZoneId] = useState("");
  const [formWarehouseIds, setFormWarehouseIds] = useState<string[]>([]);
  const [formVehicle, setFormVehicle] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (statusFilter) params.set("status", statusFilter);
    const query = params.toString() ? `?${params.toString()}` : "";

    api<{ data: Rider[] }>(`riders${query}`)
      .then((res) => {
        if (active) setRiders(res.data ?? []);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load riders.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [attempt]);

  function startCreate() {
    setEditing("new");
    setFormName("");
    setFormPhone("");
    setFormZoneId(zones[0]?.id ?? "");
    setFormWarehouseIds(warehouses.length > 0 ? [warehouses[0]!.id] : []);
    setFormVehicle("");
    setFormError("");
  }

  function startEdit(r: Rider) {
    setEditing(r);
    setFormName(r.name);
    setFormPhone(r.phone);
    setFormZoneId(r.zoneId);
    setFormWarehouseIds(r.warehouseIds);
    setFormVehicle(r.vehicle ?? "");
    setFormError("");
  }

  async function saveRider(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (formWarehouseIds.length === 0) {
        throw new Error("Assign at least one warehouse.");
      }
      const isNew = editing === "new";
      if (isNew) {
        await api("riders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify({
            name: formName.trim(),
            phone: formPhone.trim(),
            zoneId: formZoneId,
            warehouseIds: formWarehouseIds,
            vehicle: formVehicle.trim() || null,
          }),
        });
        setNotice("Rider registered successfully.");
      } else {
        await api(`riders/${(editing as Rider).id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify({
            name: formName.trim(),
            zoneId: formZoneId,
            warehouseIds: formWarehouseIds,
            vehicle: formVehicle.trim() || null,
          }),
        });
        setNotice("Rider details updated.");
      }
      setEditing(null);
      setAttempt((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save rider.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: Rider) {
    const action = r.isActive ? "deactivate" : "reactivate";
    if (!confirm(`Are you sure you want to ${action} rider ${r.name}?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`riders/${r.id}/${action}`, {
        method: "POST",
        headers: { "X-CSRF-Token": "1" },
      });
      setNotice(`Rider ${action}d.`);
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} rider.`);
    } finally {
      setBusy(false);
    }
  }

  async function forceOffline(r: Rider) {
    if (!confirm(`Force-offline rider ${r.name}? If on shift, shift will be immediately terminated.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`riders/${r.id}/force-offline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ force: true }),
      });
      setNotice(`Rider forced offline.`);
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to force offline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 16 }}>
        <div>
          <h1>Riders &amp; Delivery Partners</h1>
          <p>Onboard, manage and monitor delivery personnel across fulfillment stores.</p>
        </div>
        {canManage && (
          <button className="admin-role-button" onClick={startCreate}>
            Onboard Rider
          </button>
        )}
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {editing && (
        <form className="admin-panel admin-role-form" onSubmit={saveRider} style={{ marginBottom: 20 }}>
          <h2>{editing === "new" ? "Onboard Delivery Partner" : `Edit Rider — ${(editing as Rider).name}`}</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 540 }}>
            <label style={{ fontSize: 12 }}>
              Full Name *
              <input
                required
                maxLength={80}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={busy}
                placeholder="e.g. Tenzing Sherpa"
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
              />
            </label>

            {editing === "new" && (
              <label style={{ fontSize: 12 }}>
                Phone Number (E.164 or 10 digits) *
                <input
                  required
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  disabled={busy}
                  placeholder="+919876543210 or 9876543210"
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
                />
              </label>
            )}

            <label style={{ fontSize: 12 }}>
              Home Zone *
              <select
                required
                value={formZoneId}
                onChange={(e) => setFormZoneId(e.target.value)}
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
              >
                <option value="">— Select primary zone —</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </label>

            <fieldset style={{ border: "1px solid var(--admin-border)", borderRadius: 6, padding: "10px 14px", margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 600 }}>Permitted Fulfillment Warehouses *</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 6 }}>
                {warehouses.map((w) => {
                  const checked = formWarehouseIds.includes(w.id);
                  return (
                    <label key={w.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.checked) setFormWarehouseIds([...formWarehouseIds, w.id]);
                          else setFormWarehouseIds(formWarehouseIds.filter((id) => id !== w.id));
                        }}
                      />
                      <span><strong>{w.code}</strong> {w.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label style={{ fontSize: 12 }}>
              Vehicle Details (optional)
              <input
                maxLength={40}
                value={formVehicle}
                onChange={(e) => setFormVehicle(e.target.value)}
                disabled={busy}
                placeholder="e.g. Hero Splendor Plus (WB-74-1234)"
                style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
              />
            </label>
          </div>

          {formError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{formError}</p>}

          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save Rider"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="riders-list-title">
        <form
          className="admin-staff-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setAttempt((v) => v + 1);
          }}
        >
          <label>
            Search Rider:
            <input
              type="search"
              placeholder="Name or phone"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
          <label>
            Status:
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="online">Online</option>
              <option value="on_break">On Break</option>
              <option value="offline">Offline</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </label>
          <button className="admin-role-button" disabled={loading}>Apply</button>
        </form>

        <div className="admin-panel-toolbar">
          <h2 id="riders-list-title">Fleet Directory</h2>
          <span>{loading ? "Loading…" : `${riders.length} riders`}</span>
        </div>

        {loading ? (
          <p className="admin-roles-message" role="status">Loading riders…</p>
        ) : riders.length === 0 ? (
          <p className="admin-roles-message">No riders found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-product-table">
              <thead>
                <tr>
                  <th>Rider</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Active Load</th>
                  <th>Vehicle</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => {
                  const isOnline = r.status === "online";
                  const isBreak = r.status === "on_break";
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        {!r.isActive && <small style={{ display: "block", color: "#a73535" }}>Deactivated</small>}
                      </td>
                      <td style={{ fontSize: 12 }}>{r.phone}</td>
                      <td>
                        <span className={`admin-badge ${isOnline ? "admin-badge-active" : isBreak ? "admin-badge-paused" : "admin-badge-disabled"}`}>
                          {r.status.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <strong>{r.activeOrderCount}</strong> active
                      </td>
                      <td style={{ fontSize: 12, color: "var(--admin-muted)" }}>{r.vehicle || "—"}</td>
                      <td>
                        <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                          <button
                            onClick={() => onViewShifts(r.id, r.name)}
                            style={{ border: "1px solid #bacbbd", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11 }}
                          >
                            Shifts
                          </button>
                          {canManage && (
                            <>
                              <button
                                onClick={() => startEdit(r)}
                                style={{ border: "1px solid #bacbbd", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11 }}
                              >
                                Edit
                              </button>
                              {(isOnline || isBreak) && (
                                <button
                                  disabled={busy}
                                  onClick={() => forceOffline(r)}
                                  style={{ border: "1px solid #bacbbd", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11, color: "#b06000" }}
                                >
                                  Force offline
                                </button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() => toggleActive(r)}
                                style={{ border: "1px solid #bacbbd", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 11, color: r.isActive ? "#a73535" : "#137333" }}
                              >
                                {r.isActive ? "Deactivate" : "Reactivate"}
                              </button>
                            </>
                          )}
                        </div>
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

// ─── Live Fleet Tab ──────────────────────────────────────────────────────────

function LiveFleetTab({ warehouses }: { warehouses: Warehouse[] }) {
  const [fleet, setFleet] = useState<LiveRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api<{ data: LiveRider[] }>("riders/live");
        if (active) {
          setFleet(res.data ?? []);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load live fleet.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const interval = setInterval(load, 15_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [attempt]);

  return (
    <section className="admin-panel" aria-labelledby="fleet-title">
      <div className="admin-panel-toolbar">
        <h2 id="fleet-title">Live Field Monitoring</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--admin-muted)" }}>Polls every 15s</span>
          <button className="admin-text-button" disabled={loading} onClick={() => setAttempt((v) => v + 1)}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="admin-role-error" style={{ margin: 16 }}>{error}</p>
      ) : loading ? (
        <p className="admin-roles-message" role="status">Tracking riders in field…</p>
      ) : fleet.length === 0 ? (
        <p className="admin-roles-message">No riders currently on active shift.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Rider</th>
                <th>Store / Warehouse</th>
                <th>Status</th>
                <th>Active Orders</th>
                <th>Live Coordinates</th>
                <th>Last Ping</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((r) => {
                const whName = warehouses.find((w) => w.id === r.currentWarehouseId)?.name ?? "—";
                return (
                  <tr key={r.riderId}>
                    <td><strong>{r.name}</strong></td>
                    <td style={{ fontSize: 12 }}>{whName}</td>
                    <td>
                      <span className={`admin-badge ${r.status === "online" ? "admin-badge-active" : "admin-badge-paused"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      {r.activeOrders.length === 0 ? (
                        <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Idle (0 orders)</span>
                      ) : (
                        <div>
                          <strong>{r.activeOrders.length} in flight</strong>
                          <div style={{ fontSize: 11, color: "var(--admin-muted)" }}>
                            {r.activeOrders.map((o) => `#${o.orderNo || o.orderId.slice(-6)} (${o.status})`).join(", ")}
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      {r.location ? (
                        <a
                          href={`https://maps.google.com/?q=${r.location.lat},${r.location.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--admin-accent)", textDecoration: "underline", fontSize: 12 }}
                        >
                          {r.location.lat.toFixed(4)}, {r.location.lng.toFixed(4)} ↗
                        </a>
                      ) : (
                        <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>GPS Pending</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--admin-muted)" }}>{fmtDate(r.lastLocationAt)}</td>
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

// ─── Shifts & Attendance Tab ─────────────────────────────────────────────────

function ShiftsTab({
  warehouses,
  targetRiderId = "",
  targetRiderName = "",
  onClearTarget,
}: {
  warehouses: Warehouse[];
  targetRiderId?: string;
  targetRiderName?: string;
  onClearTarget: () => void;
}) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [attempt, setAttempt] = useState(0);

  const cursor = cursors.at(-1)!;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ limit: "25" });
    if (cursor) params.set("cursor", cursor);
    if (warehouseFilter) params.set("warehouseId", warehouseFilter);

    const endpoint = targetRiderId ? `riders/${targetRiderId}/shifts?${params.toString()}` : `shifts?${params.toString()}`;

    api<{ data: Shift[]; meta?: { nextCursor: string | null } }>(endpoint)
      .then((res) => {
        if (active) {
          setShifts(res.data ?? []);
          setNextCursor(res.meta?.nextCursor ?? null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load shifts.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [targetRiderId, warehouseFilter, cursor, attempt]);

  return (
    <section className="admin-panel" aria-labelledby="shifts-title">
      {targetRiderId && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: "#f5f7f3", borderBottom: "1px solid var(--admin-border)" }}>
          <span style={{ fontSize: 13 }}>
            Showing shift history for <strong>{targetRiderName || targetRiderId}</strong>
          </span>
          <button className="admin-text-button" onClick={onClearTarget} style={{ fontSize: 12 }}>
            Clear filter (View all shifts)
          </button>
        </div>
      )}

      <form
        className="admin-staff-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setCursors([""]);
          setAttempt((v) => v + 1);
        }}
      >
        <label>
          Filter by Warehouse:
          <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </label>
        <button className="admin-role-button" disabled={loading}>Filter</button>
      </form>

      <div className="admin-panel-toolbar">
        <h2 id="shifts-title">{targetRiderId ? "Rider Attendance Log" : "Global Shift Roster"}</h2>
        <span>{loading ? "Loading…" : `${shifts.length} shifts`}</span>
      </div>

      {loading ? (
        <p className="admin-roles-message" role="status">Loading shifts…</p>
      ) : shifts.length === 0 ? (
        <p className="admin-roles-message">No shift records found.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Rider</th>
                <th>Warehouse</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                <th>Punch-in Distance</th>
                <th>Breaks</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const wh = warehouses.find((w) => w.id === s.warehouseId)?.code ?? s.warehouseId.slice(-6);
                const isActive = !s.endedAt;
                return (
                  <tr key={s.id}>
                    <td><code>{s.riderId.slice(-6)}</code></td>
                    <td>{wh}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(s.startedAt)}</td>
                    <td style={{ fontSize: 12 }}>
                      {isActive ? (
                        <span className="admin-badge admin-badge-active">On Shift</span>
                      ) : (
                        fmtDate(s.endedAt)
                      )}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>
                      {calcDuration(s.startedAt, s.endedAt)}
                    </td>
                    <td>
                      <span className={`admin-badge ${s.punchIn.verified ? "admin-badge-active" : "admin-badge-paused"}`}>
                        {s.punchIn.distanceFromWarehouseM}m ({s.punchIn.verified ? "Verified" : "Unverified"})
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {s.breaks.length} break{s.breaks.length !== 1 ? "s" : ""}
                    </td>
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

// ─── Root Riders Component ────────────────────────────────────────────────────

type RiderTab = "directory" | "live" | "shifts";

export default function Riders({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<RiderTab>("directory");
  const [zones, setZones] = useState<Zone[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // Shift inspection filter
  const [shiftRiderId, setShiftRiderId] = useState("");
  const [shiftRiderName, setShiftRiderName] = useState("");

  const canManage =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("riders:manage");
  const canView =
    canManage ||
    session.user.permissions.includes("riders:view");

  useEffect(() => {
    void api<{ data: Zone[] }>("zones").then((res) => {
      setZones(res.data ?? []);
    }).catch(() => {});

    void api<{ data: Warehouse[] }>("warehouses").then((res) => {
      setWarehouses(res.data ?? []);
    }).catch(() => {});
  }, []);

  if (!canView) {
    return (
      <div className="admin-heading">
        <div>
          <h1>Riders &amp; Live Fleet</h1>
          <p>Permission denied: riders:view or riders:manage required.</p>
        </div>
      </div>
    );
  }

  function handleViewShifts(riderId: string, riderName: string) {
    setShiftRiderId(riderId);
    setShiftRiderName(riderName);
    setTab("shifts");
  }

  return (
    <>
      <div className="admin-tab-nav" role="tablist" aria-label="Riders Management Sections">
        {([
          { key: "directory", label: "Rider Directory" },
          { key: "live", label: "Live Fleet" },
          { key: "shifts", label: "Shifts & Attendance" },
        ] as { key: RiderTab; label: string }[]).map((t) => (
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

      {tab === "directory" && (
        <RiderDirectory
          canManage={canManage}
          zones={zones}
          warehouses={warehouses}
          onViewShifts={handleViewShifts}
        />
      )}
      {tab === "live" && <LiveFleetTab warehouses={warehouses} />}
      {tab === "shifts" && (
        <ShiftsTab
          warehouses={warehouses}
          targetRiderId={shiftRiderId}
          targetRiderName={shiftRiderName}
          onClearTarget={() => {
            setShiftRiderId("");
            setShiftRiderName("");
          }}
        />
      )}
    </>
  );
}
