// Settings shared by the Playwright config, its global setup, and the specs. No app
// imports here: the config is loaded outside Next.js, where "server-only" modules throw.

/** Its own database, so E2E runs never touch development data or the integration tests. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://regulens:regulens@localhost:5432/regulens_e2e_test";

/** A port of its own, so a dev server on 3000 is never mistaken for the server under test. */
export const E2E_PORT = Number(process.env.E2E_PORT) || 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export const E2E_STORAGE_DIR = ".data/e2e-uploads";

/** The seeded analyst (DEMO_ANALYST) signs in with this password in every run. */
export const E2E_PASSWORD = "e2e-password-not-secret";

/** Where the signed-in browser state is saved by auth.setup.ts and reused by the specs. */
export const AUTH_STATE_FILE = "tests/e2e/.auth/analyst.json";

export function assertE2eDatabase(url: string): string {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run E2E tests against "${name}": name must end in _test`);
  }
  return name;
}
