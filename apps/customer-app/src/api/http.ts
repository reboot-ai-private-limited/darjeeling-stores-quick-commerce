import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_ORIGIN, API_URL } from "./config";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: Record<string, unknown>) { super(message); }
}

type Tokens = { access: string; refresh: string };
const KEY = "customer.session";
let tokens: Tokens | null = null;
let loaded = false;

// Secure storage on the phone; plain localStorage on the web preview.
const store = {
  get: async (): Promise<string | null> => { try { return Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY); } catch { return null; } },
  set: async (v: string) => { try { if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, v); else await SecureStore.setItemAsync(KEY, v); } catch { /* storage unavailable */ } },
  del: async () => { try { if (Platform.OS === "web") globalThis.localStorage?.removeItem(KEY); else await SecureStore.deleteItemAsync(KEY); } catch { /* ignore */ } },
};

export async function loadSession(): Promise<boolean> {
  if (!loaded) { const raw = await store.get(); if (raw) { try { tokens = JSON.parse(raw) as Tokens; } catch { tokens = null; } } loaded = true; }
  return tokens !== null;
}
export async function saveSession(session: { accessToken: string; refreshToken: string }) {
  tokens = { access: session.accessToken, refresh: session.refreshToken }; loaded = true;
  await store.set(JSON.stringify(tokens));
}
export async function clearSession() { tokens = null; loaded = true; await store.del(); }
export const refreshTokenValue = () => tokens?.refresh ?? null;

const headers = (withAuth: boolean, extra?: Record<string, string>): Record<string, string> => ({
  "Content-Type": "application/json", Accept: "application/json", "X-Client": "customer-app",
  ...(withAuth && tokens ? { Authorization: `Bearer ${tokens.access}` } : {}),
  ...(extra ?? {}),
});

async function send(method: string, path: string, body: unknown, withAuth: boolean, extra?: Record<string, string>) {
  let res: Response;
  // Without a time limit, a phone that can't reach the server would wait forever and the screen would never move on.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers: headers(withAuth, extra), signal: controller.signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_ORIGIN.replace(/^https?:\/\//, "")}. Check that your phone is on the same Wi-Fi as the computer and that the API is running.`, 0, "NETWORK");
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { res, json: json as { data?: unknown; meta?: unknown; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null };
}

let refreshing: Promise<boolean> | null = null;
/** Swaps the refresh token for a new session. One refresh at a time, because an old refresh token must never be replayed. */
async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      if (!tokens) return false;
      const { res, json } = await send("POST", "/auth/refresh", { refreshToken: tokens.refresh }, false);
      const data = json?.data as { accessToken?: string; refreshToken?: string } | undefined;
      if (res.ok && data?.accessToken && data.refreshToken) { await saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken }); return true; }
      await clearSession();
      return false;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Called when the session is no longer valid (expired or revoked), so the app can go back to Login. */
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: (() => void) | null) => { onSignedOut = fn; };

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const withAuth = opts.auth !== false;
  await loadSession();
  let { res, json } = await send(method, path, body, withAuth, opts.headers);
  if (res.status === 401 && withAuth && tokens) {
    if (await refresh()) ({ res, json } = await send(method, path, body, withAuth, opts.headers));
    else { onSignedOut?.(); throw new ApiError("Your session has ended. Please sign in again.", 401, "UNAUTHORIZED"); }
  }
  if (!res.ok) throw new ApiError(json?.error?.message ?? "Something went wrong. Please try again.", res.status, json?.error?.code, json?.error?.details);
  return { data: json?.data as T, meta: json?.meta as Record<string, unknown> | undefined };
}
