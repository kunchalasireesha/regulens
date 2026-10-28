import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "./password";

// Credential checks and database sessions. Nothing here touches cookies or Next.js, so
// it is tested directly against Postgres; current-actor.ts connects it to the request.

/** A signed-in user, as passed to every org-scoped query and review command. */
export type Actor = { userId: string; organizationId: string };

export type SessionUser = Actor & { name: string; email: string };

/**
 * Fixed lifetime with no sliding renewal: an analyst signs in once per working day.
 * Server Components cannot set cookies, so renewal would need an extra round trip.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * A hash of a random password, checked when the email is unknown so that an unknown
 * email takes as long to reject as a wrong password and response times do not reveal
 * which addresses have accounts.
 */
let decoyHash: Promise<string> | undefined;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The user for a correct email and password, or null. Never says which one was wrong. */
export async function verifyCredentials(
  db: Database,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const [user] = await db
    .select({
      userId: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  if (!user?.passwordHash) {
    decoyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(password, await decoyHash);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return { userId: user.userId, organizationId: user.organizationId, name: user.name, email: user.email };
}

/** Starts a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.transaction(async (tx) => {
    // Housekeeping: expired sessions are never valid, so drop this user's old ones.
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, sql`now()`)));
    await tx.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  });
  return { token, expiresAt };
}

/** The user a token belongs to, or null if it is unknown, expired, or signed out. */
export async function findSessionUser(db: Database, token: string): Promise<SessionUser | null> {
  const [user] = await db
    .select({
      userId: users.id,
      organizationId: users.organizationId,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // Expiry is checked against the database clock, like processing staleness.
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return user ?? null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/**
 * Tokens are 256 random bits, so a fast unsalted hash is enough: unlike passwords they
 * cannot be guessed, and the hash only stops a database reader from using them.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
