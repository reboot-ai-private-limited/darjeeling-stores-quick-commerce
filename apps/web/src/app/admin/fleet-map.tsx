"use client";

import { useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_KEY, loadGoogleMaps, mapProblem } from "./google-map";

/* The Maps script is loaded by google-map.tsx; the typings here are minimal on purpose. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FleetPin {
  id: string; name: string; status: string; location: { lat: number; lng: number };
  lastLocationAt: string | null; orders: string[];
}

/** A rider whose last position is older than this is shown grey: the app may be closed or out of signal. */
const STALE_MS = 3 * 60_000;
const COLOR = { idle: "#1f9d62", busy: "#c62828", stale: "#8a8a8a" } as const;

function pinState(p: FleetPin, now: number): keyof typeof COLOR {
  const age = p.lastLocationAt ? now - new Date(p.lastLocationAt).getTime() : Infinity;
  if (age > STALE_MS) return "stale";
  return p.orders.length > 0 ? "busy" : "idle";
}

/** Live riders on a Google map: green when free, red when carrying orders, grey when the position is old. Click a pin for details. */
export function FleetMap({ riders, height = 420, focusId, onSelect }: { riders: FleetPin[]; height?: number; focusId?: string | null; onSelect?: (id: string) => void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const info = useRef<any>(null);
  const pins = useRef<Map<string, any>>(new Map());
  const fitted = useRef(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const ridersRef = useRef(riders);
  ridersRef.current = riders;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !host.current) return;
      const g = (window as any).google.maps;
      map.current = new g.Map(host.current, { center: { lat: 27.04, lng: 88.265 }, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      info.current = new g.InfoWindow();
      setReady(true);
    }).catch((e) => setError(mapProblem(e)));
    return () => { cancelled = true; };
  }, []);

  /** The pin's pop-up, built from plain elements so a rider's name can never inject markup. */
  function describe(p: FleetPin): HTMLElement {
    const box = document.createElement("div");
    box.style.cssText = "font:14px/1.45 system-ui,sans-serif;min-width:180px";
    const add = (text: string, css = "") => { const d = document.createElement("div"); d.textContent = text; if (css) d.style.cssText = css; box.appendChild(d); };
    add(p.name, "font-weight:700;font-size:15px");
    const state = pinState(p, Date.now());
    add(state === "stale" ? "Position is old (app may be closed)" : p.orders.length > 0 ? `Delivering ${p.orders.length} order${p.orders.length === 1 ? "" : "s"}` : "Free", `color:${COLOR[state]};font-weight:600`);
    if (p.orders.length > 0) add(p.orders.join(", "), "color:#555");
    if (p.lastLocationAt) add(`Last ping ${new Date(p.lastLocationAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`, "color:#777;font-size:12px");
    return box;
  }

  function fit() {
    if (!map.current || ridersRef.current.length === 0) return;
    const g = (window as any).google.maps;
    const bounds = new g.LatLngBounds();
    ridersRef.current.forEach((p) => bounds.extend(p.location));
    map.current.fitBounds(bounds, 60);
    if (ridersRef.current.length === 1) map.current.setZoom(16);
  }

  // One pin per rider: created, moved, recoloured and removed as the fleet changes. The camera is not moved on each refresh.
  useEffect(() => {
    if (!ready) return;
    const g = (window as any).google.maps;
    const now = Date.now();
    const seen = new Set<string>();
    for (const p of riders) {
      seen.add(p.id);
      const icon = { path: g.SymbolPath.CIRCLE, scale: 17, fillColor: COLOR[pinState(p, now)], fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 };
      const label = { text: (p.name.trim()[0] ?? "?").toUpperCase(), color: "#ffffff", fontWeight: "700", fontSize: "14px" };
      let m = pins.current.get(p.id);
      if (!m) {
        m = new g.Marker({ map: map.current, position: p.location, icon, label, title: p.name });
        m.addListener("click", () => {
          const current = ridersRef.current.find((r) => r.id === p.id);
          if (!current) return;
          info.current.setContent(describe(current));
          info.current.open({ map: map.current, anchor: m });
          selectRef.current?.(p.id);
        });
        pins.current.set(p.id, m);
      } else { m.setPosition(p.location); m.setIcon(icon); m.setLabel(label); m.setTitle(p.name); }
    }
    pins.current.forEach((m, id) => { if (!seen.has(id)) { m.setMap(null); pins.current.delete(id); } });
    if (!fitted.current && riders.length > 0) { fit(); fitted.current = true; }
  }, [ready, riders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom to a rider picked in the table
  useEffect(() => {
    if (!ready || !focusId) return;
    const p = ridersRef.current.find((r) => r.id === focusId);
    const m = pins.current.get(focusId);
    if (!p || !m) return;
    map.current.panTo(p.location);
    map.current.setZoom(16);
    info.current.setContent(describe(p));
    info.current.open({ map: map.current, anchor: m });
  }, [ready, focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!GOOGLE_MAPS_KEY) return <p className="admin-role-error" style={{ margin: 16 }}>The map needs a Google Maps key. Set NEXT_PUBLIC_GOOGLE_MAPS_KEY and restart the web app.</p>;
  if (error) return <p role="alert" className="admin-role-error" style={{ margin: 16 }}>{error}</p>;
  return (
    <div style={{ position: "relative" }}>
      <div ref={host} style={{ width: "100%", height, borderRadius: 10, background: "#efe9da" }} aria-label="Live map of riders" />
      <div style={{ position: "absolute", left: 12, bottom: 12, background: "rgba(255,255,255,.95)", borderRadius: 8, padding: "8px 12px", fontSize: 13, display: "flex", gap: 14, boxShadow: "0 1px 4px rgba(0,0,0,.25)" }}>
        {([["idle", "Free"], ["busy", "Delivering"], ["stale", "Old position"]] as const).map(([k, label]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 6, background: COLOR[k], display: "inline-block" }} />{label}</span>
        ))}
      </div>
      <button type="button" className="admin-role-button" onClick={fit} style={{ position: "absolute", right: 56, top: 10, minHeight: 36 }}>Show all riders</button>
    </div>
  );
}
