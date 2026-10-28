import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { hashPassword } from "../../src/server/auth/password";
import { organizations, users } from "../../src/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "../../src/server/db/seed-data";
import { E2E_DATABASE_URL, E2E_PASSWORD, E2E_STORAGE_DIR, assertE2eDatabase } from "./e2e-env";

// Runs once per test run, before any spec: creates the E2E database if needed, applies
// migrations, empties it, and seeds the demo analyst with a known password.

export default async function setup() {
  const name = assertE2eDatabase(E2E_DATABASE_URL);

  const adminUrl = new URL(E2E_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!existing) await admin`CREATE DATABASE ${admin(name)}`;
  } catch (error) {
    throw new Error(`Could not reach Postgres for E2E tests (is \`pnpm db:up\` running?): ${String(error)}`);
  } finally {
    await admin.end();
  }

  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    // TRUNCATE does not fire the row-level append-only trigger on review_events.
    await db.execute(sql`TRUNCATE organizations RESTART IDENTITY CASCADE`);
    await db.insert(organizations).values(DEMO_ORGANIZATION);
    await db.insert(users).values({ ...DEMO_ANALYST, passwordHash: await hashPassword(E2E_PASSWORD) });
  } finally {
    await client.end();
  }

  await rm(E2E_STORAGE_DIR, { recursive: true, force: true });
}
