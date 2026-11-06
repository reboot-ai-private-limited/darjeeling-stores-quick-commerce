import { describe, expect, it } from "vitest";
import { createSecretCipher, hashPassword, newTotpSecret, totp, totpStep, verifyPassword } from "../src/modules/identity/infrastructure/credentials.js";
describe("staff credentials", () => {
  it("matches RFC 6238 SHA-1 vectors modulo six digits and rejects reused steps", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    for (const [seconds, expected] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]] as const) {
      const step = Math.floor(seconds / 30);
      expect(totp(secret, step)).toBe(expected);
      expect(totpStep(secret, expected, -1, seconds * 1000)).toBe(step);
      expect(totpStep(secret, expected, step, seconds * 1000)).toBeNull();
    }
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(totpStep(secret, "invalid")).toBeNull();
  });
  it("authenticates encrypted secrets to the user and encryption key", () => {
    const cipher = createSecretCipher("a".repeat(64));
    const secret = newTotpSecret();
    const encrypted = cipher.encrypt(secret, "user1");
    expect(encrypted).not.toContain(secret);
    expect(cipher.decrypt(encrypted, "user1")).toBe(secret);
    expect(() => cipher.decrypt(encrypted, "user2")).toThrow();
    expect(() => createSecretCipher("b".repeat(64)).decrypt(encrypted, "user1")).toThrow();
    expect(() => cipher.decrypt(`${encrypted.slice(0, -1)}${encrypted.endsWith("0") ? "1" : "0"}`, "user1")).toThrow();
  });
  it("uses distinct salts and verifies only supported password hashes", async () => {
    const hash = await hashPassword("Correct-Passw0rd!");
    expect(await verifyPassword("Correct-Passw0rd!", hash)).toBe(true);
    expect(await verifyPassword("Wrong-Passw0rd!", hash)).toBe(false);
    expect(await hashPassword("Correct-Passw0rd!")).not.toBe(hash);
    expect(await verifyPassword("x", "scrypt$v1$999999999$8$1$invalid")).toBe(false);
  });
});
