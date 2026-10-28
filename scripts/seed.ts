import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { organizations, users } from "../src/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "../src/server/db/seed-data";

// Usage: pnpm db:seed
// Creates the demo organization and analyst. Safe to run repeatedly.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });
  try {
    const db = drizzle(sql);
    await db.insert(organizations).values(DEMO_ORGANIZATION).onConflictDoNothing();
    await db.insert(users).values(DEMO_ANALYST).onConflictDoNothing();
    console.log(`seeded organization "${DEMO_ORGANIZATION.name}" and user ${DEMO_ANALYST.email}`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
