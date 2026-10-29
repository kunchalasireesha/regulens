import { defineConfig, devices } from "@playwright/test";
import { AUTH_STATE_FILE, E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT, E2E_STORAGE_DIR } from "./tests/e2e/e2e-env";

// End-to-end tests drive a production build (`next build` + `next start`) in Chromium,
// against a separate database with mock extraction: no API key, no network, the same
// result every run.
//
// The specs share one database and one server, and every spec starts by emptying the
// document tables, so they run one at a time.

const SCREENSHOTS = process.env.SCREENSHOTS === "1";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE_FILE },
    },
    // README screenshots (`pnpm screenshots`), left out of the test run.
    ...(SCREENSHOTS
      ? [
          {
            name: "screenshots",
            testMatch: /\.screenshots\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE_FILE },
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    // Never reuse a server someone else started: it could be connected to another database.
    reuseExistingServer: false,
    timeout: 180_000,
    // These override .env.local, which Next.js also loads.
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      AI_PROVIDER: "mock",
      STORAGE_DIR: E2E_STORAGE_DIR,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
