import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import {
  createSession,
  deleteSession,
  findSessionUser,
  verifyCredentials,
} from "@/server/auth/sessions";
import type { Database } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";
import { OTHER_USER, connectTestDb, resetDatabase } from "./test-db";

let db: Database;

const demoUser = {
  userId: DEMO_ANALYST.id,
  organizationId: DEMO_ORGANIZATION.id,
  name: DEMO_ANALYST.name,
  email: DEMO_ANALYST.email,
};

beforeAll(() => {
  db = connectTestDb();
});

afterAll(async () => {
  await db.$client.end();
});

beforeEach(async () => {
  await resetDatabase(db);
  const passwordHash = await hashPassword("demo-password", { N: 1024, r: 8, p: 1 });
  await db.update(users).set({ passwordHash }).where(eq(users.id, DEMO_ANALYST.id));
});

describe("verifyCredentials", () => {
  it("returns the user for the right email and password", async () => {
    expect(await verifyCredentials(db, DEMO_ANALYST.email, "demo-password")).toEqual(demoUser);
  });

  it("ignores case and surrounding spaces in the email", async () => {
    expect(await verifyCredentials(db, "  Analyst@Example.COM ", "demo-password")).toEqual(demoUser);
  });

  it("returns null for a wrong password, an unknown email, or a user without a password", async () => {
    expect(await verifyCredentials(db, DEMO_ANALYST.email, "Demo-password")).toBeNull();
    expect(await verifyCredentials(db, "nobody@example.com", "demo-password")).toBeNull();
    // OTHER_USER exists but was never given a password.
    expect(await verifyCredentials(db, OTHER_USER.email, "")).toBeNull();
  });
});

describe("sessions", () => {
  it("resolves a new session's token to its user and organization", async () => {
    const { token, expiresAt } = await createSession(db, DEMO_ANALYST.id);
    expect(await findSessionUser(db, token)).toEqual(demoUser);
    const hoursLeft = (expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(11.9);
    expect(hoursLeft).toBeLessThanOrEqual(12);
  });

  it("stores only a hash of the token", async () => {
    const { token } = await createSession(db, DEMO_ANALYST.id);
    const rows = await db.select({ tokenHash: sessions.tokenHash }).from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.tokenHash).not.toContain(token);
  });

  it("rejects unknown, expired, and signed-out tokens", async () => {
    expect(await findSessionUser(db, "not-a-real-token")).toBeNull();

    const expired = await createSession(db, DEMO_ANALYST.id);
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });
    expect(await findSessionUser(db, expired.token)).toBeNull();

    const signedOut = await createSession(db, DEMO_ANALYST.id);
    expect(await findSessionUser(db, signedOut.token)).toEqual(demoUser);
    await deleteSession(db, signedOut.token);
    expect(await findSessionUser(db, signedOut.token)).toBeNull();
  });

  it("keeps sessions independent, so signing out on one device leaves the others", async () => {
    const laptop = await createSession(db, DEMO_ANALYST.id);
    const desktop = await createSession(db, DEMO_ANALYST.id);
    expect(laptop.token).not.toBe(desktop.token);
    await deleteSession(db, laptop.token);
    expect(await findSessionUser(db, desktop.token)).toEqual(demoUser);
  });

  it("drops the user's expired sessions when a new one starts", async () => {
    await createSession(db, DEMO_ANALYST.id);
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });
    await createSession(db, DEMO_ANALYST.id);
    const rows = await db.select({ expiresAt: sessions.expiresAt }).from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
