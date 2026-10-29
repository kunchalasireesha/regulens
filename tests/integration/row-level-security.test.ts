import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/client";
import { connectTestDb, resetDatabase } from "./test-db";

// Supabase exposes the public schema through its Data API as the `anon` and
// `authenticated` roles. RLS without policies must leave those roles nothing to read.

let db: Database;

// Stands in for Supabase's `anon`: a role that can SELECT but does not own the tables.
const PROBE_ROLE = "regulens_rls_probe";

beforeAll(async () => {
  db = connectTestDb();
  await resetDatabase(db);
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
        CREATE ROLE ${PROBE_ROLE} NOLOGIN;
      END IF;
    END $$`));
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`));
  await db.execute(sql.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`));
});

afterAll(async () => {
  await db.$client.end();
});

describe("row-level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const tables = await db.execute<{ table: string; rls: boolean }>(sql`
      SELECT c.relname AS table, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`);

    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((t) => !t.rls).map((t) => t.table)).toEqual([]);
  });

  it("hides every row from a role that does not own the tables", async () => {
    const asProbe = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${PROBE_ROLE}`));
      return tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM users`);
    });
    const asOwner = await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM users`);

    expect(asProbe[0]?.count).toBe(0);
    expect(asOwner[0]?.count).toBeGreaterThan(0);
  });
});
