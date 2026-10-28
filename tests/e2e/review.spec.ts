import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { fieldCard, resetDocuments, uploadAndOpen } from "./helpers";

test.beforeEach(resetDocuments);

test("an analyst reviews every field, approves, and downloads the JSON export", async ({ page }) => {
  // Harborline has no validation issues, so accepting each field is enough to approve.
  await uploadAndOpen(page, "harborline-payments.pdf");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeDisabled();
  await expect(page.getByText("Before approval: 22 fields to review.")).toBeVisible();

  const cards = page.locator("li[data-field]");
  await expect(cards).toHaveCount(22);
  for (const card of await cards.all()) {
    await card.locator("button[aria-expanded]").click();
    // A field the document does not state is confirmed as absent rather than accepted.
    await card.getByRole("button", { name: /^(Accept|Confirm not stated)$/ }).click();
    await expect(card.getByText("Accepted", { exact: true })).toBeVisible();
  }

  await expect(page.getByText("Every field is reviewed and no blocking issue is open.")).toBeVisible();
  await approve.click();
  await expect(page.getByText(/^Approved by Demo Analyst/)).toBeVisible();
  // Approved documents are read-only.
  await expect(page.getByRole("button", { name: "Correct" })).toHaveCount(0);

  const history = reviewHistory(page);
  await expect(history).toContainText("Demo Analyst approved the document");
  await expect(history).toContainText("accepted legal name");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("harborline-payments.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported.review.status).toBe("approved");
  expect(exported.record.business.legalName).toMatchObject({
    value: "Harborline Payments, Inc.",
    source: "extracted",
  });
  expect(exported.record.business.legalName.evidence.length).toBeGreaterThan(0);
  expect(exported.record.people).toHaveLength(3);
  expect(exported.record.people[1].ownershipPercentage).toMatchObject({ value: null, source: "missing" });

  await page.getByRole("link", { name: "← All documents" }).click();
  await page.getByRole("link", { name: /^Approved/ }).click();
  await expect(page.getByRole("link", { name: "harborline-payments.pdf" })).toBeVisible();
});

test("a correction closes the issues it fixes, and a rejected document cannot be exported", async ({ page }) => {
  // Cobalt Peak is seeded with problems: 150% ownership (also making the total 170%), an
  // invalid state code, and an expiration date before the application date.
  await uploadAndOpen(page, "cobalt-peak-remit.pdf");
  await expect(page.getByText("Issues (5 open of 5)")).toBeVisible();
  await expect(page.getByText(/4 open issues \(4 critical\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();

  const ownership = fieldCard(page, "people[0].ownershipPercentage");
  await ownership.locator("button[aria-expanded]").click();
  await expect(ownership).toContainText("Control person 1 ownership percentage is 150%, outside 0–100%.");
  await ownership.getByRole("button", { name: "Correct" }).click();
  await ownership.getByLabel("Correct value").fill("15");
  await ownership.getByLabel("Reason (optional)").fill("Typo on the form; the cap table shows 15%");
  await ownership.getByRole("button", { name: "Save correction" }).click();

  await expect(ownership.getByText("Corrected", { exact: true })).toBeVisible();
  await expect(ownership).toContainText("15%");
  // Both ownership issues are gone: 15% is in range and the total is now 35%.
  await expect(page.getByText("Issues (3 open of 5)")).toBeVisible();
  await expect(page.getByText(/2 open issues \(2 critical\)/)).toBeVisible();

  await page.getByRole("button", { name: "Reject…" }).click();
  await page.getByLabel("Reason for rejecting (required)").fill("Principal address has an invalid state code");
  await page.getByRole("button", { name: "Reject document" }).click();
  await expect(page.getByText(/^Rejected by Demo Analyst/)).toBeVisible();

  const history = reviewHistory(page);
  await expect(history).toContainText("corrected control person 1 ownership percentage: 150% → 15%");
  await expect(history).toContainText("Typo on the form; the cap table shows 15%");
  await expect(history).toContainText("rejected the document — “Principal address has an invalid state code”");

  // The export route refuses anything that is not approved, even when called directly.
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(`/documents/${documentId}/export`);
  expect(response.status()).toBe(409);
});

function reviewHistory(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Review history" }) });
}
