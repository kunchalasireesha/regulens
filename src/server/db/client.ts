import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

/** Exported for integration tests, which connect to a separate test database. */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10 });
  return drizzle(sql, { schema });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { regulensDb?: Database };

export function getDb(): Database {
  globalForDb.regulensDb ??= createDatabase(getEnv().databaseUrl);
  return globalForDb.regulensDb;
}
