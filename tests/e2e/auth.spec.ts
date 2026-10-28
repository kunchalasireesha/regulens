import { expect, test } from "@playwright/test";
import { DEMO_ANALYST } from "../../src/server/db/seed-data";
import { E2E_PASSWORD } from "./e2e-env";

// These start signed out, so they sign in (and out) on their own session and leave the
// shared one from auth.setup.ts alone.
test.use({ storageState: { cookies: [], origins: [] } });

test("a signed-out visitor is sent to the login page and back after signing in", async ({ page }) => {
  await page.goto("/?queue=all");
  await expect(page).toHaveURL(/\/login\?next=%2F%3Fqueue%3Dall$/);

  await page.getByLabel("Email").fill(DEMO_ANALYST.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/?queue=all");
  await expect(page.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(DEMO_ANALYST.name)).toBeVisible();
});

test("a wrong password is refused without saying which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_ANALYST.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  // The email is kept so the analyst only retypes the password.
  await expect(page.getByLabel("Email")).toHaveValue(DEMO_ANALYST.email);
});

test("signing out ends the session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_ANALYST.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(DEMO_ANALYST.name)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");

  await page.goto("/");
  await expect(page).toHaveURL("/login");
});
