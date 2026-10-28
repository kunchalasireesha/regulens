import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "@/server/db/client";
import { organizations, users } from "@/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "@/server/db/seed-data";

// Integration tests use their own database so they can truncate tables freely
// without touching development data.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://regulens:regulens@localhost:5432/regulens_test";

export function assertTestDatabase(url: string): string {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${name}": name must end in _test`);
  }
  return name;
}

export function connectTestDb(): Database {
  assertTestDatabase(TEST_DATABASE_URL);
  return createDatabase(TEST_DATABASE_URL, { max: 5 });
}

export const OTHER_ORGANIZATION = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Other Organization",
} as const;

export const OTHER_USER = {
  id: "00000000-0000-4000-8000-000000000102",
  organizationId: OTHER_ORGANIZATION.id,
  email: "other@example.com",
  name: "Other Analyst",
} as const;

/** Empties every table, then inserts the demo organization and a second tenant. */
export async function resetDatabase(db: Database): Promise<void> {
  // TRUNCATE does not fire the row-level append-only trigger on review_events.
  await db.execute(sql`TRUNCATE organizations RESTART IDENTITY CASCADE`);
  await db.insert(organizations).values([DEMO_ORGANIZATION, OTHER_ORGANIZATION]);
  await db.insert(users).values([DEMO_ANALYST, OTHER_USER]);
}
