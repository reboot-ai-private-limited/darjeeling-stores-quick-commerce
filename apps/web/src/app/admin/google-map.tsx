"use client";

import { useEffect, useRef, useState } from "react";

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

/* Minimal typings: we load the Maps JavaScript API from the script tag, so there is no npm dependency. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { google?: any; __gmapsLoading?: Promise<void> | undefined; __gmapsReady?: () => void; gm_authFailure?: () => void } }

/** Why the map failed, in words the person can act on. */
const KEY_REJECTED = "Google rejected the Maps key. In Google Cloud check that the Maps JavaScript API is enabled, billing is on, and this site (for example http://localhost:3000/*) is allowed in the key's website restrictions.";

/**
 * Loads the Maps script once and resolves only when Google's map code is ready to use. Rejects with the real reason: no key, the script
 * could not be downloaded, or Google refused the key.
 */
export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("The map can only load in the browser."));
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error("No Google Maps key is set. Add NEXT_PUBLIC_GOOGLE_MAPS_KEY to apps/web/.env.local and restart the web app."));
  if (window.google?.maps?.Map) return Promise.resolve();
  if (window.__gmapsLoading) return window.__gmapsLoading;
  window.__gmapsLoading = new Promise<void>((resolve, reject) => {
    const fail = (message: string) => { window.__gmapsLoading = undefined; reject(new Error(message)); };
    // Google calls this when it refuses the key (API not enabled, billing off, site not allowed). The map shows its own "Oops" overlay too.
    window.gm_authFailure = () => fail(KEY_REJECTED);
    window.__gmapsReady = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&callback=__gmapsReady`;
    script.async = true;
    script.onerror = () => fail("The Google Maps script could not be downloaded. Check your internet connection and any ad blocker or privacy extension.");
    window.setTimeout(() => { if (!window.google?.maps?.Map) fail("Google Maps took too long to load. Check your internet connection."); }, 20000);
    document.head.appendChild(script);
  });
  return window.__gmapsLoading;
}

/** The text to show for a failed load or a failure while drawing the map. */
export const mapProblem = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Google Maps could not load.");

type Ring = [number, number][]; // [lng, lat], closed (last === first)

interface Props {
  /** The closed outer ring as [lng, lat] points, or an empty list while nothing is drawn yet. */
  coords: Ring;
  onChange: (next: Ring) => void;
  enabled: boolean;
  disabled?: boolean;
  height?: number;
}

/** Where the map opens when nothing is drawn or picked yet: Darjeeling. */
const NEUTRAL_CENTER = { lat: 27.04, lng: 88.265 };
const NEUTRAL_ZOOM = 13;

/**
 * A delivery-zone boundary on a Google map. Click the map to add boundary points: the shape closes and fills
 * by itself from the third point on. Finish drawing to stop adding points, then drag a point to move it, drag a midpoint to add one,
 * or right-click a point to delete it.
 */
export function GoogleZoneMap({ coords, onChange, enabled, disabled, height = 460 }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const poly = useRef<any>(null);
  const internal = useRef(false);
  const syncing = useRef(false);
  const drawingRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState(Math.max(0, coords.length - 1));

  function startDrawing(on: boolean) { drawingRef.current = on; setDrawing(on); }

  /** Sends the shape to the form: a closed ring from three points up, an empty list before that. */
  function emit() {
    const path = poly.current?.getPath();
    if (!path) return;
    const pts: Ring = path.getArray().map((p: any) => [Number(p.lng().toFixed(6)), Number(p.lat().toFixed(6))] as [number, number]);
    setPoints(pts.length);
    if (syncing.current) return;
    internal.current = true;
    onChangeRef.current(pts.length >= 3 ? [...pts, pts[0]!] : []);
  }
  function listen() {
    const g = window.google.maps;
    const path = poly.current?.getPath();
    if (!path) return;
    g.event.clearListeners(path, "set_at"); g.event.clearListeners(path, "insert_at"); g.event.clearListeners(path, "remove_at");
    g.event.addListener(path, "set_at", emit); g.event.addListener(path, "insert_at", emit); g.event.addListener(path, "remove_at", emit);
  }

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !host.current) return;
      const g = window.google.maps;
      const ring = coords.slice(0, -1);
      map.current = new g.Map(host.current, {
        center: ring[0] ? { lng: ring[0][0], lat: ring[0][1] } : NEUTRAL_CENTER,
        zoom: ring[0] ? 15 : NEUTRAL_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        draggableCursor: ring.length >= 3 ? undefined : "crosshair",
      });
      poly.current = new g.Polygon({
        map: map.current,
        path: ring.map(([lng, lat]) => ({ lng, lat })), // "path", not "paths": an empty "paths" list leaves the polygon with no path object at all
        editable: !disabled,
        draggable: false,
        strokeColor: "#c62828",
        strokeWeight: 3,
        fillColor: "#f5a800",
        fillOpacity: 0.3,
      });
      if (ring.length) {
        const bounds = new g.LatLngBounds();
        ring.forEach(([lng, lat]) => bounds.extend({ lng, lat }));
        map.current.fitBounds(bounds, 40);
      }
      listen();
      // Nothing drawn yet: start in drawing mode so the first click already adds a point.
      if (ring.length < 3) { drawingRef.current = true; setDrawing(true); }
      // Clicking the map adds a boundary point while drawing.
      map.current.addListener("click", (e: any) => {
        if (!drawingRef.current || disabledRef.current) return;
        poly.current.getPath().push(e.latLng);
      });
      // right-click a point to delete it
      g.event.addListener(poly.current, "contextmenu", (e: any) => {
        if (disabledRef.current) return;
        if (e.vertex !== undefined) poly.current.getPath().removeAt(e.vertex);
      });
      setReady(true);
    }).catch((e) => setError(mapProblem(e)));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external changes (typing coordinates, switching zone) into the polygon.
  useEffect(() => {
    if (internal.current) { internal.current = false; return; }
    if (!poly.current) return;
    const ring = coords.slice(0, -1).map(([lng, lat]) => ({ lng, lat }));
    syncing.current = true;
    poly.current.setPath(ring);
    syncing.current = false;
    setPoints(ring.length);
    listen();
    if (ring.length >= 3) {
      startDrawing(false);
      if (map.current) {
        const g = window.google.maps;
        const bounds = new g.LatLngBounds();
        ring.forEach((p) => bounds.extend(p));
        map.current.fitBounds(bounds, 40);
      }
    } else startDrawing(true);
  }, [coords]);

  useEffect(() => {
    poly.current?.setOptions({ fillColor: enabled ? "#f5a800" : "#716e68", strokeColor: enabled ? "#c62828" : "#716e68", editable: !disabled });
  }, [enabled, disabled]);

  useEffect(() => { map.current?.setOptions({ draggableCursor: drawing && !disabled ? "crosshair" : undefined }); }, [drawing, disabled, ready]);

  function undoLast() {
    const path = poly.current?.getPath();
    if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
  }
  function clearAll() {
    syncing.current = true;
    poly.current.setPath([]);
    syncing.current = false;
    listen();
    emit();
    startDrawing(true);
  }
  function finish() {
    if (points < 3) return;
    startDrawing(false);
  }

  if (error) return <p role="alert" style={{ padding: 16, color: "#b3261e", fontSize: 14 }}>{error}</p>;
  const btn: React.CSSProperties = { minHeight: 38, padding: "6px 14px", border: "1px solid #cbc5ba", borderRadius: 8, background: "#fff", cursor: "pointer", fontWeight: 600 };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {!disabled && (
          <>
            {drawing
              ? <button type="button" style={{ ...btn, background: "#c62828", color: "#fff", borderColor: "#c62828" }} onClick={finish} disabled={points < 3}>Finish drawing</button>
              : <button type="button" style={btn} onClick={() => startDrawing(true)}>Add more points</button>}
            <button type="button" style={btn} onClick={undoLast} disabled={points === 0}>Undo last point</button>
            <button type="button" style={btn} onClick={clearAll} disabled={points === 0}>Clear and redraw</button>
          </>
        )}
        <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>
          {points === 0 ? "Click the map to place the first boundary point."
            : points < 3 ? `${points} point${points === 1 ? "" : "s"} placed. Add at least ${3 - points} more.`
              : drawing ? `${points} points. The zone closes automatically; keep clicking to add more, then press Finish drawing.`
                : `${points} points. Drag a point to move it, drag a midpoint to add one, right-click a point to delete it.`}
        </span>
      </div>

      <div ref={host} style={{ width: "100%", height, borderRadius: 8, border: "1px solid var(--admin-border)" }} aria-label="Delivery zone map" />
    </div>
  );
}

export type LngLat = [number, number];

export function pointInRing(lng: number, lat: number, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringCentroid(ring: LngLat[]): { lat: number; lng: number } {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  return { lng: pts.reduce((s, p) => s + p[0], 0) / pts.length, lat: pts.reduce((s, p) => s + p[1], 0) / pts.length };
}

interface PickerProps {
  lat: number | null;
  lng: number | null;
  zones: { id: string; name: string; ring: LngLat[] }[];
  selectedZoneId: string;
  onPick: (lat: number, lng: number) => void;
  disabled?: boolean;
}

/** Click the map or drag the pin to choose a location; zone outlines are shown, the selected zone highlighted. */
export function GoogleLocationPicker({ lat, lng, zones, selectedZoneId, onPick, disabled }: PickerProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const polys = useRef<Map<string, any>>(new Map());
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !host.current) return;
      const g = window.google.maps;
      const placed = lat != null && lng != null;
      map.current = new g.Map(host.current, { center: placed ? { lat: lat!, lng: lng! } : NEUTRAL_CENTER, zoom: placed ? 15 : NEUTRAL_ZOOM, mapTypeControl: false, streetViewControl: false, clickableIcons: false });
      marker.current = new g.Marker({ map: map.current, draggable: true, position: lat != null && lng != null ? { lat, lng } : null });
      map.current.addListener("click", (e: any) => { if (!disabledRef.current) pickRef.current(e.latLng.lat(), e.latLng.lng()); });
      marker.current.addListener("dragend", (e: any) => { if (!disabledRef.current) pickRef.current(e.latLng.lat(), e.latLng.lng()); });
      setReady(true);
    }).catch((e) => setError(mapProblem(e)));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zone outlines
  useEffect(() => {
    if (!ready) return;
    const g = window.google.maps;
    polys.current.forEach((p) => p.setMap(null));
    polys.current.clear();
    for (const z of zones) {
      const poly = new g.Polygon({ map: map.current, paths: z.ring.slice(0, -1).map(([x, y]) => ({ lng: x, lat: y })), clickable: false, strokeWeight: 2, strokeColor: "#c62828", fillColor: "#f5a800", fillOpacity: 0.12 });
      polys.current.set(z.id, poly);
    }
  }, [ready, zones]);
  useEffect(() => {
    polys.current.forEach((p, id) => p.setOptions({ fillOpacity: id === selectedZoneId ? 0.3 : 0.08, strokeOpacity: id === selectedZoneId ? 1 : 0.4, strokeWeight: id === selectedZoneId ? 3 : 1 }));
  }, [ready, zones, selectedZoneId]);

  // Marker follows lat/lng fields
  useEffect(() => {
    if (!ready) return;
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) { marker.current.setPosition(null); return; }
    const pos = { lat, lng };
    marker.current.setPosition(pos);
    if (!map.current.getBounds()?.contains(pos)) map.current.panTo(pos);
  }, [ready, lat, lng]);

  // Zoom to the chosen zone
  useEffect(() => {
    if (!ready) return;
    const z = zones.find((x) => x.id === selectedZoneId);
    if (!z) return;
    const g = window.google.maps;
    const b = new g.LatLngBounds();
    z.ring.forEach(([x, y]) => b.extend({ lng: x, lat: y }));
    map.current.fitBounds(b, 40);
  }, [ready, selectedZoneId, zones]);

  if (error) return <p role="alert" style={{ padding: 12, color: "#b3261e", fontSize: 12 }}>{error}</p>;
  return <div ref={host} style={{ width: "100%", height: 340, borderRadius: 8, border: "1px solid #cbc5ba" }} aria-label="Pick warehouse location on map" />;
}
