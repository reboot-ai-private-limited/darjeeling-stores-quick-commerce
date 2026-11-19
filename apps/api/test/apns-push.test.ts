import { generateKeyPairSync } from "node:crypto";
import { decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { ProviderError, type PushProvider } from "../src/modules/notifications/application/ports.js";
import { apnsConfigFromEnv, createApnsPush, createRoutingPush, isApnsToken, type ApnsRequest } from "../src/modules/notifications/infrastructure/apns-push.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const TOKEN = "a".repeat(64);
const message = { token: TOKEN, title: "Out for delivery", body: "Your order is on the way", data: { type: "order", groupId: "g1" }, priority: "high" as const };
const base = { keyId: "KEY123", teamId: "TEAM123", bundleId: "in.darjeelingstores.customer", privateKey };
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => ({ status, headers, body: JSON.stringify(body) });
function fake(...answers: ReturnType<typeof reply>[]) {
  const calls: { origin: string; path: string; headers: Record<string, string>; body: string }[] = [];
  const request: ApnsRequest = async (origin, path, headers, body) => { calls.push({ origin, path, headers, body }); return answers.shift() ?? reply(200); };
  return { calls, request };
}
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as ProviderError; } throw new Error("expected a failure"); };

describe("push through Apple", () => {
  it("sends the alert with the data beside aps, signed for the right app", async () => {
    const { calls, request } = fake(reply(200, {}, { "apns-id": "abc" }));
    const result = await createApnsPush({ ...base, sandbox: false, request }).send(message);
    expect(result.messageId).toBe("abc");
    const c = calls[0]!;
    expect(c.origin).toBe("https://api.push.apple.com");
    expect(c.path).toBe(`/3/device/${TOKEN}`);
    expect(c.headers["apns-topic"]).toBe("in.darjeelingstores.customer");
    expect(c.headers["apns-priority"]).toBe("10");
    expect(decodeProtectedHeader(c.headers.authorization!.replace("bearer ", ""))).toMatchObject({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(c.body)).toEqual({ type: "order", groupId: "g1", aps: { alert: { title: "Out for delivery", body: "Your order is on the way" }, sound: "default" } });
  });
  it("uses Apple's sandbox when asked", async () => {
    const { calls, request } = fake();
    await createApnsPush({ ...base, sandbox: true, request }).send(message);
    expect(calls[0]!.origin).toBe("https://api.sandbox.push.apple.com");
  });
  it("forgets a token when the app was removed, keeps it on a bad token, retries on a server error", async () => {
    const push = (r: ReturnType<typeof reply>) => createApnsPush({ ...base, sandbox: false, request: fake(r).request }).send(message);
    const gone = await fails(push(reply(410, { reason: "Unregistered" })));
    expect([gone.invalidToken, gone.permanent]).toEqual([true, true]);
    const bad = await fails(push(reply(400, { reason: "BadDeviceToken" })));
    expect([bad.invalidToken, bad.permanent]).toEqual([false, true]);
    const busy = await fails(push(reply(503, { reason: "ServiceUnavailable" })));
    expect(busy.permanent).toBe(false);
  });
  it("signs in again once when Apple says the login expired", async () => {
    const { calls, request } = fake(reply(403, { reason: "ExpiredProviderToken" }), reply(200));
    await createApnsPush({ ...base, sandbox: false, request }).send(message);
    expect(calls).toHaveLength(2);
  });
  it("reads its settings from the environment", () => {
    expect(apnsConfigFromEnv({})).toBeUndefined();
    expect(apnsConfigFromEnv({ APNS_KEY: privateKey, APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_ENV: "sandbox" })).toMatchObject({ sandbox: true, bundleId: "in.darjeelingstores.customer" });
  });
  it("routes Apple tokens to Apple and Firebase tokens to Firebase", async () => {
    const seen: string[] = [];
    const named = (name: string): PushProvider => ({ name, send: async () => { seen.push(name); return { messageId: name }; } });
    const router = createRoutingPush(named("fcm"), named("apns"));
    await router.send(message);
    await router.send({ ...message, token: "dXyz:APA91bHk-token" });
    expect(seen).toEqual(["apns", "fcm"]);
    expect(isApnsToken(TOKEN)).toBe(true);
    expect(isApnsToken("abc:def")).toBe(false);
  });
});
