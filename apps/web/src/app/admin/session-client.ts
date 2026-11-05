export type AdminSession = { user: { name: string; phone: string; role: string } };

let refreshing: Promise<boolean> | null = null;
async function refreshCookies(): Promise<boolean> {
  if (!refreshing) {
    const rotate = async () => {
      const current = await fetch("/api/v1/me", { credentials: "same-origin", cache: "no-store" });
      if (current.ok) return true;
      if (current.status !== 401) return false;
      const response = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": "1", "X-Client": "admin" } });
      return response.ok;
    };
    // Serialize rotation across requests and tabs; an old refresh token must never be intentionally replayed.
    refreshing = (async () => {
      if (navigator.locks) return await navigator.locks.request("darjeeling-session-refresh", rotate);
      return await rotate();
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  if (response.status !== 401 || init.signal?.aborted) return response;
  if (!await refreshCookies()) return response;
  return fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
}

export async function readAdminSession(): Promise<AdminSession | null> {
  const response = await adminFetch("/api/v1/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Unable to check your session. Please try again.");
  const { data: user } = await response.json();
  if (!["super_admin", "admin"].includes(user?.role)) return null;
  return { user };
}
