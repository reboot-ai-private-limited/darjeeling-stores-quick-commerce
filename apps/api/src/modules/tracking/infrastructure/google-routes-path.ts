import type { RoutePath, RoutePathProvider } from "../domain/tracking.js";

export interface GoogleRoutePathOptions {
  apiKey: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  now?: () => number;
  /** A road path is reused for this long for the same start and end (riders ask again every few seconds while riding). */
  cacheMs?: number;
  cacheSize?: number;
  timeoutMs?: number;
  endpoint?: string;
}

type Point = { lat: number; lng: number };
/** About 11 metres, so a rider standing still keeps hitting the same answer. */
const key = (p: Point) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/** Decodes Google's encoded polyline (precision 5) into points. */
export function decodePolyline(encoded: string): Point[] {
  const out: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/**
 * The road a rider should take, from Google Routes, for a two-wheeler. Answers are cached briefly per pair of places to keep the
 * cost down, and any failure (no key, timeout, an error, no route) answers `null` so the caller can fall back to a straight line.
 */
export function createGoogleRoutePath(options: GoogleRoutePathOptions): RoutePathProvider {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.cacheMs ?? 30_000;
  const capacity = options.cacheSize ?? 500;
  const endpoint = options.endpoint ?? "https://routes.googleapis.com/directions/v2:computeRoutes";
  const cache = new Map<string, { path: RoutePath; at: number }>();

  async function ask(from: Point, to: Point): Promise<RoutePath | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
    try {
      const res = await http(endpoint, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": options.apiKey, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline" },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: "TWO_WHEELER", routingPreference: "TRAFFIC_UNAWARE",
        }),
      });
      if (!res.ok) return null;
      const body = await res.json() as { routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[] };
      const route = body.routes?.[0];
      const seconds = /^(\d+)(?:\.\d+)?s$/.exec(route?.duration ?? "");
      const encoded = route?.polyline?.encodedPolyline;
      if (!route || !seconds || !encoded) return null;
      const points = decodePolyline(encoded);
      if (points.length < 2) return null;
      return { distanceM: Math.round(route.distanceMeters ?? 0), durationS: Number(seconds[1]), points, approximate: false };
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  return {
    async path(from, to) {
      if (!options.apiKey) return null;
      const id = `${key(from)}>${key(to)}`;
      const hit = cache.get(id);
      if (hit && now() - hit.at < ttl) return hit.path;
      const path = await ask(from, to);
      if (path) {
        if (cache.size >= capacity) cache.delete(cache.keys().next().value as string);
        cache.set(id, { path, at: now() });
      }
      return path;
    },
  };
}
