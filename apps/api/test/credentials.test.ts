import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/modules/identity/infrastructure/credentials.js";
describe("staff credentials", () => {
  it("uses distinct salts and verifies only supported password hashes", async () => {
    const hash = await hashPassword("Correct-Passw0rd!");
    expect(await verifyPassword("Correct-Passw0rd!", hash)).toBe(true);
    expect(await verifyPassword("Wrong-Passw0rd!", hash)).toBe(false);
    expect(await hashPassword("Correct-Passw0rd!")).not.toBe(hash);
    expect(await verifyPassword("x", "scrypt$v1$999999999$8$1$invalid")).toBe(false);
  }, 30_000);
});
