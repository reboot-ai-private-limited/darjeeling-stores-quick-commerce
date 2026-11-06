import fs from "node:fs";
import { SignJWT, importPKCS8 } from "jose";
import { ProviderError, type PushProvider } from "../application/ports.js";

export interface FcmConfig {
  projectId: string; clientEmail: string; privateKey: string; tokenUri?: string;
  fetch?: typeof fetch; now?: () => Date; timeoutMs?: number;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Reads a Firebase service account from `FCM_SERVICE_ACCOUNT_JSON` (the JSON text) or `FCM_SERVICE_ACCOUNT_FILE` (a path to it). */
export function fcmConfigFromEnv(env: NodeJS.ProcessEnv): FcmConfig | undefined {
  try {
    const raw = env.FCM_SERVICE_ACCOUNT_JSON ?? (env.FCM_SERVICE_ACCOUNT_FILE ? fs.readFileSync(env.FCM_SERVICE_ACCOUNT_FILE, "utf8") : undefined);
    if (!raw) return undefined;
    const account = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string; token_uri?: string };
    if (!account.project_id || !account.client_email || !account.private_key) return undefined;
    return { projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key, ...(account.token_uri && { tokenUri: account.token_uri }) };
  } catch { return undefined; }
}

/** Push through Firebase Cloud Messaging (HTTP v1). The login to Google is a signed token, cached until shortly before it expires. */
export function createFcmPush(config: FcmConfig): PushProvider {
  const http = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const timeout = config.timeoutMs ?? 15_000;
  const tokenUri = config.tokenUri ?? "https://oauth2.googleapis.com/token";
  let cached: { token: string; expiresAt: number } | undefined;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try { return await http(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new ProviderError("Could not reach Firebase", false); }
  }

  async function accessToken(force = false): Promise<string> {
    const nowMs = now().getTime();
    if (!force && cached && cached.expiresAt - 60_000 > nowMs) return cached.token;
    const seconds = Math.floor(nowMs / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(config.clientEmail).setSubject(config.clientEmail).setAudience(tokenUri)
      .setIssuedAt(seconds).setExpirationTime(seconds + 3600).sign(await importPKCS8(config.privateKey, "RS256"));
    const response = await call(tokenUri, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!response.ok || !body.access_token) throw new ProviderError("Firebase rejected the server's credentials", true, "AUTH");
    cached = { token: body.access_token, expiresAt: nowMs + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  async function post(message: object, token: string): Promise<Response> {
    return call(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message }),
    });
  }

  return {
    name: "fcm",
    async send(m) {
      const message = {
        token: m.token, data: m.data,
        ...((m.title || m.body) && { notification: { ...(m.title && { title: m.title }), ...(m.body && { body: m.body }), ...(m.imageUrl && { image: m.imageUrl }) } }),
        android: { priority: m.priority === "high" ? "HIGH" : "NORMAL" },
        apns: { headers: { "apns-priority": m.priority === "high" ? "10" : "5" } },
      };
      let response = await post(message, await accessToken());
      // A rejected login can mean our cached token went stale: log in again once.
      if (response.status === 401) response = await post(message, await accessToken(true));
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { name?: string };
        return { messageId: body.name ?? "" };
      }
      const body = (await response.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
      const code = body.error?.details?.find(d => d.errorCode)?.errorCode ?? body.error?.status ?? String(response.status);
      const text = body.error?.message ?? `Firebase answered ${response.status}`;
      // The token no longer belongs to an installed app, or never did: forget it.
      if (code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH" || response.status === 404 || (code === "INVALID_ARGUMENT" && /registration token/i.test(text))) {
        throw new ProviderError(text, true, code, true);
      }
      if (response.status === 429 || response.status >= 500) throw new ProviderError(text, false, code);
      throw new ProviderError(text, true, code);
    },
  };
}
