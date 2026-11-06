import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (buffer: Buffer | string) => Buffer.from(buffer).toString("base64url");

/** Signed, expiring links for the public tracking page. Nothing is stored: the link carries the order and its expiry. */
export function createTokenSigner(secret: string | undefined) {
  const sign = (body: string) => createHmac("sha256", secret ?? "").update(body).digest();
  return {
    available: Boolean(secret),
    create(orderId: string, expiresAt: Date): string {
      if (!secret) throw new Error("No tracking secret is configured");
      const body = b64(JSON.stringify({ o: orderId, e: expiresAt.getTime() }));
      return `${body}.${b64(sign(body))}`;
    },
    /** The order a good, unexpired link is for; null for anything else, so a link cannot be probed. */
    verify(token: string, now: Date): { orderId: string; expiresAt: Date } | null {
      if (!secret || token.length > 400) return null;
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra !== undefined) return null;
      const expected = sign(body);
      const given = Buffer.from(signature, "base64url");
      // The signature must be written in its one canonical form, or a changed last character could still decode to the same bytes.
      if (given.length !== expected.length || b64(given) !== signature || !timingSafeEqual(given, expected)) return null;
      try {
        const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { o?: unknown; e?: unknown };
        if (typeof parsed.o !== "string" || typeof parsed.e !== "number" || parsed.e <= now.getTime()) return null;
        return { orderId: parsed.o, expiresAt: new Date(parsed.e) };
      } catch { return null; }
    },
  };
}
export type TokenSigner = ReturnType<typeof createTokenSigner>;
