import "server-only";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { DEMO_ANALYST } from "@/server/db/seed-data";

export type Actor = { userId: string; organizationId: string };

/**
 * The user performing the current request. Until authentication exists (Phase 8)
 * this is always the seeded demo analyst; callers already pass the result through
 * to every org-scoped query, so swapping in a session lookup changes only this file.
 */
export async function getCurrentActor(db: Database): Promise<Actor> {
  const [user] = await db
    .select({ id: users.id, organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, DEMO_ANALYST.id))
    .limit(1);
  if (!user) {
    throw new Error("Demo user not found. Run `pnpm db:seed` after `pnpm db:migrate`.");
  }
  return { userId: user.id, organizationId: user.organizationId };
}
