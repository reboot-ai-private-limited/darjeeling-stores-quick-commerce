/**
 * Safe local storage and cookie utilities for browser and SSR.
 */

export const isBrowser = typeof window !== "undefined";

export const storage = {
  get(key: string): string | null {
    if (!isBrowser) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set(key: string, value: string): void {
    if (!isBrowser) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore quota or privacy errors */
    }
  },

  remove(key: string): void {
    if (!isBrowser) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },

  getJSON<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  setJSON<T>(key: string, value: T): void {
    this.set(key, JSON.stringify(value));
  },
};

/** Get or set a simple browser cookie (e.g. for zoneId on SSR) */
export const cookies = {
  get(name: string): string | null {
    if (!isBrowser) return null;
    const match = document.cookie.match(new RegExp(`(^|;\\s*)(${name})=([^;]*)`));
    return match ? decodeURIComponent(match[3]!) : null;
  },

  set(name: string, value: string, days = 30): void {
    if (!isBrowser) return;
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${date.toUTCString()};path=/;SameSite=Lax`;
  },

  remove(name: string): void {
    if (!isBrowser) return;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
  },
};
