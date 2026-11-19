import fs from "node:fs";
import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import { ProviderError, type PushMessage, type PushProvider } from "../application/ports.js";

export interface ApnsConfig {
  keyId: string; teamId: string; bundleId: string; privateKey: string; sandbox: boolean;
  /** Replaceable for tests. Sends one HTTP/2 request to Apple and returns what came back. */
  request?: ApnsRequest; now?: () => Date; timeoutMs?: number;
}
export type ApnsRequest = (origin: string, path: string, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

/** An Apple device token is 64 or more hex characters. Firebase tokens always contain ":" so the two never look alike. */
export const isApnsToken = (token: string): boolean => /^[0-9a-f]{64,200}$/i.test(token);

/**
 * Reads the Apple push key from the environment:
 * APNS_KEY_ID, APNS_TEAM_ID, the .p8 key as `APNS_KEY` (the text) or `APNS_KEY_FILE` (a path), optional APNS_BUNDLE_ID (default the customer app)
 * and APNS_ENV = "production" (default; TestFlight and App Store) or "sandbox" (apps run straight from Xcode).
 */
export function apnsConfigFromEnv(env: NodeJS.ProcessEnv): ApnsConfig | undefined {
  try {
    const raw = env.APNS_KEY ?? (env.APNS_KEY_FILE ? fs.readFileSync(env.APNS_KEY_FILE, "utf8") : undefined);
    if (!raw || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return undefined;
    return { keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, bundleId: env.APNS_BUNDLE_ID ?? "in.darjeelingstores.customer", privateKey: raw.replace(/\\n/g, "\n"), sandbox: env.APNS_ENV === "sandbox" };
  } catch { return undefined; }
}

const defaultRequest: ApnsRequest = (origin, path, headers, body, timeoutMs) => new Promise((resolve, reject) => {
  const session = http2.connect(origin);
  const done = (fn: () => void) => { session.close(); fn(); };
  session.setTimeout(timeoutMs, () => done(() => reject(new Error("timeout"))));
  session.on("error", error => done(() => reject(error)));
  const req = session.request({ ":method": "POST", ":path": path, ...headers });
  let status = 0; const responseHeaders: Record<string, string> = {}; let text = "";
  req.setEncoding("utf8");
  req.on("response", h => { status = Number(h[":status"]); for (const [k, v] of Object.entries(h)) if (typeof v === "string") responseHeaders[k] = v; });
  req.on("data", chunk => { text += chunk; });
  req.on("end", () => done(() => resolve({ status, headers: responseHeaders, body: text })));
  req.on("error", error => done(() => reject(error)));
  req.end(body);
});

/** Push to iPhones straight through Apple (APNs), signed with the team's .p8 key. The login token is cached for 50 minutes. */
export function createApnsPush(config: ApnsConfig): PushProvider {
  const request = config.request ?? defaultRequest;
  const now = config.now ?? (() => new Date());
  const timeout = config.timeoutMs ?? 15_000;
  const origin = config.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  let cached: { token: string; issuedAt: number } | undefined;

  async function jwt(force = false): Promise<string> {
    const nowMs = now().getTime();
    if (!force && cached && nowMs - cached.issuedAt < 50 * 60_000) return cached.token;
    const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: config.keyId }).setIssuer(config.teamId).setIssuedAt(Math.floor(nowMs / 1000))
      .sign(await importPKCS8(config.privateKey, "ES256"));
    cached = { token, issuedAt: nowMs };
    return token;
  }

  async function post(m: PushMessage, token: string) {
    // Everything in `data` sits beside "aps" so the app reads it as the notification's data.
    const payload = { ...m.data, aps: { ...((m.title || m.body) && { alert: { ...(m.title && { title: m.title }), ...(m.body && { body: m.body }) } }), sound: "default" } };
    try {
      return await request(origin, `/3/device/${m.token}`, {
        authorization: `bearer ${token}`, "apns-topic": config.bundleId, "apns-push-type": "alert",
        "apns-priority": m.priority === "high" ? "10" : "5", "content-type": "application/json",
      }, JSON.stringify(payload), timeout);
    } catch { throw new ProviderError("Could not reach Apple's push service", false); }
  }

  return {
    name: "apns",
    async send(m) {
      let response = await post(m, await jwt());
      // An expired login can mean our cached token went stale: sign in again once.
      if (response.status === 403 && /ExpiredProviderToken/.test(response.body)) response = await post(m, await jwt(true));
      if (response.status === 200) return { messageId: response.headers["apns-id"] ?? "" };
      const reason = (() => { try { return String((JSON.parse(response.body) as { reason?: string }).reason ?? response.status); } catch { return String(response.status); } })();
      // The app was removed from the phone: forget the token. (BadDeviceToken is kept: it can also mean a sandbox/production mix-up.)
      if (response.status === 410 || reason === "Unregistered") throw new ProviderError(`Apple: ${reason}`, true, reason, true);
      if (response.status === 429 || response.status >= 500) throw new ProviderError(`Apple: ${reason}`, false, reason);
      throw new ProviderError(`Apple: ${reason}`, true, reason);
    },
  };
}

