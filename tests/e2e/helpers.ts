import path from "node:path";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "./e2e-env";

/**
 * Deletes every document and everything hanging off it, keeping the organization, the
 * analyst, and their sessions. Uploads are deduplicated by content hash, so without this
 * a spec could not upload a sample another spec already used.
 */
export async function resetDocuments(): Promise<void> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // TRUNCATE does not fire the row-level append-only trigger on review_events.
    await sql`TRUNCATE documents RESTART IDENTITY CASCADE`;
  } finally {
    await sql.end();
  }
}

/** Uploads a PDF from samples/ through the dashboard form and waits for the confirmation. */
export async function uploadSample(page: Page, filename: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Licensing application/).setInputFiles(path.join("samples", filename));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(`Uploaded “${filename}”`)).toBeVisible();
}

/** The dashboard row of a document, in whichever queue tab is showing. */
export function documentRow(page: Page, filename: string) {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name: filename }) });
}

/** Uploads a sample, waits until extraction has finished, and opens its review page. */
export async function uploadAndOpen(page: Page, filename: string): Promise<void> {
  await uploadSample(page, filename);
  // Mock extraction runs after the response; the dashboard polls until it is done.
  await expect(documentRow(page, filename).getByText("Ready for review")).toBeVisible();
  await page.getByRole("link", { name: filename }).click();
  await expect(page.getByRole("heading", { level: 1, name: filename })).toBeVisible();
}

/** A field's card on the review page, e.g. fieldCard(page, "business.legalName"). */
export function fieldCard(page: Page, fieldPath: string) {
  return page.locator(`li[data-field="${fieldPath}"]`);
}
