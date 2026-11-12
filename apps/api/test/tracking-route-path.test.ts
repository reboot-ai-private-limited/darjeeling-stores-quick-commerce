import { describe, expect, it } from "vitest";
import { createGoogleRoutePath, decodePolyline } from "../src/modules/tracking/tracking.public.js";

describe("decodePolyline", () => {
  it("decodes Google's documented example", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ lat: 38.5, lng: -120.2 });
    expect(pts[1]).toEqual({ lat: 40.7, lng: -120.95 });
    expect(pts[2]).toEqual({ lat: 43.252, lng: -126.453 });
  });
});

describe("createGoogleRoutePath", () => {
  const from = { lat: 27.04, lng: 88.26 }, to = { lat: 27.05, lng: 88.27 };
  const ok = (calls: { n: number }) => (async () => { calls.n++; return new Response(JSON.stringify({ routes: [{ duration: "540s", distanceMeters: 2300, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] })); }) as unknown as typeof fetch;

  it("returns the road and reuses it for the same places", async () => {
    const calls = { n: 0 };
    const provider = createGoogleRoutePath({ apiKey: "k", fetch: ok(calls), now: () => 1000 });
    const a = await provider.path(from, to);
    const b = await provider.path(from, to);
    expect(a).toMatchObject({ distanceM: 2300, durationS: 540, approximate: false });
    expect(a!.points).toHaveLength(2);
    expect(b).toBe(a);
    expect(calls.n).toBe(1);
  });
  it("answers null with no key, on an error and on a bad answer", async () => {
    expect(await createGoogleRoutePath({ apiKey: "" }).path(from, to)).toBeNull();
    expect(await createGoogleRoutePath({ apiKey: "k", fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch }).path(from, to)).toBeNull();
    expect(await createGoogleRoutePath({ apiKey: "k", fetch: (async () => new Response(JSON.stringify({ routes: [] }))) as unknown as typeof fetch }).path(from, to)).toBeNull();
    expect(await createGoogleRoutePath({ apiKey: "k", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch }).path(from, to)).toBeNull();
  });
});
