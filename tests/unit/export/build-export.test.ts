import { describe, expect, it } from "vitest";
import type { ReviewDocument, ReviewField, ReviewIssue } from "@/server/db/queries/review";
import { EXPORT_FORMAT_VERSION, buildExport } from "@/server/export/build-export";

type FieldOverrides = Partial<ReviewField> & Pick<ReviewField, "fieldPath">;

function field(overrides: FieldOverrides): ReviewField {
  return {
    id: overrides.fieldPath,
    extractionRunId: "run-1",
    extractedValue: null,
    normalizedValue: null,
    currentValue: null,
    extractionStatus: "found",
    evidenceStatus: "verified",
    validationStatus: "valid",
    reviewStatus: "accepted",
    evidence: [],
    ...overrides,
  };
}

function evidence(page: number | null, quote: string): ReviewField["evidence"][number] {
  return {
    id: quote,
    fieldId: "f",
    candidateIndex: null,
    citedPage: 1,
    quote,
    verification: page === null ? "not_found" : "verified",
    matchedPage: page,
    matchStart: page === null ? null : 0,
    matchEnd: page === null ? null : quote.length,
  };
}

function review(fields: ReviewField[], issues: Partial<ReviewIssue>[] = []): ReviewDocument {
  return {
    document: {
      id: "doc-1",
      filename: "harborline.pdf",
      sizeBytes: 1000,
      pageCount: 3,
      processingStatus: "ready_for_review",
      reviewStatus: "approved",
      failureCode: null,
      createdAt: new Date("2026-10-28T10:00:00Z"),
      processingStale: false,
      reviewedAt: new Date("2026-10-28T11:00:00Z"),
      reviewedBy: "Demo Analyst",
    },
    pages: [],
    fields,
    issues: issues.map((issue, i) => ({
      id: `issue-${i}`,
      ruleId: "rule",
      severity: "warning",
      fieldPaths: [],
      message: "message",
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      ...issue,
    })),
    events: [],
    extractionRun: {
      id: "run-1",
      provider: "mock",
      model: "mock-form-mtl-1",
      promptVersion: "p1",
      schemaVersion: "s1",
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
      createdAt: new Date("2026-10-28T10:00:01Z"),
    },
  };
}

describe("buildExport", () => {
  it("labels each value as extracted, corrected, or missing", () => {
    const output = buildExport(
      review([
        field({
          fieldPath: "business.legalName",
          extractedValue: "Harborline Payments, Inc.",
          currentValue: "Harborline Payments, Inc.",
          evidence: [evidence(1, "Legal name: Harborline Payments, Inc."), evidence(null, "invented quote")],
        }),
        field({
          fieldPath: "business.formationDate",
          extractedValue: "March 3, 2021",
          currentValue: "2021-03-03",
          evidence: [evidence(2, "Date of formation: March 3, 2021")],
        }),
        field({
          fieldPath: "licensing.licenseNumber",
          extractionStatus: "not_found",
        }),
        field({
          fieldPath: "people[1].ownershipPercentage",
          extractedValue: 150,
          currentValue: 15,
          reviewStatus: "corrected",
          evidence: [evidence(3, "Ownership: 150%")],
        }),
        field({ fieldPath: "people[0].name", extractedValue: "Dana Okafor", currentValue: "Dana Okafor" }),
      ]),
    );

    expect(output.record.business.legalName).toEqual({
      value: "Harborline Payments, Inc.",
      source: "extracted",
      // Only quotes found in the document are exported as evidence.
      evidence: [{ page: 1, quote: "Legal name: Harborline Payments, Inc." }],
    });
    expect(output.record.business.formationDate).toEqual({
      value: "2021-03-03",
      source: "extracted",
      extractedValue: "March 3, 2021",
      evidence: [{ page: 2, quote: "Date of formation: March 3, 2021" }],
    });
    expect(output.record.licensing.licenseNumber).toEqual({ value: null, source: "missing", evidence: [] });
    expect(output.record.people[1]!.ownershipPercentage).toEqual({
      value: 15,
      source: "corrected",
      extractedValue: 150,
      evidence: [],
    });
    expect(output.record.people[0]!.name).toMatchObject({ value: "Dana Okafor", source: "extracted" });
  });

  it("includes the document, reviewer, extraction run, and every issue with its resolution", () => {
    const output = buildExport(
      review(
        [],
        [
          { ruleId: "license.number_not_assigned", severity: "info" },
          { ruleId: "jurisdiction.registered_office_mismatch", resolution: "accepted_unresolved", resolutionNote: "Known" },
        ],
      ),
    );
    expect(output).toMatchObject({
      formatVersion: EXPORT_FORMAT_VERSION,
      document: { id: "doc-1", filename: "harborline.pdf", pageCount: 3 },
      review: { status: "approved", approvedBy: "Demo Analyst", approvedAt: "2026-10-28T11:00:00.000Z" },
      extraction: { runId: "run-1", provider: "mock", promptVersion: "p1", schemaVersion: "s1" },
    });
    expect(output.issues.map((issue) => [issue.ruleId, issue.resolution, issue.note])).toEqual([
      ["license.number_not_assigned", "open", null],
      ["jurisdiction.registered_office_mismatch", "accepted_unresolved", "Known"],
    ]);
  });

  it("refuses a document that is not approved", () => {
    const pending = review([]);
    pending.document.reviewStatus = "in_review";
    expect(() => buildExport(pending)).toThrow(/approved/);
  });
});
