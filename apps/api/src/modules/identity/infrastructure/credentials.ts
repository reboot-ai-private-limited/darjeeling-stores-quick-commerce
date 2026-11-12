import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

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
