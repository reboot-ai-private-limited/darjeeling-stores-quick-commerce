"use client";

import { useEffect, useState, type FormEvent } from "react";
import { GOOGLE_MAPS_KEY, GoogleLocationPicker, pointInRing, ringCentroid, type LngLat } from "./google-map";
import { adminFetch, type AdminSession } from "./session-client";

interface Warehouse {
  id: string;
  zoneId: string;
  name: string;
  code: string;
  location: { lat: number; lng: number };
  address: string;
  isEnabled: boolean;
  priority: number;
  packMinutes: number;
  riderArrivalMinutes: number;
  defaultTravelMinutes: number;
  punchInRadiusMeters: number;
  pause: { active: boolean; message: string; until?: string | null } | null;
}

interface ZoneOption {
  id: string;
  name: string;
  ring: LngLat[];
}

interface Props {
  session: AdminSession;
}

function toLocalInputDate(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputDate(localString: string): string | null {
  const trimmed = localString.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseIntegerWithDefault(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export default function Warehouses({ session }: Props) {
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Filters
  const [zoneFilter, setZoneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "true" | "false">("");

  // Editing state
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null);
  const [zoneId, setZoneId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [address, setAddress] = useState("");
  const [priority, setPriority] = useState("1");
  const [packMinutes, setPackMinutes] = useState("5");
  const [riderArrivalMinutes, setRiderArrivalMinutes] = useState("5");
  const [defaultTravelMinutes, setDefaultTravelMinutes] = useState("10");
  const [punchInRadiusMeters, setPunchInRadiusMeters] = useState("150");
  const [isEnabled, setIsEnabled] = useState(true);

  // Pause state
  const [pauseActive, setPauseActive] = useState(false);
  const [pauseMessage, setPauseMessage] = useState("");
  const [pauseUntil, setPauseUntil] = useState("");

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [disableWarning, setDisableWarning] = useState("");

  const canManageWarehouses =
    session.user.permissions.includes("*") || session.user.permissions.includes("warehouses:manage");
  const canCreate = canManageWarehouses && session.user.scope.all;
  const canManageOps =
    session.user.permissions.includes("*") || session.user.permissions.includes("ops_mode:manage");

  // Load zones
  useEffect(() => {
    const controller = new AbortController();
    async function loadZones() {
      try {
        const res = await adminFetch("/api/v1/admin/zones", { signal: controller.signal });
        if (res.ok) {
          const body = await res.json();
          setZones((body.data ?? []).map((z: { id: string; name: string; polygon?: { coordinates?: LngLat[][] } }) => ({ id: z.id, name: z.name, ring: z.polygon?.coordinates?.[0] ?? [] })));
        }
      } catch {}
    }
    void loadZones();
    return () => controller.abort();
  }, []);

  // Load warehouses
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    async function loadWarehouses() {
      try {
        const params = new URLSearchParams();
        if (zoneFilter) params.set("zoneId", zoneFilter);
        if (statusFilter) params.set("isEnabled", statusFilter);
        const query = params.toString() ? `?${params.toString()}` : "";

        const res = await adminFetch(`/api/v1/admin/warehouses${query}`, { signal: controller.signal });
        if (res.status === 401) throw new Error("Your session has expired. Sign out and sign in again.");
        if (res.status === 403) throw new Error("Permission denied: warehouses:view required.");
        if (!res.ok) throw new Error("Warehouses could not be loaded.");
        const body = await res.json();
        setWarehouses(body.data ?? []);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load warehouses.");
        }
      }
    }
    void loadWarehouses();
    return () => controller.abort();
  }, [attempt, zoneFilter, statusFilter]);

  function startEdit(wh: Warehouse | "new") {
    setEditing(wh);
    setFormError("");
    setDisableWarning("");
    if (wh === "new") {
      setZoneId(zones.length > 0 ? zones[0]!.id : "");
      setName("");
      setCode("");
      setLat("27.0410");
      setLng("88.2663");
      setAddress("");
      setPriority("1");
      setPackMinutes("5");
      setRiderArrivalMinutes("5");
      setDefaultTravelMinutes("10");
      setPunchInRadiusMeters("150");
      setIsEnabled(true);
      setPauseActive(false);
      setPauseMessage("");
      setPauseUntil("");
    } else {
      setZoneId(wh.zoneId);
      setName(wh.name);
      setCode(wh.code);
      setLat(String(wh.location.lat));
      setLng(String(wh.location.lng));
      setAddress(wh.address);
      setPriority(String(wh.priority));
      setPackMinutes(String(wh.packMinutes));
      setRiderArrivalMinutes(String(wh.riderArrivalMinutes));
      setDefaultTravelMinutes(String(wh.defaultTravelMinutes));
      setPunchInRadiusMeters(String(wh.punchInRadiusMeters));
      setIsEnabled(wh.isEnabled);
      setPauseActive(wh.pause?.active ?? false);
      setPauseMessage(wh.pause?.message ?? "");
      setPauseUntil(toLocalInputDate(wh.pause?.until));
    }
  }

  function chooseZone(id: string) {
    setZoneId(id);
    const z = zones.find((x) => x.id === id);
    if (!z || z.ring.length < 3) return;
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (Number.isNaN(la) || Number.isNaN(ln) || !pointInRing(ln, la, z.ring)) {
      const c = ringCentroid(z.ring);
      setLat(c.lat.toFixed(6));
      setLng(c.lng.toFixed(6));
    }
  }

  function pickLocation(la: number, ln: number) {
    setLat(la.toFixed(6));
    setLng(ln.toFixed(6));
    if (editing === "new") {
      const hit = zones.find((z) => z.ring.length >= 3 && pointInRing(ln, la, z.ring));
      if (hit && hit.id !== zoneId) setZoneId(hit.id);
    }
  }

  async function saveWarehouse(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setDisableWarning("");

    try {
      const isNew = editing === "new";
      const path = isNew ? "/api/v1/admin/warehouses" : `/api/v1/admin/warehouses/${(editing as Warehouse).id}`;
      const method = isNew ? "POST" : "PUT";

      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (isNaN(latNum) || isNaN(lngNum)) {
        throw new Error("Latitude and Longitude must be valid numbers.");
      }

      let pausePayload = undefined;
      if (canManageOps) {
        if (!pauseActive) {
          pausePayload = isNew ? undefined : null;
        } else {
          pausePayload = {
            active: true,
            message: pauseMessage || "Temporary warehouse pause",
            until: fromLocalInputDate(pauseUntil),
          };
        }
      }

      const body = isNew
        ? {
            zoneId,
            name,
            code: code.trim().toUpperCase(),
            location: { lat: latNum, lng: lngNum },
            address,
            priority: parseIntegerWithDefault(priority, 1),
            packMinutes: parseIntegerWithDefault(packMinutes, 5),
            riderArrivalMinutes: parseIntegerWithDefault(riderArrivalMinutes, 5),
            defaultTravelMinutes: parseIntegerWithDefault(defaultTravelMinutes, 10),
            punchInRadiusMeters: parseIntegerWithDefault(punchInRadiusMeters, 150),
          }
        : {
            name,
            location: { lat: latNum, lng: lngNum },
            address,
            isEnabled,
            priority: parseIntegerWithDefault(priority, 1),
            packMinutes: parseIntegerWithDefault(packMinutes, 5),
            riderArrivalMinutes: parseIntegerWithDefault(riderArrivalMinutes, 5),
            defaultTravelMinutes: parseIntegerWithDefault(defaultTravelMinutes, 10),
            punchInRadiusMeters: parseIntegerWithDefault(punchInRadiusMeters, 150),
            ...(pausePayload !== undefined && { pause: pausePayload }),
          };

      const res = await adminFetch(path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error?.code === "CONFLICT" && !isEnabled && !(editing as Warehouse).isEnabled) {
          // Guarded disable conflict
          if (data.error.details?.activeOrders !== undefined) {
            setDisableWarning(
              `Guarded disable blocked: Warehouse has ${data.error.details.activeOrders} active orders in progress.`
            );
          } else {
            setDisableWarning(
              "Guarded disable blocked: Authoritative active order/rider dependency check is currently unavailable."
            );
          }
          throw new Error(data.error.message);
        }
        throw new Error(data.error?.message ?? "Warehouse could not be saved.");
      }

      setEditing(null);
      setAttempt((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Warehouse could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function canEditWarehouse(wh: Warehouse): boolean {
    if (!canManageWarehouses) return false;
    return session.user.scope.all || session.user.scope.warehouseIds.includes(wh.id);
  }

  return (
    <>
      <div className="admin-heading">
        <div>
          <h1>Warehouses</h1>
          <p>Manage fulfillment stores, operating parameters, and punch-in boundaries.</p>
        </div>
        <div className="admin-role-actions">
          {canCreate && (
            <button className="admin-role-button" disabled={busy} onClick={() => startEdit("new")}>
              Create warehouse
            </button>
          )}
        </div>
      </div>

      {!session.user.scope.all && (
        <div className="admin-sidebar-note" style={{ background: "#fdf8ee", margin: "0 0 20px", borderRadius: 6 }}>
          <span>
            <strong>Scoped staff access:</strong> Showing only warehouses assigned to your role ({session.user.scope.warehouseIds.length} warehouses).
          </span>
        </div>
      )}

      {formError && (
        <div className="admin-role-error" role="alert" style={{ marginBottom: 20 }}>
          <p style={{ margin: 0 }}>{formError}</p>
          {disableWarning && <p style={{ margin: "6px 0 0", fontWeight: 600 }}>{disableWarning}</p>}
        </div>
      )}

      {editing && (
        <form
          className="admin-panel admin-role-form"
          onSubmit={saveWarehouse}
          aria-label={editing === "new" ? "Create warehouse" : "Edit warehouse"}
        >
          <h2>{editing === "new" ? "Create warehouse" : `Edit ${editing.name}`}</h2>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 640 }}>
            {editing === "new" ? (
              <div style={{ flex: 1, minWidth: 240 }}>
                <label htmlFor="wh-zone">Zone (fulfillment area)</label>
                <select
                  id="wh-zone"
                  value={zoneId}
                  onChange={(e) => chooseZone(e.target.value)}
                  required
                  disabled={busy}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "1px solid #cbc5ba",
                    borderRadius: 6,
                    marginTop: 7,
                  }}
                >
                  <option value="">Select a zone</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 240 }}>
                <label>Zone (immutable)</label>
                <input
                  value={zones.find((z) => z.id === editing.zoneId)?.name ?? editing.zoneId}
                  disabled
                  style={{ marginTop: 7, background: "#f7f6f3" }}
                />
              </div>
            )}

            <div style={{ width: 140 }}>
              <label htmlFor="wh-code">Store Code</label>
              <input
                id="wh-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={20}
                disabled={busy || editing !== "new"}
                placeholder="e.g. CHOW-1"
                style={{
                  marginTop: 7,
                  textTransform: "uppercase",
                  background: editing !== "new" ? "#f7f6f3" : "#fff",
                }}
              />
            </div>
          </div>

          <label htmlFor="wh-name" style={{ marginTop: 14 }}>
            Store Name
          </label>
          <input
            id="wh-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            disabled={busy}
            placeholder="e.g. Chowrasta Store"
          />

          {GOOGLE_MAPS_KEY && (
            <div style={{ marginTop: 14, maxWidth: 640 }}>
              <label>Choose location on map</label>
              <GoogleLocationPicker lat={lat.trim() === "" || Number.isNaN(parseFloat(lat)) ? null : parseFloat(lat)} lng={lng.trim() === "" || Number.isNaN(parseFloat(lng)) ? null : parseFloat(lng)} zones={zones.filter((z) => z.ring.length >= 3)} selectedZoneId={zoneId} onPick={pickLocation} disabled={busy} />
              <small style={{ color: "#716e68" }}>Click the map or drag the pin. Latitude, longitude and (when creating) the zone update automatically; typing coordinates moves the pin.</small>
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 14, maxWidth: 460 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="wh-lat">Latitude</label>
              <input
                id="wh-lat"
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                required
                disabled={busy}
                placeholder="27.0410"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="wh-lng">Longitude</label>
              <input
                id="wh-lng"
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                required
                disabled={busy}
                placeholder="88.2663"
              />
            </div>
          </div>

          <label htmlFor="wh-address" style={{ marginTop: 14 }}>
            Address
          </label>
          <textarea
            id="wh-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            minLength={3}
            maxLength={500}
            disabled={busy}
            placeholder="e.g. Mall Road, Near Clock Tower, Darjeeling"
            style={{
              width: "100%",
              maxWidth: 540,
              minHeight: 70,
              padding: 10,
              border: "1px solid #cbc5ba",
              borderRadius: 6,
              marginTop: 7,
              font: "inherit",
            }}
          />

          <fieldset style={{ marginTop: 18, border: "1px solid var(--admin-border)", borderRadius: 6, padding: 14 }}>
            <legend style={{ fontSize: 14, fontWeight: 600 }}>Dispatch &amp; Operations Parameters</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
              <label>
                Priority (1 = highest)
                <input
                  type="number"
                  min="1"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  disabled={busy}
                  style={{ marginTop: 4 }}
                />
              </label>
              <label>
                Pack Minutes
                <input
                  type="number"
                  min="0"
                  value={packMinutes}
                  onChange={(e) => setPackMinutes(e.target.value)}
                  disabled={busy}
                  style={{ marginTop: 4 }}
                />
              </label>
              <label>
                Rider Arrival Min
                <input
                  type="number"
                  min="0"
                  value={riderArrivalMinutes}
                  onChange={(e) => setRiderArrivalMinutes(e.target.value)}
                  disabled={busy}
                  style={{ marginTop: 4 }}
                />
              </label>
              <label>
                Default Travel Min
                <input
                  type="number"
                  min="0"
                  value={defaultTravelMinutes}
                  onChange={(e) => setDefaultTravelMinutes(e.target.value)}
                  disabled={busy}
                  style={{ marginTop: 4 }}
                />
              </label>
              <label>
                Punch-in Radius (m)
                <input
                  type="number"
                  min="0"
                  value={punchInRadiusMeters}
                  onChange={(e) => setPunchInRadiusMeters(e.target.value)}
                  disabled={busy}
                  style={{ marginTop: 4 }}
                />
              </label>
            </div>
          </fieldset>

          {editing !== "new" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                disabled={busy}
              />
              <span>Enabled for order fulfillment (unchecking initiates guarded disable verification)</span>
            </label>
          )}

          {canManageOps && editing !== "new" && (
            <fieldset style={{ marginTop: 18, border: "1px solid var(--admin-border)", borderRadius: 6, padding: 14 }}>
              <legend style={{ fontSize: 14, fontWeight: 600 }}>Warehouse Operations Pause (F17)</legend>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={pauseActive}
                  onChange={(e) => setPauseActive(e.target.checked)}
                  disabled={busy}
                />
                <span>Pause this warehouse immediately</span>
              </label>

              {pauseActive && (
                <div style={{ display: "grid", gap: 10 }}>
                  <label>
                    Pause Message:
                    <input
                      value={pauseMessage}
                      onChange={(e) => setPauseMessage(e.target.value)}
                      placeholder="e.g. Store inventory check"
                      disabled={busy}
                      style={{ marginTop: 4 }}
                    />
                  </label>
                  <label>
                    Auto-resume until:
                    <input
                      type="datetime-local"
                      value={pauseUntil}
                      onChange={(e) => setPauseUntil(e.target.value)}
                      disabled={busy}
                      style={{ marginTop: 4, maxWidth: 260 }}
                    />
                  </label>
                </div>
              )}
            </fieldset>
          )}

          <div className="admin-role-actions" style={{ marginTop: 24 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save warehouse"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="warehouses-title">
        <div className="admin-staff-filters">
          <label>
            Filter by Zone:
            <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
              <option value="">All Zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter by Status:
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | "true" | "false")}
            >
              <option value="">All Statuses</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
        </div>

        <div className="admin-panel-toolbar">
          <h2 id="warehouses-title">Warehouses</h2>
          <span>{warehouses?.length ?? 0} stores</span>
        </div>

        {error ? (
          <div className="admin-panel admin-roles-message" role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((v) => v + 1)}>Try again</button>
          </div>
        ) : !warehouses ? (
          <p role="status">Loading warehouses…</p>
        ) : warehouses.length === 0 ? (
          <p className="admin-roles-message">No warehouses match the selected criteria.</p>
        ) : (
          <div className="admin-geo-grid">
            {warehouses.map((wh) => {
              const zoneName = zones.find((z) => z.id === wh.zoneId)?.name ?? "Zone";
              const isPaused = wh.pause?.active;
              const allowedToEdit = canEditWarehouse(wh);

              return (
                <article key={wh.id} className="admin-geo-card">
                  <h3>
                    <span>
                      <strong style={{ marginRight: 8, color: "var(--admin-accent)" }}>{wh.code}</strong>
                      {wh.name}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {isPaused && <span className="admin-badge admin-badge-paused">Paused</span>}
                      <span
                        className={`admin-badge ${
                          wh.isEnabled ? "admin-badge-enabled" : "admin-badge-disabled"
                        }`}
                      >
                        {wh.isEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </h3>
                  <p>{wh.address}</p>
                  <div className="admin-geo-meta">
                    <span>Zone: {zoneName}</span>
                    <span>Priority: {wh.priority}</span>
                    <span>
                      Timers: {wh.packMinutes}m pack / {wh.riderArrivalMinutes}m arrival /{" "}
                      {wh.defaultTravelMinutes}m travel
                    </span>
                    <span>Radius: {wh.punchInRadiusMeters}m</span>
                    {isPaused && (
                      <span style={{ color: "#b06000" }}>
                        Pause reason: {wh.pause?.message}
                      </span>
                    )}
                  </div>
                  {allowedToEdit && (
                    <div className="admin-role-actions" style={{ padding: "8px 0 0" }}>
                      <button disabled={busy} onClick={() => startEdit(wh)}>
                        Edit warehouse
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
