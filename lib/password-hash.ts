import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Staff passwords (DECISIONS M18): scrypt with a random salt, stored as
 * `scrypt$N$r$p$<salt b64>$<hash b64>` so the cost can be raised later without breaking old hashes.
 * Node-only (used by the login service and scripts/set-staff-password.ts); never import in the client.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export const PASSWORD_RULES = { min: 8, max: 128 } as const;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, key) =>
      e ? reject(e) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}
