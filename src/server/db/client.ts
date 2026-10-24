import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

function createDatabase() {
  const sql = postgres(getEnv().databaseUrl, { max: 10 });
  return drizzle(sql, { schema });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { regulensDb?: Database };

export function getDb(): Database {
  globalForDb.regulensDb ??= createDatabase();
  return globalForDb.regulensDb;
}
