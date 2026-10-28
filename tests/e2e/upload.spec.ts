import { expect, test } from "@playwright/test";
import { documentRow, fieldCard, resetDocuments, uploadAndOpen, uploadSample } from "./helpers";

test.beforeEach(resetDocuments);

test("an uploaded application is extracted and lands in the review queue", async ({ page }) => {
  await uploadSample(page, "harborline-payments.pdf");

  const row = documentRow(page, "harborline-payments.pdf");
  await expect(row.getByText("Ready for review")).toBeVisible();
  await expect(row).toContainText("0 / 22");
  await expect(row).toContainText("4 pages");
  await expect(page.getByRole("link", { name: /^Needs review\s*1$/ })).toBeVisible();
});

test("uploading the same file twice does not create a second document", async ({ page }) => {
  await uploadSample(page, "harborline-payments.pdf");

  await page.getByLabel(/Licensing application/).setInputFiles("samples/harborline-payments.pdf");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("This file was already uploaded as “harborline-payments.pdf”")).toBeVisible();

  await page.getByRole("link", { name: /^All/ }).click();
  await expect(page.getByRole("link", { name: /^All\s*1$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "harborline-payments.pdf" })).toHaveCount(1);
});

test("a scanned PDF without a text layer is reported and filed under Failed", async ({ page }) => {
  await uploadSample(page, "scanned-no-text-layer.pdf");
  await expect(page.getByText("but no text could be read from it")).toBeVisible();

  await page.getByRole("link", { name: /^Failed/ }).click();
  await expect(page).toHaveURL("/?queue=failed");
  await expect(documentRow(page, "scanned-no-text-layer.pdf").getByText("Failed", { exact: true })).toBeVisible();
});

test("the review page shows each field with its evidence highlighted in the document", async ({ page }) => {
  await uploadAndOpen(page, "harborline-payments.pdf");

  const legalName = fieldCard(page, "business.legalName");
  await expect(legalName).toContainText("Harborline Payments, Inc.");
  await expect(legalName.getByText("Verified")).toBeVisible();

  await legalName.locator("button[aria-expanded]").click();
  await expect(legalName.locator("button[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
  await expect(legalName).toContainText("Found on page 1");
  // The quote is highlighted in the document pane and tagged with the field that cited it.
  await expect(page.locator('mark[data-fields~="business.legalName"]').first()).toBeVisible();
});
