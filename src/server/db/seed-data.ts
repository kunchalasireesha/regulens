// The demo organization and its analyst, created by `pnpm db:seed` (which also sets the
// analyst's password). Fixed IDs make seeding idempotent.
// No "server-only" import: the seed script runs outside Next.js.

export const DEMO_ORGANIZATION = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Demo Compliance Team",
} as const;

export const DEMO_ANALYST = {
  id: "00000000-0000-4000-8000-000000000101",
  organizationId: DEMO_ORGANIZATION.id,
  email: "analyst@example.com",
  name: "Demo Analyst",
  role: "analyst",
} as const;
