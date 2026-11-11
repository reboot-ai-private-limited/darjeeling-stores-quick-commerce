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

type NotificationTemplate = {
  id: string;
  key: string;
  channel: "push" | "sms" | "whatsapp";
  title: string | null;
  body: string;
  whatsappTemplateName: string | null;
  category: "utility" | "marketing" | "authentication";
  language: string;
  isActive: boolean;
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

// ─── Templates Tab ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Form state
  const [editing, setEditing] = useState<NotificationTemplate | "new" | null>(null);
  const [key, setKey] = useState("");
  const [channel, setChannel] = useState<"push" | "sms" | "whatsapp">("push");
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [whatsappTemplateName, setWhatsappTemplateName] = useState("");
  const [category, setCategory] = useState<"utility" | "marketing" | "authentication">("utility");
  const [language, setLanguage] = useState("en");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    api<{ data: NotificationTemplate[] }>("notification-templates")
      .then((res) => {
        if (active) setTemplates(res.data ?? []);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load templates.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [attempt]);

  function startCreate() {
    setEditing("new");
    setKey("");
    setChannel("push");
    setTitle("");
    setBodyText("");
    setWhatsappTemplateName("");
    setCategory("utility");
    setLanguage("en");
    setIsActive(true);
    setFormError("");
  }

  function startEdit(t: NotificationTemplate) {
    setEditing(t);
    setKey(t.key);
    setChannel(t.channel);
    setTitle(t.title ?? "");
    setBodyText(t.body);
    setWhatsappTemplateName(t.whatsappTemplateName ?? "");
    setCategory(t.category);
    setLanguage(t.language);
    setIsActive(t.isActive);
    setFormError("");
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const isNew = editing === "new";
      const payload = {
        key: key.trim().toLowerCase(),
        channel,
        title: title.trim() || null,
        body: bodyText.trim(),
        whatsappTemplateName: channel === "whatsapp" ? (whatsappTemplateName.trim() || null) : null,
        category,
        language: language.trim() || "en",
        isActive,
      };

      if (isNew) {
        await api("notification-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify(payload),
        });
        setNotice("Template created.");
      } else {
        await api(`notification-templates/${(editing as NotificationTemplate).id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify(payload),
        });
        setNotice("Template updated.");
      }
      setEditing(null);
      setAttempt((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save template.");
    } finally {
      setBusy(false);
    }
  }

  // Detect variables like {{name}} or {{orderNo}}
  const detectedVariables = Array.from(bodyText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map((m) => m[1]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>Message Templates</h2>
          <p style={{ margin: "2px 0 0", fontSize: 14, color: "var(--admin-muted)" }}>Templates for Push notifications, SMS alerts, and Meta WhatsApp Cloud.</p>
        </div>
        <button className="admin-role-button" onClick={startCreate}>
          New Template
        </button>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {editing && (
        <form className="admin-panel admin-role-form" onSubmit={saveTemplate} style={{ marginBottom: 20 }}>
          <h2>{editing === "new" ? "Create Notification Template" : `Edit Template: ${key}`}</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 2, fontSize: 14 }}>
                Template Key (lower_snake_case) *
                <input
                  required
                  pattern="^[a-z][a-z0-9_]{1,63}$"
                  placeholder="e.g. order_out_for_delivery"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={busy || editing !== "new"}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                />
              </label>
              <label style={{ flex: 1, fontSize: 14 }}>
                Channel *
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as typeof channel)}
                  disabled={busy}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                >
                  <option value="push">Push (FCM)</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1, fontSize: 14 }}>
                Category *
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as typeof category)}
                  disabled={busy}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                >
                  <option value="utility">Utility</option>
                  <option value="marketing">Marketing</option>
                  <option value="authentication">Authentication</option>
                </select>
              </label>
              <label style={{ width: 120, fontSize: 14 }}>
                Language Code *
                <input
                  required
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="en or en_US"
                  disabled={busy}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                />
              </label>
            </div>

            {channel !== "sms" && (
              <label style={{ fontSize: 14 }}>
                Title (Optional)
                <input
                  maxLength={100}
                  placeholder="e.g. Order on the way!"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                />
              </label>
            )}

            {channel === "whatsapp" && (
              <label style={{ fontSize: 14 }}>
                Meta WhatsApp Approved Template Name *
                <input
                  required
                  pattern="^[a-z0-9_]{1,512}$"
                  placeholder="e.g. ds_order_shipped_v1"
                  value={whatsappTemplateName}
                  onChange={(e) => setWhatsappTemplateName(e.target.value)}
                  disabled={busy}
                  style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
                />
              </label>
            )}

            <label style={{ fontSize: 14 }}>
              Message Body * (Use <code>&#123;&#123;var&#125;&#125;</code> for placeholders)
              <textarea
                required
                maxLength={1024}
                placeholder="Hello {{customerName}}, your order #{{orderNo}} will arrive in {{etaMinutes}} minutes."
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                disabled={busy}
                style={{ display: "block", marginTop: 4, width: "100%", minHeight: 90, padding: 8, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", resize: "vertical" }}
              />
            </label>

            {detectedVariables.length > 0 && (
              <div style={{ fontSize: 13, color: "var(--admin-muted)" }}>
                Detected variables:{" "}
                {detectedVariables.map((v, i) => (
                  <span key={i} className="admin-badge admin-badge-active" style={{ marginRight: 4, fontSize: 12 }}>
                    {v}
                  </span>
                ))}
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={busy}
              />
              Active (Enabled for delivery)
            </label>
          </div>

          {formError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{formError}</p>}

          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save Template"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="templates-title">
        <div className="admin-panel-toolbar">
          <h2 id="templates-title">Registered Templates</h2>
          <span>{loading ? "Loading…" : `${templates.length} templates`}</span>
        </div>
        {loading ? (
          <p className="admin-roles-message" role="status">Loading templates…</p>
        ) : templates.length === 0 ? (
          <p className="admin-roles-message">No message templates configured.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-product-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Channel</th>
                  <th>Category</th>
                  <th>Preview</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <code>{t.key}</code>
                      {t.whatsappTemplateName && (
                        <small style={{ display: "block", color: "var(--admin-muted)" }}>Meta: {t.whatsappTemplateName}</small>
                      )}
                    </td>
                    <td>
                      <span className="admin-badge" style={{ background: "#f3f1ee", color: "#c62828" }}>
                        {t.channel}
                      </span>
                    </td>
                    <td style={{ fontSize: 14 }}>{t.category}</td>
                    <td style={{ fontSize: 14, maxWidth: 300, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.title ? <strong>{t.title}: </strong> : null}
                      {t.body}
                    </td>
                    <td>
                      <span className={`admin-badge ${t.isActive ? "admin-badge-active" : "admin-badge-disabled"}`}>
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => startEdit(t)}
                        style={{ border: "1px solid #cbc5ba", borderRadius: 4, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 13 }}
                      >
                        Edit
                      </button>
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

  return (
    <form className="admin-panel admin-role-form" onSubmit={submit} style={{ maxWidth: 580 }}>
      <h2>Targeted Customer Broadcast</h2>
      <p style={{ fontSize: 14, color: "var(--admin-muted)" }}>
        Send promotional alerts or emergency service notifications to active customers in selected delivery zones.
      </p>

      {notice && <p role="status" style={{ color: "#137333", margin: "8px 0" }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ margin: "8px 0" }}>{error}</p>}

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <fieldset style={{ border: "1px solid var(--admin-border)", borderRadius: 6, padding: "10px 14px", margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <legend style={{ fontSize: 14, fontWeight: 600 }}>Target Delivery Zones *</legend>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="admin-text-button" onClick={selectAllZones} style={{ fontSize: 13, padding: 0 }}>All</button>
              <button type="button" className="admin-text-button" onClick={clearAllZones} style={{ fontSize: 13, padding: 0 }}>Clear</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {zones.map((z) => (
              <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={selectedZones.includes(z.id)}
                  onChange={() => toggleZone(z.id)}
                  disabled={busy}
                />
                <span>{z.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: "1px solid var(--admin-border)", borderRadius: 6, padding: "10px 14px", margin: 0 }}>
          <legend style={{ fontSize: 14, fontWeight: 600 }}>Broadcast Channels *</legend>
          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={channels.includes("push")}
                onChange={(e) => {
                  if (e.target.checked) setChannels([...channels, "push"]);
                  else setChannels(channels.filter((c) => c !== "push"));
                }}
                disabled={busy}
              />
              Mobile Push Notification
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={channels.includes("whatsapp")}
                onChange={(e) => {
                  if (e.target.checked) setChannels([...channels, "whatsapp"]);
                  else setChannels(channels.filter((c) => c !== "whatsapp"));
                }}
                disabled={busy}
              />
              WhatsApp Broadcast
            </label>
          </div>
        </fieldset>

        <label style={{ fontSize: 14 }}>
          Broadcast Title *
          <input
            required
            maxLength={100}
            placeholder="e.g. Fresh Darjeeling Organic Tea in stock!"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
          />
        </label>

        <label style={{ fontSize: 14 }}>
          Message Body *
          <textarea
            required
            maxLength={500}
            placeholder="Enter the broadcast notification message"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            disabled={busy}
            style={{ display: "block", marginTop: 4, width: "100%", minHeight: 80, padding: 8, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", resize: "vertical" }}
          />
        </label>

        <label style={{ fontSize: 14 }}>
          In-App Deep Link (optional)
          <input
            pattern="^ds:\/\/[a-z]+(\/[A-Za-z0-9_-]+)?$"
            placeholder="e.g. ds://category/fresh-produce"
            value={deepLink}
            onChange={(e) => setDeepLink(e.target.value)}
            disabled={busy}
            style={{ display: "block", marginTop: 4, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
          />
          <small style={{ color: "var(--admin-muted)" }}>Format: ds://[section]/[optional-id]</small>
        </label>
      </div>

      <div className="admin-role-actions" style={{ marginTop: 18, padding: 0 }}>
        <button className="admin-role-button" type="submit" disabled={busy}>
          {busy ? "Broadcasting…" : "Send Broadcast Now"}
        </button>
      </div>
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

type NotifTab = "demand" | "templates" | "broadcast" | "logs";

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
          <p>Customer stock demand tracking, push/SMS/WhatsApp broadcast campaigns, and delivery logs.</p>
        </div>
      </div>

      <div className="admin-tab-nav" role="tablist" aria-label="Notification sections">
        {([
          ...(canViewDemand ? [{ key: "demand", label: "Stock Demand (Notify Me)" }] : []),
          ...(canManage ? [
            { key: "templates", label: "Message Templates" },
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
      {tab === "templates" && <TemplatesTab />}
      {tab === "broadcast" && <BroadcastTab zones={zones} />}
      {tab === "logs" && <LogsTab />}
    </>
  );
}
