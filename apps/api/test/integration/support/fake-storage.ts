import type { StorageProvider } from "../../../src/modules/media/media.public.js";

export interface StoredObject { bytes: number; format: string | null; durationSec: number | null }

/**
 * A file store held in memory, with the same contract as a real provider. A test "uploads" by calling `upload(key, ...)`,
 * exactly as the client would after receiving the signed request, and can make deletes or lookups fail.
 */
export function createFakeStorage() {
  const objects = new Map<string, StoredObject>();
  const removed: string[] = [];
  const copies: string[] = [];
  const tickets: { key: string; contentType: string; maxBytes: number }[] = [];
  const state = { failRemove: false, failFinalize: false, finalizeCalls: 0 };

  const provider: StorageProvider = {
    name: "fake",
    async createUpload({ key, resource, access, contentType, maxBytes, expiresAt }) {
      tickets.push({ key, contentType, maxBytes });
      return {
        ref: { provider: "fake", key, resource, access, format: null },
        ticket: { url: "https://upload.fake.test/", method: "POST", fields: { key, "Content-Type": contentType, signature: "signed" }, expiresAt },
      };
    },
    async finalize(ref, { widths }) {
      state.finalizeCalls++;
      if (state.failFinalize) throw new Error("storage is down");
      const object = objects.get(ref.key);
      if (!object) return { exists: false, bytes: 0, format: null, durationSec: null, variants: [] };
      const variants = ref.access === "public" && ref.resource === "image" ? widths.map(width => ({ width, key: ref.key, bytes: null })) : [];
      return { exists: true, bytes: object.bytes, format: object.format, durationSec: object.durationSec, variants };
    },
    publicUrl: (ref, width) => `https://cdn.fake.test/${ref.key}/${width}.webp`,
    async signedReadUrl(ref, ttlSeconds) {
      return { url: `https://signed.fake.test/${ref.key}?ttl=${ttlSeconds}`, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    },
    async copy(source, destKey) {
      const object = objects.get(source.key);
      if (!object) throw new Error("source file is missing");
      objects.set(destKey, { ...object });
      copies.push(destKey);
      return { ref: { ...source, key: destKey }, bytes: object.bytes, durationSec: object.durationSec };
    },
    async remove(ref) {
      if (state.failRemove) throw new Error("AccessDenied");
      objects.delete(ref.key);
      removed.push(ref.key);
    },
  };

  return {
    provider, objects, removed, copies, tickets, state,
    /** What the client does after receiving the signed request: put the file there. */
    upload(key: string, info: Partial<StoredObject> = {}) {
      objects.set(key, { bytes: info.bytes ?? 50_000, format: info.format === undefined ? "jpg" : info.format, durationSec: info.durationSec ?? null });
    },
    has: (key: string) => objects.has(key),
    reset() { objects.clear(); removed.length = 0; copies.length = 0; tickets.length = 0; state.failRemove = false; state.failFinalize = false; state.finalizeCalls = 0; },
  };
}
export type FakeStorage = ReturnType<typeof createFakeStorage>;
