import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { TEST_DATABASE_URL, assertTestDatabase } from "./test-db";

// Creates the test database if needed and applies all migrations, once per run.
export default async function setup() {
  const name = assertTestDatabase(TEST_DATABASE_URL);

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!existing) await admin`CREATE DATABASE ${admin(name)}`;
  } catch (error) {
    throw new Error(
      `Could not reach Postgres for integration tests (is \`pnpm db:up\` running?): ${String(error)}`,
    );
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
