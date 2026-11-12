import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { getRoute, type LatLng, type RoutePath } from "../api/rider";

/** Straight-line distance in metres between two points. */
function metres(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A new road is asked for after the rider has moved this far from where the last one started, or after this long (and a small move). */
const REROUTE_METRES = 120;
const REFRESH_MS = 30_000;
const SMALL_MOVE_METRES = 30;

/**
 * The rider's live position and the road from there to the customer's door, for the in-app map.
 * Follows the phone's position while the screen is open (nothing runs in the background) and asks the server for a fresh road
 * only when the rider has moved or the last one is old, so it does not hammer the server. Without location permission the road
 * starts from `fallbackFrom` (the store), so the map still shows where to go.
 */
export function useRoute(orderId: string | undefined, fallbackFrom: LatLng | null) {
  const [position, setPosition] = useState<(LatLng & { heading: number | null }) | null>(null);
  const [route, setRoute] = useState<RoutePath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ from: LatLng; at: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    let sub: Location.LocationSubscription | null = null;

    const ask = async (from: LatLng) => {
      if (!orderId || busy.current) return;
      const prev = last.current;
      const now = Date.now();
      if (prev) {
        const moved = metres(prev.from, from);
        if (moved < REROUTE_METRES && !(now - prev.at > REFRESH_MS && moved > SMALL_MOVE_METRES)) return;
      }
      busy.current = true;
      try {
        const r = await getRoute(orderId, from);
        if (!live) return;
        last.current = { from, at: now };
        setRoute(r); setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load the route.");
      } finally { busy.current = false; }
    };

    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") { if (fallbackFrom) void ask(fallbackFrom); return; }
        const first = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (live) {
          const p = { lat: first.coords.latitude, lng: first.coords.longitude, heading: first.coords.heading ?? null };
          setPosition(p); void ask(p);
        }
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 }, loc => {
          const p = { lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null };
          if (!live) return;
          setPosition(p); void ask(p);
        });
      } catch {
        if (fallbackFrom) void ask(fallbackFrom);
      }
    })();

    return () => { live = false; sub?.remove(); };
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { position, route, error };
}
