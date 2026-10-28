import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

// Cheap parameters keep most tests fast; one test covers the real defaults.
const FAST = { N: 1024, r: 8, p: 1 };

describe("hashPassword / verifyPassword", () => {
  it("verifies the password it hashed and rejects others", async () => {
    const hash = await hashPassword("correct horse battery staple", FAST);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("uses the OWASP scrypt parameters by default and records them in the hash", async () => {
    const hash = await hashPassword("s3cret");
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(await verifyPassword("s3cret", hash)).toBe(true);
  });

  it("salts every hash, so equal passwords do not produce equal hashes", async () => {
    const [a, b] = await Promise.all([hashPassword("same", FAST), hashPassword("same", FAST)]);
    expect(a).not.toBe(b);
  });

  it("verifies with the parameters stored in the hash, not the current defaults", async () => {
    const hash = await hashPassword("old account", { N: 2048, r: 4, p: 2 });
    expect(hash.startsWith("scrypt$2048$4$2$")).toBe(true);
    expect(await verifyPassword("old account", hash)).toBe(true);
  });

  it("treats Unicode-equivalent spellings of a password as the same", async () => {
    const hash = await hashPassword("café", FAST); // é as one code point
    expect(await verifyPassword("café", hash)).toBe(true); // e + combining accent
  });

  it("rejects malformed or tampered hashes instead of throwing", async () => {
    const hash = await hashPassword("pw", FAST);
    const parts = hash.split("$");
    const flipped = parts.slice(0, 5).concat(parts[5]!.replace(/^./, (c) => (c === "A" ? "B" : "A")));
    expect(await verifyPassword("pw", flipped.join("$"))).toBe(false);
    expect(await verifyPassword("pw", "")).toBe(false);
    expect(await verifyPassword("pw", "pw")).toBe(false);
    expect(await verifyPassword("pw", "bcrypt$10$abc$def$ghi$jkl")).toBe(false);
    expect(await verifyPassword("pw", parts.slice(0, 5).concat("short").join("$"))).toBe(false);
  });
});
