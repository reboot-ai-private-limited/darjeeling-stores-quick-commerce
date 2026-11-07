import { describe, expect, it, vi } from "vitest";
import { deriveKey } from "../src/composition/production.js";
import { loadConfig } from "../src/config/env.js";
import { liveSettings } from "../src/platform/settings.js";
import { createGoogleRoutesEta, withFallbackEta } from "../src/modules/tracking/tracking.public.js";

describe("live settings object", () => {
  const defaults = { a: 1, b: "x", c: true };
  it("falls back to the defaults, and later sources win over earlier ones", () => {
    const s = liveSettings(defaults, { a: 2 }, { b: "y", a: undefined });
    expect(s.a).toBe(2);
    expect(s.b).toBe("y");
    expect(s.c).toBe(true);
  });
  it("reads a source each time, so a later change shows up, which a copy would not", () => {
    const source = { a: 5 };
    const s = liveSettings(defaults, source);
    expect(s.a).toBe(5);
    source.a = 9;
    expect(s.a).toBe(9);
    const copy = { ...s };
    source.a = 11;
    expect(s.a).toBe(11);
    expect(copy.a).toBe(9);
  });
  it("works with getters, lists its keys and ignores keys it does not know", () => {
    let n = 1;
    const s = liveSettings(defaults, { get a() { return n; } });
    expect(s.a).toBe(1);
    n = 3;
    expect(s.a).toBe(3);
    expect(Object.keys(s).sort()).toEqual(["a", "b", "c"]);
    expect("a" in s && !("z" in s)).toBe(true);
    expect((s as Record<string, unknown>).z).toBeUndefined();
  });
});

describe("Google Routes travel time", () => {
  const from = { lat: 27.041, lng: 88.2663 }, to = { lat: 27.05, lng: 88.27 };
  const ok = (duration: string) => vi.fn(async () => new Response(JSON.stringify({ routes: [{ duration }] }), { status: 200 }));

  it("asks for a two-wheeler route and rounds the seconds up to whole minutes", async () => {
    const fetchMock = ok("421s");
    const eta = createGoogleRoutesEta({ apiKey: "k".repeat(12), fetch: fetchMock as never });
    expect(await eta.minutes(from, to)).toBe(8);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k".repeat(12));
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("routes.duration");
    expect(JSON.parse(init.body as string)).toMatchObject({ travelMode: "TWO_WHEELER", origin: { location: { latLng: { latitude: 27.041, longitude: 88.2663 } } } });
  });
  it("calls once for the same pair of places, and shares one call between simultaneous requests", async () => {
    const fetchMock = ok("300s");
    const eta = createGoogleRoutesEta({ apiKey: "k".repeat(12), fetch: fetchMock as never });
    const [a, b] = await Promise.all([eta.minutes(from, to), eta.minutes(from, to)]);
    expect([a, b]).toEqual([5, 5]);
    await eta.minutes({ lat: 27.04100004, lng: 88.2663 }, to);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("asks again after the answer has expired, and keeps a bounded memory", async () => {
    let now = 0;
    const fetchMock = ok("120s");
    const eta = createGoogleRoutesEta({ apiKey: "k".repeat(12), fetch: fetchMock as never, now: () => now, cacheMs: 1000, cacheSize: 2 });
    await eta.minutes(from, to);
    now = 2000;
    await eta.minutes(from, to);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i++) await eta.minutes({ lat: 27 + i / 100, lng: 88 }, to);
    expect(fetchMock.mock.calls.length).toBe(7);
  });
  it("answers null, never an error, when there is no key, no route, a bad answer or a failure", async () => {
    expect(await createGoogleRoutesEta({ apiKey: "", fetch: ok("60s") as never }).minutes(from, to)).toBeNull();
    for (const bad of [
      vi.fn(async () => new Response("{}", { status: 200 })), vi.fn(async () => new Response("nope", { status: 500 })),
      vi.fn(async () => new Response(JSON.stringify({ routes: [{ duration: "soon" }] }), { status: 200 })), vi.fn(async () => { throw new Error("offline"); }),
    ]) expect(await createGoogleRoutesEta({ apiKey: "k".repeat(12), fetch: bad as never }).minutes(from, to)).toBeNull();
  });
  it("does not remember a failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ routes: [{ duration: "600s" }] }), { status: 200 }));
    const eta = createGoogleRoutesEta({ apiKey: "k".repeat(12), fetch: fetchMock as never });
    expect(await eta.minutes(from, to)).toBeNull();
    expect(await eta.minutes(from, to)).toBe(10);
  });
  it("falls back to the straight-line estimate whenever the road time is missing", async () => {
    const eta = withFallbackEta({ minutes: async () => null }, { minutes: async () => 7 });
    expect(await eta.minutes(from, to)).toBe(7);
    expect(await withFallbackEta({ minutes: async () => 4 }, { minutes: async () => 7 }).minutes(from, to)).toBe(4);
  });
});

describe("keys and configuration", () => {
  it("derives a different, repeatable key for each purpose, never the secret itself", () => {
    const secret = "a".repeat(64);
    const order = deriveKey(secret, "order-delivery-code"), tracking = deriveKey(secret, "tracking-links");
    expect(order).toMatch(/^[a-f0-9]{64}$/);
    expect(order).not.toBe(tracking);
    expect(order).not.toBe(secret);
    expect(deriveKey(secret, "order-delivery-code")).toBe(order);
    expect(deriveKey("b".repeat(64), "order-delivery-code")).not.toBe(order);
  });
  const base = { MONGODB_URI: "mongodb://localhost/x" } as NodeJS.ProcessEnv;
  it("accepts the optional provider settings and rejects malformed ones", () => {
    const ok = loadConfig({ ...base, ORDER_OTP_KEY: "c".repeat(64), TRACKING_BASE_URL: "https://darjeelingstores.in", UPI_VPA: "darjeeling@okbank", UPI_PAYEE_NAME: "Darjeeling Stores", GOOGLE_MAPS_API_KEY: "AIzaSyExampleKey123" });
    expect(ok).toMatchObject({ TRACKING_BASE_URL: "https://darjeelingstores.in", UPI_VPA: "darjeeling@okbank" });
    expect(() => loadConfig({ ...base, ORDER_OTP_KEY: "short" })).toThrow(/ORDER_OTP_KEY/);
    expect(() => loadConfig({ ...base, TRACKING_BASE_URL: "ftp://x.example" })).toThrow(/TRACKING_BASE_URL/);
    expect(() => loadConfig({ ...base, UPI_VPA: "not a vpa", UPI_PAYEE_NAME: "x" })).toThrow(/UPI_VPA/);
    expect(() => loadConfig({ ...base, UPI_VPA: "darjeeling@okbank" })).toThrow(/UPI_PAYEE_NAME/);
    expect(loadConfig(base)).not.toHaveProperty("GOOGLE_MAPS_API_KEY", expect.anything());
  });
});
