import { describe, expect, it } from "vitest";
import { createTokenSigner } from "../src/modules/tracking/application/token.js";
import { baselineEta, DEFAULT_TRACKING_SETTINGS } from "../src/modules/tracking/domain/tracking.js";
import { DEFAULT_SYNC_SETTINGS, MESSAGES } from "../src/modules/sync/domain/sync.js";

const NOW = new Date("2026-11-06T10:00:00Z");
const LATER = new Date("2026-11-07T10:00:00Z");

describe("tracking links", () => {
  const signer = createTokenSigner("secret-one");
  it("round-trips an order and its expiry", () => {
    const token = signer.create("a".repeat(24), LATER);
    expect(signer.verify(token, NOW)).toEqual({ orderId: "a".repeat(24), expiresAt: LATER });
  });
  it("rejects an expired link, including the exact moment of expiry", () => {
    const token = signer.create("a".repeat(24), LATER);
    expect(signer.verify(token, LATER)).toBeNull();
    expect(signer.verify(token, new Date(LATER.getTime() + 1))).toBeNull();
    expect(signer.verify(token, new Date(LATER.getTime() - 1))).not.toBeNull();
  });
  it("rejects a link signed with another secret, edited, truncated or malformed", () => {
    const token = signer.create("a".repeat(24), LATER);
    const [body, sig] = token.split(".") as [string, string];
    expect(createTokenSigner("secret-two").verify(token, NOW)).toBeNull();
    expect(signer.verify(`${body}.${sig.slice(0, -2)}`, NOW)).toBeNull();
    expect(signer.verify(`${Buffer.from(JSON.stringify({ o: "b".repeat(24), e: LATER.getTime() })).toString("base64url")}.${sig}`, NOW)).toBeNull();
    for (const bad of ["", ".", "a.b.c", "a", `${body}.`, `.${sig}`, "x".repeat(500)]) expect(signer.verify(bad, NOW), bad).toBeNull();
    expect(signer.verify(`${body.slice(0, -1)}.${sig}`, NOW)).toBeNull();
  });
  it("cannot be used at all without a secret", () => {
    const none = createTokenSigner(undefined);
    expect(none.available).toBe(false);
    expect(() => none.create("a".repeat(24), LATER)).toThrow();
    expect(none.verify(signer.create("a".repeat(24), LATER), NOW)).toBeNull();
  });
});

describe("the baseline ETA", () => {
  const eta = baselineEta(DEFAULT_TRACKING_SETTINGS);
  const here = { lat: 27.041, lng: 88.2663 };
  it("is at least a minute even at the door", async () => {
    expect(await eta.minutes(here, here)).toBe(1);
  });
  it("grows with distance, allowing for winding roads", async () => {
    // About 1.1 km straight, 1.4 km by road, 4.7 minutes at 18 km/h.
    expect(await eta.minutes(here, { lat: 27.051, lng: 88.2663 })).toBe(5);
    expect(await eta.minutes(here, { lat: 27.081, lng: 88.2663 })).toBe(20);
  });
  it("adds the extra minutes for rain or night", async () => {
    const wet = baselineEta({ ...DEFAULT_TRACKING_SETTINGS, extraMinutes: 7 });
    expect(await wet.minutes(here, here)).toBe(8);
  });
});

describe("sync settings", () => {
  it("has a message for every conflict a rider can see", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(["already_delivered", "already_paid_online", "invalid_transition", "not_assigned_to_you", "order_cancelled", "otp_mismatch", "reassigned"]);
    expect(MESSAGES.otp_mismatch).toBe("The OTP did not match. An admin will review this delivery.");
  });
  it("flags a delivery more than 300 m from the address by default and has no UPI until configured", () => {
    expect(DEFAULT_SYNC_SETTINGS).toMatchObject({ geofenceMeters: 300, otpIterations: 100_000, otpAttempts: 5, upi: null });
  });
});
