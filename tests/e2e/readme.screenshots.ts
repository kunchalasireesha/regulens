import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentRow, fieldCard, resetDocuments, uploadAndOpen, uploadSample } from "./helpers";

// Regenerates the README screenshots in docs/screenshots: `pnpm screenshots`.
// Not part of `pnpm test:e2e`; it runs against the same production build and mock
// extraction, so the pictures show exactly what the tests check.

const OUT = "docs/screenshots";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });

test("README screenshots", async ({ page }) => {
  await resetDocuments();

  // Every sample, so each dashboard queue has something in it.
  for (const name of ["prairie-wire.pdf", "lumen-ledger.pdf", "scanned-no-text-layer.pdf"]) {
    await uploadSample(page, name);
  }
  await uploadAndOpen(page, "harborline-payments.pdf");
  for (const card of await page.locator("li[data-field]").all()) {
    await card.locator("button[aria-expanded]").click();
    await card.getByRole("button", { name: /^(Accept|Confirm not stated)$/ }).click();
    await expect(card.getByText("Accepted", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/^Approved by Demo Analyst/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "approved");

  // Cobalt Peak has deliberate problems: 150% ownership raises two critical issues.
  await uploadAndOpen(page, "cobalt-peak-remit.pdf");
  const ownership = fieldCard(page, "people[0].ownershipPercentage");
  await ownership.locator("button[aria-expanded]").click();
  await expect(ownership).toContainText("outside 0–100%");
  await shot(page, "review", ownership);

  await page.goto("/");
  await expect(documentRow(page, "cobalt-peak-remit.pdf")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Needs review\s*3$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Failed\s*1$/ })).toBeVisible();
  await shot(page, "dashboard");
});

/** A viewport-sized screenshot, scrolled so `target` (if given) is in view. */
async function shot(page: Page, name: string, target?: Locator) {
  if (target) await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
