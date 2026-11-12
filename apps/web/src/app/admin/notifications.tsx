"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type DemandItem = {
  zoneId: string;
  productId: string;
  name: string;
  variantId: string | null;
  variantLabel: string | null;
  waiting: number;
  oldestRequestAt: string;
};

type NotificationLog = {
  id: string;
  channel: "push" | "sms" | "whatsapp";
  status: "queued" | "sent" | "delivered" | "failed";
  recipient: string;
  title?: string | null;
  body?: string | null;
  userId?: string | null;
  orderId?: string | null;
  error?: string | null;
  createdAt: string;
  sentAt?: string | null;
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

// ─── Demand Tab ──────────────────────────────────────────────────────────────

function DemandTab({ zones, warehouses }: { zones: Zone[]; warehouses: Warehouse[] }) {
  const [demand, setDemand] = useState<DemandItem[]>([]);
  const [zoneFilter, setZoneFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (zoneFilter) params.set("zoneId", zoneFilter);
    if (warehouseFilter) params.set("warehouseId", warehouseFilter);
    const query = params.toString() ? `?${params.toString()}` : "";

    api<{ data: DemandItem[] }>(`notify-demand${query}`)
      .then((res) => {
        if (active) setDemand(res.data ?? []);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load demand.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [zoneFilter, warehouseFilter, attempt]);

  const totalWaiting = demand.reduce((sum, item) => sum + item.waiting, 0);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div className="admin-panel" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: 13, color: "var(--admin-muted)", textTransform: "uppercase", fontWeight: 600 }}>Total Customer Requests</span>
          <h2 style={{ fontSize: 26, margin: "6px 0 0", color: "var(--admin-accent)" }}>{totalWaiting}</h2>
        </div>
        <div className="admin-panel" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: 13, color: "var(--admin-muted)", textTransform: "uppercase", fontWeight: 600 }}>Out of Stock Products Wanted</span>
          <h2 style={{ fontSize: 26, margin: "6px 0 0" }}>{demand.length}</h2>
        </div>
      </div>

      <section className="admin-panel" aria-labelledby="demand-title">
        <form
          className="admin-staff-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setAttempt((v) => v + 1);
          }}
        >
          <label>
            Filter by Zone:
            <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
              <option value="">All Zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </label>
          <label>
            Filter by Store:
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
          <h2 id="demand-title">Aggregated Customer Demand ("Notify Me")</h2>
          <button className="admin-text-button" disabled={loading} onClick={() => setAttempt((v) => v + 1)}>
            Refresh
          </button>
        </div>

        {error ? (
          <p role="alert" className="admin-role-error" style={{ margin: 16 }}>{error}</p>
        ) : loading ? (
          <p className="admin-roles-message" role="status">Loading demand metrics…</p>
        ) : demand.length === 0 ? (
          <p className="admin-roles-message">No pending customer requests for out-of-stock items.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-product-table">
              <thead>
                <tr>
                  <th>Product Title</th>
                  <th>Variant</th>
                  <th>Zone</th>
                  <th>Waiting Customers</th>
                  <th>Oldest Request</th>
                </tr>
              </thead>
              <tbody>
                {demand.map((d, i) => {
                  const zName = zones.find((z) => z.id === d.zoneId)?.name ?? d.zoneId.slice(-6);
                  return (
                    <tr key={`${d.productId}-${d.variantId ?? "default"}-${i}`}>
                      <td><strong>{d.name || d.productId}</strong></td>
                      <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{d.variantLabel ?? "All variants"}</td>
                      <td>{zName}</td>
                      <td>
                        <span className="admin-badge admin-badge-active" style={{ fontSize: 15, fontWeight: 700 }}>
                          {d.waiting} request{d.waiting !== 1 ? "s" : ""}
                        </span>
                      </td>
                      <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{fmtDate(d.oldestRequestAt)}</td>
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

// ─── Broadcast Campaign Tab ──────────────────────────────────────────────────

function BroadcastTab({ zones }: { zones: Zone[] }) {
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [channels, setChannels] = useState<("push" | "whatsapp")[]>(["push"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (selectedZones.length === 0) throw new Error("Select at least one delivery zone.");
      if (channels.length === 0) throw new Error("Select at least one delivery channel.");

      await api("broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({
          zoneIds: selectedZones,
          title: title.trim(),
          body: bodyText.trim(),
          deepLink: deepLink.trim() || null,
          channels,
        }),
      });

      setNotice("Broadcast campaign successfully dispatched to outbox.");
      setTitle("");
      setBodyText("");
      setDeepLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Broadcast dispatch failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggleZone(zoneId: string) {
    if (selectedZones.includes(zoneId)) setSelectedZones(selectedZones.filter((id) => id !== zoneId));
    else setSelectedZones([...selectedZones, zoneId]);
  }

  function selectAllZones() {
    setSelectedZones(zones.map((z) => z.id));
  }

  function clearAllZones() {
    setSelectedZones([]);
  }

  const zoneNames = zones.filter((z) => selectedZones.includes(z.id)).map((z) => z.name);
  const channelLabel = channels.map((c) => (c === "push" ? "push" : "WhatsApp")).join(" + ");
  const ready = selectedZones.length > 0 && channels.length > 0 && title.trim() !== "" && bodyText.trim() !== "";

  function toggleChannel(channel: "push" | "whatsapp", on: boolean) {
    setChannels(on ? [...channels.filter((c) => c !== channel), channel] : channels.filter((c) => c !== channel));
  }

  return (
    <form onSubmit={submit} aria-busy={busy}>
      <section className="admin-panel" style={{ padding: 0 }}>
        <div className="admin-panel-toolbar">
          <h2>Targeted customer broadcast</h2>
          <span>Send a promo or a service notice to customers in the zones you choose.</span>
        </div>

        {(notice || error) && (
          <div style={{ padding: "16px 24px 0" }}>
            {notice && <p role="status" style={{ color: "#137333", margin: 0, fontWeight: 600 }}>{notice}</p>}
            {error && <p role="alert" className="admin-role-error" style={{ margin: 0 }}>{error}</p>}
          </div>
        )}

        <div className="admin-broadcast">
          <div className="admin-broadcast-col">
            <fieldset>
              <div className="admin-choice-head">
                <legend>1. Who gets it (delivery zones) *</legend>
                <span style={{ display: "flex", gap: 14 }}>
                  <button type="button" className="admin-text-button" onClick={selectAllZones} disabled={busy}>Select all</button>
                  <button type="button" className="admin-text-button" onClick={clearAllZones} disabled={busy}>Clear</button>
                </span>
              </div>
              {zones.length === 0 ? <p className="admin-roles-message" style={{ margin: 0 }}>No delivery zones yet.</p> : (
                <div className="admin-choice-grid">
                  {zones.map((z) => (
                    <label key={z.id} className={`admin-choice${selectedZones.includes(z.id) ? " is-on" : ""}`}>
                      <input type="checkbox" checked={selectedZones.includes(z.id)} onChange={() => toggleZone(z.id)} disabled={busy} />
                      <span>{z.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset>
              <div className="admin-choice-head"><legend>2. How it is sent *</legend></div>
              <div className="admin-choice-grid">
                <label className={`admin-choice${channels.includes("push") ? " is-on" : ""}`}>
                  <input type="checkbox" checked={channels.includes("push")} onChange={(e) => toggleChannel("push", e.target.checked)} disabled={busy} />
                  <span>Mobile push<small>App notification</small></span>
                </label>
                <label className={`admin-choice${channels.includes("whatsapp") ? " is-on" : ""}`}>
                  <input type="checkbox" checked={channels.includes("whatsapp")} onChange={(e) => toggleChannel("whatsapp", e.target.checked)} disabled={busy} />
                  <span>WhatsApp<small>Only customers who opted in</small></span>
                </label>
              </div>
            </fieldset>
          </div>

          <div className="admin-broadcast-col">
            <fieldset>
              <div className="admin-choice-head"><legend>3. The message</legend></div>
              <div className="admin-form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 0 }}>
                <label className="admin-field">
                  Title *
                  <input required maxLength={100} placeholder="e.g. Fresh Darjeeling tea is in stock!" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
                  <small style={{ color: "var(--admin-muted)" }}>{title.length}/100</small>
                </label>
                <label className="admin-field">
                  Message *
                  <textarea required maxLength={500} placeholder="What do you want customers to know?" value={bodyText} onChange={(e) => setBodyText(e.target.value)} disabled={busy} />
                  <small style={{ color: "var(--admin-muted)" }}>{bodyText.length}/500</small>
                </label>
                <label className="admin-field">
                  Opens this screen in the app (optional)
                  <input pattern="^ds:\/\/[a-z]+(\/[A-Za-z0-9_-]+)?$" placeholder="e.g. ds://category/fresh-produce" value={deepLink} onChange={(e) => setDeepLink(e.target.value)} disabled={busy} />
                  <small style={{ color: "var(--admin-muted)" }}>Format: ds://section/optional-id</small>
                </label>
              </div>
            </fieldset>

            <div aria-label="Preview of the notification">
              <strong style={{ display: "block", marginBottom: 8, fontSize: 15 }}>Preview</strong>
              <div className="admin-push-preview">
                <small>Darjeeling Stores · now</small>
                <strong>{title.trim() || "Your title appears here"}</strong>
                <span>{bodyText.trim() || "Your message appears here."}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-broadcast-footer">
          <span style={{ color: "var(--admin-muted)" }}>
            {selectedZones.length === 0 ? "Choose at least one zone." : channels.length === 0 ? "Choose how to send it." : `To customers in ${zoneNames.length > 3 ? `${zoneNames.length} zones` : zoneNames.join(", ")} by ${channelLabel}.`}
          </span>
          <button className="admin-role-button" type="submit" disabled={busy || !ready}>{busy ? "Sending…" : "Send broadcast now"}</button>
        </div>
      </section>
    </form>
  );
}

// ─── Delivery Logs Tab ───────────────────────────────────────────────────────

function LogsTab() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const cursor = cursors.at(-1)!;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    if (channelFilter) params.set("channel", channelFilter);
    if (statusFilter) params.set("status", statusFilter);

    api<{ data: NotificationLog[]; meta?: { nextCursor: string | null } }>(`notifications?${params.toString()}`)
      .then((res) => {
        if (active) {
          setLogs(res.data ?? []);
          setNextCursor(res.meta?.nextCursor ?? null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load logs.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [channelFilter, statusFilter, cursor, attempt]);

  async function retryDelivery(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`notifications/${id}/retry`, {
        method: "POST",
        headers: { "X-CSRF-Token": "1" },
      });
      setNotice("Notification queued for retry.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="logs-title">
      <form
        className="admin-staff-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setCursors([""]);
          setAttempt((v) => v + 1);
        }}
      >
        <label>
          Channel:
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="">All Channels</option>
            <option value="push">Push (FCM)</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </select>
        </label>
        <label>
          Status:
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <button className="admin-role-button" disabled={loading}>Filter</button>
      </form>

      {notice && <p role="status" style={{ color: "#137333", margin: "12px 20px" }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ margin: "12px 20px" }}>{error}</p>}

      <div className="admin-panel-toolbar">
        <h2 id="logs-title">Outbox &amp; Delivery Logs</h2>
        <span>{loading ? "Loading…" : `${logs.length} notifications`}</span>
      </div>

      {loading ? (
        <p className="admin-roles-message" role="status">Loading logs…</p>
      ) : logs.length === 0 ? (
        <p className="admin-roles-message">No notification records found matching criteria.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Message Content</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const isFailed = log.status === "failed";
                const isDelivered = log.status === "delivered";
                return (
                  <tr key={log.id}>
                    <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>{fmtDate(log.createdAt)}</td>
                    <td>
                      <span className="admin-badge" style={{ background: "#f3f1ee", color: "#c62828" }}>
                        {log.channel}
                      </span>
                    </td>
                    <td style={{ fontSize: 14, fontFamily: "monospace" }}>{log.recipient}</td>
                    <td style={{ fontSize: 14, maxWidth: 260 }}>
                      {log.title && <strong>{log.title}: </strong>}
                      {log.body}
                      {log.error && (
                        <div style={{ color: "#a73535", fontSize: 13, marginTop: 2 }}>Error: {log.error}</div>
                      )}
                    </td>
                    <td>
                      <span className={`admin-badge ${isDelivered ? "admin-badge-active" : isFailed ? "admin-badge-disabled" : "admin-badge-paused"}`}>
                        {log.status}
                      </span>
                    </td>
                    <td>
                      {isFailed && (
                        <button
                          disabled={busy}
                          onClick={() => retryDelivery(log.id)}
                          style={{ border: "1px solid #cbc5ba", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 13, color: "var(--admin-accent)" }}
                        >
                          Retry
                        </button>
                      )}
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

// ─── Root Notifications Component ─────────────────────────────────────────────

type NotifTab = "demand" | "broadcast" | "logs";

export default function Notifications({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<NotifTab>("demand");
  const [zones, setZones] = useState<Zone[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const canManage =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("notifications:manage");
  const canViewDemand =
    canManage ||
    session.user.permissions.includes("notify_demand:view");

  useEffect(() => {
    void api<{ data: Zone[] }>("zones").then((res) => {
      setZones(res.data ?? []);
    }).catch(() => {});

    void api<{ data: Warehouse[] }>("warehouses").then((res) => {
      setWarehouses(res.data ?? []);
    }).catch(() => {});
  }, []);

  if (!canManage && !canViewDemand) {
    return (
      <div className="admin-heading">
        <div>
          <h1>Notifications &amp; Campaigns</h1>
          <p>Permission denied: notifications:manage or notify_demand:view required.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 12 }}>
        <div>
          <h1>Notifications, Campaigns &amp; Demand</h1>
          <p>Customer stock demand tracking, push and WhatsApp broadcast campaigns, and delivery logs. Order and delivery messages use built-in wording.</p>
        </div>
      </div>

      <div className="admin-tab-nav" role="tablist" aria-label="Notification sections">
        {([
          ...(canViewDemand ? [{ key: "demand", label: "Stock Demand (Notify Me)" }] : []),
          ...(canManage ? [
            { key: "broadcast", label: "Zone Broadcasts" },
            { key: "logs", label: "Delivery Logs" },
          ] : []),
        ] as { key: NotifTab; label: string }[]).map((t) => (
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

      {tab === "demand" && <DemandTab zones={zones} warehouses={warehouses} />}
      {tab === "broadcast" && <BroadcastTab zones={zones} />}
      {tab === "logs" && <LogsTab />}
    </>
  );
}
