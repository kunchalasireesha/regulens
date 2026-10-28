import { expect, test as setup } from "@playwright/test";
import { DEMO_ANALYST } from "../../src/server/db/seed-data";
import { AUTH_STATE_FILE, E2E_PASSWORD } from "./e2e-env";

// Signs in once through the real login form and saves the session cookie, so the specs
// start signed in instead of repeating the login in every test.

setup("sign in as the demo analyst", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_ANALYST.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(DEMO_ANALYST.name)).toBeVisible();
  await page.context().storageState({ path: AUTH_STATE_FILE });
});
