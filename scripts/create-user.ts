import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { hashPassword } from "../src/server/auth/password";
import { users } from "../src/server/db/schema";
import { DEMO_ORGANIZATION } from "../src/server/db/seed-data";

// Usage: pnpm user:create <email> "<name>"
// Adds an analyst to the demo organization and prints a generated password once.
// There is no sign-up page: in a compliance tool, accounts are issued, not self-created.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = z
  .tuple([z.email(), z.string().trim().min(1)])
  .safeParse(process.argv.slice(2).filter((arg) => arg !== "--"));

async function main() {
  if (!args.success) {
    console.error('Usage: pnpm user:create <email> "<name>"');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const [rawEmail, name] = args.data;
  const email = rawEmail.trim().toLowerCase();
  const password = randomBytes(12).toString("base64url");

  const sql = postgres(url, { max: 1 });
  try {
    const [created] = await drizzle(sql)
      .insert(users)
      .values({
        organizationId: DEMO_ORGANIZATION.id,
        email,
        name,
        passwordHash: await hashPassword(password),
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (!created) {
      console.error(`A user with email ${email} already exists.`);
      process.exitCode = 1;
      return;
    }
    console.log(`created ${email} in "${DEMO_ORGANIZATION.name}"`);
    console.log(`password (shown once): ${password}`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
