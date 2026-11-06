import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks the `X-Hub-Signature-256` header Meta adds to every webhook call: HMAC-SHA256 of the exact bytes received, keyed
 * with the app secret, compared in constant time.
 */
export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!rawBody || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface DeliveryReport { id: string; status: string; error?: string }

/** The message status updates inside a WhatsApp webhook call. Incoming customer replies are ignored. */
const object = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null);

export function deliveryReportsIn(payload: unknown): DeliveryReport[] {
  const reports: DeliveryReport[] = [];
  const entries = object(payload)?.entry;
  if (!Array.isArray(entries)) return reports;
  for (const entry of entries) {
    const changes = object(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = object(object(change)?.value)?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const item of statuses) {
        const s = object(item);
        if (!s || typeof s.id !== "string" || typeof s.status !== "string") continue;
        const first = Array.isArray(s.errors) ? object(s.errors[0]) : null;
        const error = typeof first?.message === "string" ? first.message : typeof first?.title === "string" ? first.title : undefined;
        reports.push({ id: s.id, status: s.status, ...(error !== undefined && { error }) });
      }
    }
  }
  return reports;
}
