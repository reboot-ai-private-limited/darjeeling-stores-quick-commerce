import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64,
  { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$v1$131072$8$1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const match = /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match || Buffer.byteLength(password) > 1024) return false;
  return timingSafeEqual(await derive(password, match[1]!), Buffer.from(match[2]!, "hex"));
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = 0, value = 0, result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return result;
}
function decodeSecret(secret: string) {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error("Invalid TOTP secret");
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const letter of secret) {
    value = (value << 5) | alphabet.indexOf(letter); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeSecret(secret)).update(counter).digest();
  const offset = digest.at(-1)! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export function totpStep(secret: string, code: string, lastStep = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate >= 0 && candidate > lastStep && timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code))) return candidate;
  }
  return null;
}
export function createSecretCipher(hexKey: string) {
  if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw new Error("STAFF_TOTP_KEY must be a random 32-byte hex key");
  const key = Buffer.from(hexKey, "hex");
  return {
    encrypt(secret: string, userId: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(userId));
      const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      return `v1.${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`;
    },
    decrypt(value: string, userId: string) {
      const match = /^v1\.([a-f0-9]{24})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
      if (!match) throw new Error("Invalid encrypted TOTP secret");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(match[1]!, "hex"));
      decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(match[2]!, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(match[3]!, "hex")), decipher.final()]).toString("utf8");
    },
  };
}
