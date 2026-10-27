import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/lib/schemas/extraction";
import { listFields } from "@/lib/schemas/field-paths";
import { verifyResultEvidence } from "@/server/evidence/verify";
import { deriveRecords } from "@/server/pipeline/derive-records";
import { validateExtraction } from "@/server/validation/validate";

const pages = [
  "Legal Name of Applicant: Harborline Payments, Inc.\nDate of Formation: March 3, 2021",
  "Application Date: September 14, 2026",
];

function result(overrides: Partial<ExtractionResult["business"]> = {}): ExtractionResult {
  const notFound = { status: "not_found" } as const;
  return {
    business: {
      legalName: {
        status: "found",
        value: "Harborline Payments, Inc.",
        evidence: [{ page: 1, quote: "Legal Name of Applicant: Harborline Payments, Inc." }],
      },
      dbaNames: notFound,
      formationJurisdiction: notFound,
      formationDate: {
        status: "found",
        value: "March 3, 2021",
        // Wrong page on purpose: verification finds it on page 1.
        evidence: [{ page: 2, quote: "Date of Formation: March 3, 2021" }],
      },
      registeredAddress: notFound,
      principalAddress: notFound,
      ...overrides,
    },
    licensing: {
      licenseType: notFound,
      licenseNumber: notFound,
      applicationDate: {
        status: "ambiguous",
        candidates: [
          { value: "September 14, 2026", evidence: [{ page: 2, quote: "Application Date: September 14, 2026" }] },
          { value: "September 15, 2026", evidence: [{ page: 2, quote: "September 15, 2026" }] },
        ],
      },
      expirationDate: notFound,
    },
    people: [],
  };
}

function derive(input: ExtractionResult) {
  const evidence = verifyResultEvidence(pages, input);
  return deriveRecords(input, evidence, validateExtraction(input, evidence));
}

const byPath = (records: ReturnType<typeof derive>) =>
  new Map(records.fields.map((field) => [field.fieldPath, field]));

describe("deriveRecords", () => {
  it("produces one field per path, in listFields order", () => {
    const input = result();
    expect(derive(input).fields.map((f) => f.fieldPath)).toEqual(listFields(input).map((f) => f.path));
  });

  it("keeps the extracted value as written and starts review from the normalized one", () => {
    const field = byPath(derive(result())).get("business.formationDate")!;
    expect(field).toMatchObject({
      extractionStatus: "found",
      extractedValue: "March 3, 2021",
      normalizedValue: "2021-03-03",
      currentValue: "2021-03-03",
      evidenceStatus: "page_corrected",
      validationStatus: "valid",
    });
    expect(field.evidence).toEqual([
      expect.objectContaining({ citedPage: 2, matchedPage: 1, verification: "page_corrected", candidateIndex: null }),
    ]);
  });

  it("falls back to the extracted value when there is no normalized form", () => {
    const field = byPath(derive(result())).get("business.legalName")!;
    expect(field).toMatchObject({
      extractedValue: "Harborline Payments, Inc.",
      normalizedValue: null,
      currentValue: "Harborline Payments, Inc.",
      evidenceStatus: "verified",
    });
  });

  it("stores ambiguous candidates in order, with no current value and evidence per candidate", () => {
    const field = byPath(derive(result())).get("licensing.applicationDate")!;
    expect(field).toMatchObject({
      extractionStatus: "ambiguous",
      extractedValue: ["September 14, 2026", "September 15, 2026"],
      currentValue: null,
      validationStatus: "warning",
    });
    expect(field.evidence.map((e) => e.candidateIndex)).toEqual([0, 1]);
  });

  it("represents a missing field as null values with no evidence, and passes issues through", () => {
    const records = derive(result());
    expect(byPath(records).get("business.formationJurisdiction")).toMatchObject({
      extractionStatus: "not_found",
      extractedValue: null,
      normalizedValue: null,
      currentValue: null,
      evidenceStatus: "none",
      validationStatus: "error",
      evidence: [],
    });
    expect(records.issues.map((i) => i.ruleId)).toContain("required.missing");
  });

  it("keeps an explicitly empty DBA list as a found value, distinct from not found", () => {
    const field = byPath(derive(result({ dbaNames: { status: "found", value: [], evidence: [] } }))).get(
      "business.dbaNames",
    )!;
    expect(field).toMatchObject({ extractionStatus: "found", extractedValue: [], currentValue: [] });
  });
});
