"use client";

import { useEffect, useRef, useState } from "react";

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

/* Minimal typings: we load the Maps JavaScript API from the script tag, so there is no npm dependency. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { google?: any; __gmapsLoading?: Promise<void> | undefined } }

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoading) return window.__gmapsLoading;
  window.__gmapsLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { window.__gmapsLoading = undefined; reject(new Error("Google Maps failed to load")); };
    document.head.appendChild(script);
  });
  return window.__gmapsLoading;
}

type Ring = [number, number][]; // [lng, lat], closed (last === first)

interface Props {
  coords: Ring;
  onChange: (next: Ring) => void;
  enabled: boolean;
  disabled?: boolean;
}

/** Editable delivery-zone polygon on a Google map. Drag points, drag edge midpoints to add, click a point's menu-less delete via right-click. */
export function GoogleZoneMap({ coords, onChange, enabled, disabled }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const poly = useRef<any>(null);
  const internal = useRef(false);
  const syncing = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !host.current) return;
      const g = window.google.maps;
      const ring = coords.slice(0, -1);
      map.current = new g.Map(host.current, {
        center: ring[0] ? { lng: ring[0][0], lat: ring[0][1] } : { lat: 27.04, lng: 88.265 },
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });
      poly.current = new g.Polygon({
        map: map.current,
        paths: ring.map(([lng, lat]) => ({ lng, lat })),
        editable: !disabled,
        draggable: false,
        strokeColor: "#c62828",
        strokeWeight: 2,
        fillColor: "#f5a800",
        fillOpacity: 0.3,
      });
      const bounds = new g.LatLngBounds();
      ring.forEach(([lng, lat]) => bounds.extend({ lng, lat }));
      if (ring.length) map.current.fitBounds(bounds, 40);
      const path = poly.current.getPath();
      const push = () => {
        const pts: Ring = path.getArray().map((p: any) => [Number(p.lng().toFixed(6)), Number(p.lat().toFixed(6))] as [number, number]);
        if (syncing.current || pts.length < 3) return;
        internal.current = true;
        onChangeRef.current([...pts, pts[0]!]);
      };
      g.event.addListener(path, "set_at", push);
      g.event.addListener(path, "insert_at", push);
      g.event.addListener(path, "remove_at", push);
      // right-click a vertex to delete it (keep at least 3)
      g.event.addListener(poly.current, "contextmenu", (e: any) => {
        if (e.vertex !== undefined && path.getLength() > 3) path.removeAt(e.vertex);
      });
    }).catch(() => setError("Google Maps could not load. Check the API key, that the Maps JavaScript API is enabled, and the referrer restrictions."));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external changes (typing coordinates, switching zone) into the polygon.
  useEffect(() => {
    if (internal.current) { internal.current = false; return; }
    if (!poly.current) return;
    const g = window.google.maps;
    const ring = coords.slice(0, -1).map(([lng, lat]) => ({ lng, lat }));
    syncing.current = true;
    poly.current.setPath(ring);
    syncing.current = false;
    const path = poly.current.getPath();
    const push = () => {
      const pts: Ring = path.getArray().map((p: any) => [Number(p.lng().toFixed(6)), Number(p.lat().toFixed(6))] as [number, number]);
      if (syncing.current || pts.length < 3) return;
      internal.current = true;
      onChangeRef.current([...pts, pts[0]!]);
    };
    g.event.clearListeners(path, "set_at"); g.event.clearListeners(path, "insert_at"); g.event.clearListeners(path, "remove_at");
    g.event.addListener(path, "set_at", push); g.event.addListener(path, "insert_at", push); g.event.addListener(path, "remove_at", push);
  }, [coords]);

  useEffect(() => {
    poly.current?.setOptions({ fillColor: enabled ? "#f5a800" : "#716e68", strokeColor: enabled ? "#c62828" : "#716e68", editable: !disabled });
  }, [enabled, disabled]);

  if (error) return <p role="alert" style={{ padding: 16, color: "#b3261e", fontSize: 12 }}>{error}</p>;
  return <div ref={host} style={{ width: "100%", height: 380, borderRadius: 8 }} aria-label="Delivery zone map" />;
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
      map.current = new g.Map(host.current, { center: { lat: lat ?? 27.04, lng: lng ?? 88.265 }, zoom: 15, mapTypeControl: false, streetViewControl: false });
      marker.current = new g.Marker({ map: map.current, draggable: true, position: lat != null && lng != null ? { lat, lng } : null });
      map.current.addListener("click", (e: any) => { if (!disabledRef.current) pickRef.current(e.latLng.lat(), e.latLng.lng()); });
      marker.current.addListener("dragend", (e: any) => { if (!disabledRef.current) pickRef.current(e.latLng.lat(), e.latLng.lng()); });
      setReady(true);
    }).catch(() => setError("Google Maps could not load. Check the API key and that the Maps JavaScript API is enabled."));
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
  return <div ref={host} style={{ width: "100%", height: 300, borderRadius: 8, border: "1px solid #cbc5ba" }} aria-label="Pick warehouse location on map" />;
}
