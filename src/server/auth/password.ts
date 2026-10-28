import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing with Node's built-in scrypt, so no native dependency is needed.
// Parameters follow the OWASP Password Storage Cheat Sheet (N=2^17, r=8, p=1), which uses
// 128 MiB per hash. That makes each guess expensive for an attacker holding the hashes.
// The parameters are stored with each hash, so they can be raised later without
// invalidating existing passwords.

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const DEFAULT_PARAMS = { N: 2 ** 17, r: 8, p: 1 };

export type ScryptParams = { N: number; r: number; p: number };

// Hashes look like: scrypt$131072$8$1$<salt base64url>$<hash base64url>
const HASH_PATTERN = /^scrypt\$(?<N>\d+)\$(?<r>\d+)\$(?<p>\d+)\$(?<salt>[\w-]+)\$(?<key>[\w-]+)$/;

export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** False for a wrong password and for a hash that is not in the expected format. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const groups = HASH_PATTERN.exec(stored)?.groups;
  if (!groups) return false;
  // Every group is non-optional, so a match always has all five.
  const { N, r, p, salt, key: expected } = groups as Record<"N" | "r" | "p" | "salt" | "key", string>;
  const expectedKey = Buffer.from(expected, "base64url");
  if (expectedKey.length !== KEY_LENGTH) return false;
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  // Constant-time comparison, so response time does not reveal how many bytes matched.
  return timingSafeEqual(key, expectedKey);
}

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes; Node's default cap (32 MiB) is below the OWASP setting.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
