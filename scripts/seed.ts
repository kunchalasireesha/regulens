import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";
import { organizations, users } from "../src/server/db/schema";
import { DEMO_ANALYST, DEMO_ORGANIZATION } from "../src/server/db/seed-data";

// Usage: pnpm db:seed
// Creates the demo organization and analyst. Safe to run repeatedly.
// The analyst's password comes from DEMO_PASSWORD (default "regulens-demo"); an existing
// password is kept, so re-seeding never signs anyone out of a changed account.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DEFAULT_DEMO_PASSWORD = "regulens-demo";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const password = process.env.DEMO_PASSWORD?.trim() || DEFAULT_DEMO_PASSWORD;

  const sqlClient = postgres(url, { max: 1 });
  try {
    const db = drizzle(sqlClient);
    await db.insert(organizations).values(DEMO_ORGANIZATION).onConflictDoNothing();
    await db
      .insert(users)
      .values({ ...DEMO_ANALYST, passwordHash: await hashPassword(password) })
      .onConflictDoUpdate({
        target: users.id,
        // Users seeded before authentication existed have no password yet.
        set: { passwordHash: sql`coalesce(${users.passwordHash}, excluded.password_hash)` },
      });
    console.log(`seeded organization "${DEMO_ORGANIZATION.name}" and user ${DEMO_ANALYST.email}`);
    if (password === DEFAULT_DEMO_PASSWORD) {
      console.log(`sign in with ${DEMO_ANALYST.email} / ${DEFAULT_DEMO_PASSWORD} (local development only)`);
    }
  } finally {
    await sqlClient.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
