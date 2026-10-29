import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

/**
 * Exported for integration tests, which connect to a separate test database.
 *
 * Prepared statements are off everywhere, not only in production: a transaction-mode
 * pooler (Supabase's, for serverless) hands each transaction a different server
 * connection, where a statement prepared on another one does not exist. Running the
 * same setting locally means the tests exercise what the deployment does.
 */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, prepare: false });
  return drizzle(sql, { schema });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { regulensDb?: Database };

export function getDb(): Database {
  const env = getEnv();
  globalForDb.regulensDb ??= createDatabase(env.databaseUrl, { max: env.databasePoolMax });
  return globalForDb.regulensDb;
}
