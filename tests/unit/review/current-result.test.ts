import { describe, expect, it } from "vitest";
import { listFields } from "@/lib/schemas/field-paths";
import { MockExtractionProvider } from "@/server/extraction/mock-provider";
import { runExtraction } from "@/server/extraction/run";
import { readPdfText } from "@/server/ingestion/pdf-text";
import { currentResult, type StoredField } from "@/server/review/current-result";
import { buildApplicationPdf } from "../../../scripts/samples/build";
import { harborline } from "../../../scripts/samples/fixtures";

async function extracted() {
  const parsed = await readPdfText(await buildApplicationPdf(harborline), { maxPages: 30 });
  if (!parsed.ok) throw new Error(parsed.code);
  const outcome = await runExtraction(new MockExtractionProvider(), parsed.pages);
  if (outcome.status !== "succeeded") throw new Error(outcome.status);
  return outcome.result;
}

/** Field rows as the pipeline stores them, before any review. */
function storedFields(result: Awaited<ReturnType<typeof extracted>>): StoredField[] {
  return listFields(result).map(({ path, field }) => ({
    fieldPath: path,
    extractionStatus: field.status,
    extractedValue: field.status === "found" ? field.value : null,
    currentValue: field.status === "found" ? field.value : null,
    reviewStatus: "pending",
  }));
}

describe("currentResult", () => {
  it("rebuilds the result from field rows, nesting people by index", async () => {
    const result = await extracted();
    const rebuilt = currentResult(storedFields(result));
    expect(listFields(rebuilt).map(({ path, field }) => [path, field.status])).toEqual(
      listFields(result).map(({ path, field }) => [path, field.status]),
    );
    expect(rebuilt.people).toHaveLength(result.people.length);
    expect(rebuilt.business.legalName).toEqual({ status: "found", value: harborline.business.legalName, evidence: [] });
  });

  it("uses the current value, so a correction is what the rules see", async () => {
    const fields = storedFields(await extracted()).map((field) =>
      field.fieldPath === "people[0].ownershipPercentage" ? { ...field, currentValue: 150, reviewStatus: "corrected" as const } : field,
    );
    expect(currentResult(fields).people[0]!.ownershipPercentage).toEqual({ status: "found", value: 150, evidence: [] });
  });

  it("keeps an undecided ambiguous field ambiguous, and a decided one as decided", async () => {
    const base = storedFields(await extracted());
    const ambiguous = (overrides: Partial<StoredField>) =>
      base.map((field) =>
        field.fieldPath === "licensing.licenseType"
          ? { ...field, extractionStatus: "ambiguous" as const, extractedValue: ["MTL", "Sales of checks"], currentValue: null, ...overrides }
          : field,
      );

    expect(currentResult(ambiguous({})).licensing.licenseType).toEqual({
      status: "ambiguous",
      candidates: [
        { value: "MTL", evidence: [] },
        { value: "Sales of checks", evidence: [] },
      ],
    });
    expect(currentResult(ambiguous({ reviewStatus: "corrected" })).licensing.licenseType).toEqual({ status: "not_found" });
    expect(currentResult(ambiguous({ reviewStatus: "corrected", currentValue: "MTL" })).licensing.licenseType).toEqual({
      status: "found",
      value: "MTL",
      evidence: [],
    });
  });

  it("refuses rows that do not form a complete result", async () => {
    const fields = storedFields(await extracted()).filter((field) => field.fieldPath !== "business.legalName");
    expect(() => currentResult(fields)).toThrow();
  });
});