/** Sends each token to the right provider: Apple tokens to APNs, everything else to Firebase. */
export function createRoutingPush(fcm: PushProvider, apns: PushProvider): PushProvider {
  return { name: `${fcm.name}+${apns.name}`, send: m => (isApnsToken(m.token) ? apns : fcm).send(m) };
}

/**
 * What is wrong with the Apple push settings, in plain words. Empty when they are unset (iPhone push is simply off) or complete and readable.
 * Used at start-up so a typo shows in the log instead of push quietly failing later.
 */
export async function apnsSetupProblems(env: NodeJS.ProcessEnv): Promise<string[]> {
  const anySet = ["APNS_KEY", "APNS_KEY_FILE", "APNS_KEY_ID", "APNS_TEAM_ID"].some(name => env[name]);
  if (!anySet) return [];
  const problems: string[] = [];
  if (!env.APNS_KEY_ID) problems.push("APNS_KEY_ID is missing (the 10-character Key ID shown next to the .p8 key)");
  if (!env.APNS_TEAM_ID) problems.push("APNS_TEAM_ID is missing (the 10-character Team ID from Membership details)");
  if (env.APNS_KEY_ID && !/^[A-Z0-9]{10}$/i.test(env.APNS_KEY_ID)) problems.push("APNS_KEY_ID should be exactly 10 letters or digits");
  if (env.APNS_TEAM_ID && !/^[A-Z0-9]{10}$/i.test(env.APNS_TEAM_ID)) problems.push("APNS_TEAM_ID should be exactly 10 letters or digits");
  if (env.APNS_ENV && !["production", "sandbox"].includes(env.APNS_ENV)) problems.push('APNS_ENV must be "production" or "sandbox"');
  let key = env.APNS_KEY;
  if (!key && env.APNS_KEY_FILE) {
    try { key = fs.readFileSync(env.APNS_KEY_FILE, "utf8"); } catch { problems.push(`APNS_KEY_FILE cannot be read: ${env.APNS_KEY_FILE}`); }
  } else if (!key) problems.push("The .p8 key is missing: set APNS_KEY_FILE (a path) or APNS_KEY (the text)");
  if (key) {
    try { await importPKCS8(key.replace(/\n/g, "\n"), "ES256"); }
    catch { problems.push("The .p8 key is not a valid Apple key (it should start with -----BEGIN PRIVATE KEY-----)"); }
  }
  return problems;
}

/** Plain-words advice for the answers Apple gives, so a failed test says what to fix. */
export function apnsAdvice(code: string | undefined): string {
  switch (code) {
    case "InvalidProviderToken": return "Apple rejected the login: the Key ID, Team ID or .p8 file do not match each other. Re-check all three.";
    case "ExpiredProviderToken": return "The signing clock is off. Check the server's date and time.";
    case "TopicDisallowed": return "This key cannot send for this app. Check APNS_BUNDLE_ID, and that the key has Apple Push Notifications service enabled.";
    case "BadDeviceToken": return "The login is fine, but this token does not belong here. Usually the wrong APNS_ENV (sandbox vs production), or a token from another app.";
    case "DeviceTokenNotForTopic": return "The token belongs to a different app than APNS_BUNDLE_ID.";
    case "Unregistered": return "The app was removed from that phone.";
    case "MissingTopic": return "APNS_BUNDLE_ID is empty.";
    default: return "";
  }
}
