import type { EtaProvider } from "../domain/tracking.js";

export interface GoogleRoutesOptions {
  apiKey: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  now?: () => number;
  /** A route's travel time is reused for this long (hill roads change slowly, and each call costs money). */
  cacheMs?: number;
  /** The most places remembered at once. */
  cacheSize?: number;
  timeoutMs?: number;
  endpoint?: string;
}

type Point = { lat: number; lng: number };
/** About 11 metres: two phones on the same doorstep share one answer. */
const key = (p: Point) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/**
 * Travel time by road from Google Routes (F20), for a two-wheeler. Answers are cached per pair of places so one address and
 * warehouse cost a single call, and any failure (no key, timeout, an error, no route) answers `null`, which makes the callers fall
 * back to the straight-line estimate instead of failing an order.
 */
export function createGoogleRoutesEta(options: GoogleRoutesOptions): EtaProvider {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.cacheMs ?? 6 * 3_600_000;
  const capacity = options.cacheSize ?? 5000;
  const endpoint = options.endpoint ?? "https://routes.googleapis.com/directions/v2:computeRoutes";
  const cache = new Map<string, { minutes: number; at: number }>();
  const inflight = new Map<string, Promise<number | null>>();

  async function ask(from: Point, to: Point): Promise<number | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);
    try {
      const res = await http(endpoint, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": options.apiKey, "X-Goog-FieldMask": "routes.duration" },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: "TWO_WHEELER", routingPreference: "TRAFFIC_UNAWARE",
        }),
      });
      if (!res.ok) return null;
      const body = await res.json() as { routes?: { duration?: string }[] };
      const seconds = /^(\d+)(?:\.\d+)?s$/.exec(body.routes?.[0]?.duration ?? "");
      return seconds ? Math.max(1, Math.ceil(Number(seconds[1]) / 60)) : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  return {
    async minutes(from, to) {
      if (!options.apiKey) return null;
      const id = `${key(from)}>${key(to)}`;
      const hit = cache.get(id);
      if (hit && now() - hit.at < ttl) return hit.minutes;
      // Two requests for the same pair at once share one call.
      let pending = inflight.get(id);
      if (!pending) {
        pending = ask(from, to).finally(() => inflight.delete(id));
        inflight.set(id, pending);
      }
      const minutes = await pending;
      if (minutes !== null) {
        if (cache.size >= capacity) cache.delete(cache.keys().next().value as string);
        cache.set(id, { minutes, at: now() });
      }
      return minutes;
    },
  };
}

/** Road time when the provider has an answer, the straight-line estimate when it does not, so there is always a number. */
export function withFallbackEta(primary: EtaProvider, fallback: EtaProvider): EtaProvider {
  return { async minutes(from, to) { return (await primary.minutes(from, to)) ?? fallback.minutes(from, to); } };
}
