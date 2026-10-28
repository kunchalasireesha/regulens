import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE } from "@/lib/auth/navigation";
import type { Database } from "@/server/db/client";
import { findSessionUser, type Actor, type SessionUser } from "./sessions";

export type { Actor, SessionUser } from "./sessions";

// The data access layer's entry point: every page, server action, and route handler that
// reads or changes tenant data resolves the actor here, from the session in the database.
// The proxy only checks that a cookie exists, so it is a convenience, not a security check.

/**
 * The signed-in user, or null. Memoized per render, so the header and the page share one
 * lookup; server actions and route handlers are not renders, so each call queries again.
 */
export const findCurrentUser = cache(async (db: Database): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return findSessionUser(db, token);
});

/**
 * The user performing the current request. Redirects to the login page when there is
 * no valid session; redirect() throws, so call this outside any try/catch.
 */
export async function getCurrentActor(db: Database): Promise<Actor> {
  const user = await findCurrentUser(db);
  if (!user) redirect("/login");
  return { userId: user.userId, organizationId: user.organizationId };
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from page scripts, so an XSS bug cannot steal it
    secure: process.env.NODE_ENV === "production", // local dev runs over plain http
    sameSite: "lax", // not sent on cross-site POSTs
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
