"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

interface GeoPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

interface ZonePause {
  active: boolean;
  message: string;
  until?: string | null;
}

interface Zone {
  id: string;
  cityId: string;
  name: string;
  polygon: GeoPolygon;
  isEnabled: boolean;
  pause: ZonePause | null;
}

interface CityOption {
  id: string;
  name: string;
  state: string;
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

export default function ZonesEditor({ session }: Props) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [cityFilter, setCityFilter] = useState("");

  const [editing, setEditing] = useState<Zone | "new" | null>(null);
  const [name, setName] = useState("");
  const [cityId, setCityId] = useState("");
  const [coords, setCoords] = useState<[number, number][]>([
    [88.26, 27.035],
    [88.275, 27.035],
    [88.275, 27.05],
    [88.26, 27.05],
    [88.26, 27.035],
  ]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [pauseActive, setPauseActive] = useState(false);
  const [pauseMessage, setPauseMessage] = useState("");
  const [pauseUntil, setPauseUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [overlapDetails, setOverlapDetails] = useState<{ zoneId?: string; name?: string } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const canManageOps =
    session.user.permissions.includes("*") || session.user.permissions.includes("ops_mode:manage");

  // Load cities
  useEffect(() => {
    const controller = new AbortController();
    async function loadCities() {
      try {
        const res = await adminFetch("/api/v1/admin/cities", { signal: controller.signal });
        if (res.ok) {
          const body = await res.json();
          setCities(body.data ?? []);
        }
      } catch {}
    }
    void loadCities();
    return () => controller.abort();
  }, []);

  // Load zones
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    async function loadZones() {
      try {
        const query = cityFilter ? `?cityId=${encodeURIComponent(cityFilter)}` : "";
        const res = await adminFetch(`/api/v1/admin/zones${query}`, { signal: controller.signal });
        if (res.status === 401) throw new Error("Your session has expired. Sign out and sign in again.");
        if (res.status === 403) throw new Error("Permission denied: zones:manage with all-warehouse scope required.");
        if (!res.ok) throw new Error("Zones could not be loaded.");
        const body = await res.json();
        setZones(body.data ?? []);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load zones.");
        }
      }
    }
    void loadZones();
    return () => controller.abort();
  }, [attempt, cityFilter]);

  function startEdit(zone: Zone | "new") {
    setEditing(zone);
    setFormError("");
    setOverlapDetails(null);
    if (zone === "new") {
      setCityId(cityFilter || (cities.length > 0 ? cities[0]!.id : ""));
      setName("");
      setCoords([
        [88.26, 27.035],
        [88.275, 27.035],
        [88.275, 27.05],
        [88.26, 27.05],
        [88.26, 27.035],
      ]);
      setIsEnabled(true);
      setPauseActive(false);
      setPauseMessage("");
      setPauseUntil("");
    } else {
      setCityId(zone.cityId);
      setName(zone.name);
      setCoords(zone.polygon.coordinates[0] ? [...zone.polygon.coordinates[0]] : []);
      setIsEnabled(zone.isEnabled);
      setPauseActive(zone.pause?.active ?? false);
      setPauseMessage(zone.pause?.message ?? "");
      setPauseUntil(toLocalInputDate(zone.pause?.until));
    }
  }

  // Polygon bounding box calculation for interactive SVG map
  const mapBounds = useMemo(() => {
    if (coords.length === 0) return { minX: 88.25, maxX: 88.29, minY: 27.03, maxY: 27.06 };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minX) minX = lng;
      if (lng > maxX) maxX = lng;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
    }
    const padX = Math.max((maxX - minX) * 0.25, 0.005);
    const padY = Math.max((maxY - minY) * 0.25, 0.005);
    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY,
    };
  }, [coords]);

  function toSvgX(lng: number): number {
    return ((lng - mapBounds.minX) / (mapBounds.maxX - mapBounds.minX)) * 400;
  }
  function toSvgY(lat: number): number {
    return 300 - ((lat - mapBounds.minY) / (mapBounds.maxY - mapBounds.minY)) * 300;
  }

  function fromSvgX(x: number): number {
    return mapBounds.minX + (x / 400) * (mapBounds.maxX - mapBounds.minX);
  }
  function fromSvgY(y: number): number {
    return mapBounds.minY + ((300 - y) / 300) * (mapBounds.maxY - mapBounds.minY);
  }

  function handleVertexPointerDown(e: PointerEvent<SVGCircleElement>, index: number) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDraggedIndex(index);
  }

  function handleSvgPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (draggedIndex === null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const svgX = Math.max(0, Math.min(400, ((e.clientX - rect.left) / rect.width) * 400));
    const svgY = Math.max(0, Math.min(300, ((e.clientY - rect.top) / rect.height) * 300));

    const newLng = parseFloat(fromSvgX(svgX).toFixed(6));
    const newLat = parseFloat(fromSvgY(svgY).toFixed(6));

    setCoords((prev) => {
      const next = [...prev];
      next[draggedIndex] = [newLng, newLat];
      if (draggedIndex === 0 && next.length > 0) {
        next[next.length - 1] = [newLng, newLat];
      } else if (draggedIndex === next.length - 1 && next.length > 0) {
        next[0] = [newLng, newLat];
      }
      return next;
    });
  }

  function handleSvgPointerUp(e: PointerEvent<SVGSVGElement | SVGCircleElement>) {
    if (draggedIndex !== null) {
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      setDraggedIndex(null);
    }
  }

  const svgPoints = useMemo(() => {
    return coords.map(([lng, lat]) => `${toSvgX(lng).toFixed(1)},${toSvgY(lat).toFixed(1)}`).join(" ");
  }, [coords, mapBounds]);

  function updateCoord(index: number, lngVal: string, latVal: string) {
    const lng = parseFloat(lngVal);
    const lat = parseFloat(latVal);
    if (isNaN(lng) || isNaN(lat)) return;

    setCoords((prev) => {
      const next = [...prev];
      next[index] = [lng, lat];
      // Keep closure: if changing first, update last; if changing last, update first
      if (index === 0 && next.length > 0) {
        next[next.length - 1] = [lng, lat];
      } else if (index === next.length - 1 && next.length > 0) {
        next[0] = [lng, lat];
      }
      return next;
    });
  }

  function addCoord() {
    setCoords((prev) => {
      if (prev.length < 2) return prev;
      // Insert midpoint between penultimate and last point
      const p1 = prev[prev.length - 2]!;
      const p2 = prev[prev.length - 1]!;
      const mid: [number, number] = [
        parseFloat(((p1[0] + p2[0]) / 2).toFixed(6)),
        parseFloat(((p1[1] + p2[1]) / 2).toFixed(6)),
      ];
      const next = [...prev];
      next.splice(next.length - 1, 0, mid);
      return next;
    });
  }

  function removeCoord(index: number) {
    if (coords.length <= 4) {
      alert("A polygon requires at least 3 distinct vertices (4 points including closure).");
      return;
    }
    setCoords((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Ensure closed
      if (index === 0 && next.length > 0) {
        next[next.length - 1] = [...next[0]!];
      }
      return next;
    });
  }

  async function saveZone(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setOverlapDetails(null);

    try {
      const isNew = editing === "new";
      const path = isNew ? "/api/v1/admin/zones" : `/api/v1/admin/zones/${(editing as Zone).id}`;
      const method = isNew ? "POST" : "PUT";

      // Ensure ring closure
      const closedCoords = [...coords];
      if (
        closedCoords.length > 0 &&
        (closedCoords[0]![0] !== closedCoords[closedCoords.length - 1]![0] ||
          closedCoords[0]![1] !== closedCoords[closedCoords.length - 1]![1])
      ) {
        closedCoords[closedCoords.length - 1] = [...closedCoords[0]!];
      }

      const polygon = {
        type: "Polygon" as const,
        coordinates: [closedCoords],
      };

      let pausePayload: ZonePause | null | undefined = undefined;
      if (canManageOps) {
        if (!pauseActive) {
          pausePayload = editing === "new" ? undefined : null;
        } else {
          pausePayload = {
            active: true,
            message: pauseMessage || "Zone paused",
            until: fromLocalInputDate(pauseUntil),
          };
        }
      }

      const body = isNew
        ? {
            cityId,
            name,
            polygon,
            isEnabled,
          }
        : {
            name,
            polygon,
            isEnabled,
            ...(pausePayload !== undefined && { pause: pausePayload }),
          };

      const res = await adminFetch(path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error?.code === "ZONE_OVERLAP") {
          setOverlapDetails(data.error.details ?? {});
          throw new Error(
            `Zone overlap rejected: overlaps with zone "${data.error.details?.name ?? "Existing Zone"}" (${data.error.details?.zoneId ?? ""}). Edit the boundary vertices to remove positive-area overlap.`
          );
        }
        throw new Error(data.error?.message ?? "Zone could not be saved.");
      }

      setEditing(null);
      setAttempt((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Zone could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-heading">
        <div>
          <h1>Zones &amp; Map Editor</h1>
          <p>Define delivery polygons, manage operations status, and inspect boundaries.</p>
        </div>
        <div className="admin-role-actions">
          <button className="admin-role-button" disabled={busy} onClick={() => startEdit("new")}>
            Draw new zone
          </button>
        </div>
      </div>

      {formError && (
        <div className="admin-role-error" role="alert" style={{ marginBottom: 20 }}>
          <p style={{ margin: 0 }}>{formError}</p>
          {overlapDetails && (
            <small style={{ display: "block", marginTop: 4 }}>
              Conflicting Zone ID: {overlapDetails.zoneId}
            </small>
          )}
        </div>
      )}

      {editing && (
        <form
          className="admin-panel admin-role-form"
          onSubmit={saveZone}
          aria-label={editing === "new" ? "Create zone" : "Edit zone"}
        >
          <h2>{editing === "new" ? "Create delivery zone" : `Edit ${editing.name}`}</h2>

          {editing === "new" ? (
            <>
              <label htmlFor="zone-city">City</label>
              <select
                id="zone-city"
                value={cityId}
                onChange={(e) => setCityId(e.target.value)}
                required
                disabled={busy}
                style={{
                  width: "100%",
                  maxWidth: 360,
                  padding: 10,
                  border: "1px solid #bacbbd",
                  borderRadius: 6,
                  marginTop: 7,
                }}
              >
                <option value="">Select city</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.state})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p style={{ fontSize: 12, color: "var(--admin-muted)", margin: "0 0 10px" }}>
              City: {cities.find((c) => c.id === editing.cityId)?.name ?? editing.cityId} (immutable)
            </p>
          )}

          <label htmlFor="zone-name" style={{ marginTop: 12 }}>
            Zone name
          </label>
          <input
            id="zone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            disabled={busy}
            placeholder="e.g. Mall Road & Chowrasta"
          />

          <div style={{ marginTop: 20 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>
              Interactive Boundary Map (GeoJSON Polygon)
            </h3>
            <div className="admin-map-container">
              <svg
                ref={svgRef}
                className="admin-map-svg"
                viewBox="0 0 400 300"
                onPointerMove={handleSvgPointerMove}
                onPointerUp={handleSvgPointerUp}
                onPointerCancel={handleSvgPointerUp}
                style={{ touchAction: "none", cursor: draggedIndex !== null ? "grabbing" : "crosshair" }}
              >
                {/* Background grid lines */}
                <line x1="0" y1="100" x2="400" y2="100" stroke="#e0e6e0" strokeWidth="0.5" />
                <line x1="0" y1="200" x2="400" y2="200" stroke="#e0e6e0" strokeWidth="0.5" />
                <line x1="133" y1="0" x2="133" y2="300" stroke="#e0e6e0" strokeWidth="0.5" />
                <line x1="266" y1="0" x2="266" y2="300" stroke="#e0e6e0" strokeWidth="0.5" />

                {/* Drawn polygon */}
                {coords.length >= 3 && (
                  <polygon
                    points={svgPoints}
                    fill={isEnabled ? "rgba(40, 92, 70, 0.25)" : "rgba(100, 100, 100, 0.2)"}
                    stroke={isEnabled ? "#285c46" : "#68716d"}
                    strokeWidth="2"
                  />
                )}

                {/* Vertices */}
                {coords.map(([lng, lat], i) => {
                  const isDragged = draggedIndex === i;
                  const isEndpoint = i === 0 || i === coords.length - 1;
                  return (
                    <g key={i}>
                      <circle
                        cx={toSvgX(lng)}
                        cy={toSvgY(lat)}
                        r={isDragged ? 8 : isEndpoint ? 6 : 5}
                        fill={isDragged ? "#0b57d0" : i === 0 ? "#137333" : "#285c46"}
                        stroke="#fff"
                        strokeWidth={isDragged ? 2.5 : 1.5}
                        style={{ cursor: isDragged ? "grabbing" : "grab" }}
                        onPointerDown={(e) => handleVertexPointerDown(e, i)}
                      />
                      <text
                        x={toSvgX(lng) + 8}
                        y={toSvgY(lat) + 3}
                        fontSize="9"
                        fill="#252b29"
                        fontFamily="monospace"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        P{i + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="admin-map-overlay">
                Lng: [{mapBounds.minX.toFixed(3)}, {mapBounds.maxX.toFixed(3)}] · Lat: [
                {mapBounds.minY.toFixed(3)}, {mapBounds.maxY.toFixed(3)}] · Drag any point to reposition
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0" }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>
                Vertices: {coords.length} coordinates (outer ring closed)
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={addCoord}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #bacbbd",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                + Add vertex point
              </button>
            </div>

            <div className="admin-coord-list">
              {coords.map(([lng, lat], i) => (
                <div key={i} className="admin-coord-row">
                  <span style={{ width: 28, color: "var(--admin-muted)" }}>#{i + 1}</span>
                  <label>
                    Lng:
                    <input
                      type="number"
                      step="any"
                      value={lng}
                      onChange={(e) => updateCoord(i, e.target.value, String(lat))}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Lat:
                    <input
                      type="number"
                      step="any"
                      value={lat}
                      onChange={(e) => updateCoord(i, String(lng), e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  {i < coords.length - 1 && coords.length > 4 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeCoord(i)}
                      style={{
                        border: 0,
                        background: "transparent",
                        color: "#a73535",
                        cursor: "pointer",
                        padding: "2px 6px",
                      }}
                      title="Remove vertex"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              disabled={busy}
            />
            <span>Enabled for service (uncheck for draft mode allowing overlaps)</span>
          </label>

          {canManageOps && editing !== "new" && (
            <fieldset style={{ marginTop: 20, border: "1px solid var(--admin-border)", borderRadius: 6, padding: 14 }}>
              <legend style={{ fontSize: 12, fontWeight: 600 }}>Emergency Operations Pause (F17)</legend>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={pauseActive}
                  onChange={(e) => setPauseActive(e.target.checked)}
                  disabled={busy}
                />
                <span>Pause zone delivery immediately</span>
              </label>

              {pauseActive && (
                <div style={{ display: "grid", gap: 10 }}>
                  <label>
                    Reason / Banner message:
                    <input
                      value={pauseMessage}
                      onChange={(e) => setPauseMessage(e.target.value)}
                      placeholder="e.g. Landslide on Hill Cart Road"
                      disabled={busy}
                      style={{ marginTop: 4 }}
                    />
                  </label>
                  <label>
                    Auto-resume until date/time (optional):
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
              {busy ? "Saving…" : "Save zone"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="zones-title">
        <div className="admin-staff-filters">
          <label>
            Filter by City:
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
              <option value="">All Cities</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-panel-toolbar">
          <h2 id="zones-title">Delivery Zones</h2>
          <span>{zones?.length ?? 0} zones</span>
        </div>

        {error ? (
          <div className="admin-panel admin-roles-message" role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((v) => v + 1)}>Try again</button>
          </div>
        ) : !zones ? (
          <p role="status">Loading zones…</p>
        ) : zones.length === 0 ? (
          <p className="admin-roles-message">No zones configured yet.</p>
        ) : (
          <div className="admin-geo-grid">
            {zones.map((zone) => {
              const cityName = cities.find((c) => c.id === zone.cityId)?.name ?? "City";
              const isPaused = zone.pause?.active;

              return (
                <article key={zone.id} className="admin-geo-card">
                  <h3>
                    <span>{zone.name}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {isPaused && <span className="admin-badge admin-badge-paused">Paused</span>}
                      <span
                        className={`admin-badge ${
                          zone.isEnabled ? "admin-badge-enabled" : "admin-badge-disabled"
                        }`}
                      >
                        {zone.isEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </h3>
                  <p>{cityName}</p>
                  <div className="admin-geo-meta">
                    <span>Vertices: {zone.polygon.coordinates[0]?.length ?? 0} points</span>
                    {zone.pause?.active && (
                      <span style={{ color: "#b06000" }}>
                        Pause notice: {zone.pause.message}
                      </span>
                    )}
                  </div>
                  <div className="admin-role-actions" style={{ padding: "8px 0 0" }}>
                    <button disabled={busy} onClick={() => startEdit(zone)}>
                      Edit zone &amp; polygon
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
