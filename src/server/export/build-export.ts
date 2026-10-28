import type { IssueResolution, IssueSeverity } from "@/lib/domain/statuses";
import { sameJsonValue } from "@/lib/review/format-value";
import type { ReviewDocument } from "@/server/db/queries/review";

// Turns an approved document into the JSON a downstream system consumes. Pure.
//
// Every value says where it came from, so a consumer never mistakes a gap or an
// analyst's edit for something the document stated:
//   extracted  read from the document and accepted by the analyst; carries its evidence
//   corrected  entered by the analyst; carries what the model had extracted
//   missing    not stated in the document (null value)
// Issues are exported with their resolution, so a record approved with a known problem
// ("accepted_unresolved") says so.

export const EXPORT_FORMAT_VERSION = "2026-10-28.1";

export type ExportedField = {
  value: unknown;
  source: "extracted" | "corrected" | "missing";
  /** What the model returned, when it differs from the value (a correction, or an ISO-normalized date). */
  extractedValue?: unknown;
  /** Where an extracted value appears in the document. Only verified quotes are included. */
  evidence: { page: number; quote: string }[];
};

export type ApplicationExport = {
  formatVersion: string;
  document: { id: string; filename: string; pageCount: number | null };
  review: { status: "approved"; approvedBy: string | null; approvedAt: string | null };
  extraction: { runId: string; provider: string; model: string; promptVersion: string; schemaVersion: string } | null;
  record: {
    business: Record<string, ExportedField>;
    licensing: Record<string, ExportedField>;
    people: Record<string, ExportedField>[];
  };
  issues: {
    ruleId: string;
    severity: IssueSeverity;
    fieldPaths: string[];
    message: string;
    resolution: IssueResolution | "open";
    note: string | null;
  }[];
};

export function buildExport(review: ReviewDocument): ApplicationExport {
  const { document, extractionRun: run } = review;
  if (document.reviewStatus !== "approved") throw new Error("only approved documents can be exported");

  const record: ApplicationExport["record"] = { business: {}, licensing: {}, people: [] };
  for (const field of review.fields) {
    const exported = exportField(field);
    const person = /^people\[(\d+)\]\.(\w+)$/.exec(field.fieldPath);
    if (person) {
      const index = Number(person[1]);
      record.people[index] = { ...record.people[index], [person[2]!]: exported };
    } else {
      const [section, key] = field.fieldPath.split(".") as ["business" | "licensing", string];
      record[section][key] = exported;
    }
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    document: { id: document.id, filename: document.filename, pageCount: document.pageCount },
    review: {
      status: "approved",
      approvedBy: document.reviewedBy,
      approvedAt: document.reviewedAt?.toISOString() ?? null,
    },
    extraction: run && {
      runId: run.id,
      provider: run.provider,
      model: run.model,
      promptVersion: run.promptVersion,
      schemaVersion: run.schemaVersion,
    },
    record,
    issues: review.issues.map((issue) => ({
      ruleId: issue.ruleId,
      severity: issue.severity,
      fieldPaths: issue.fieldPaths,
      message: issue.message,
      resolution: issue.resolution ?? "open",
      note: issue.resolutionNote,
    })),
  };
}

function exportField(field: ReviewDocument["fields"][number]): ExportedField {
  const value = field.currentValue;
  const source = field.reviewStatus === "corrected" ? "corrected" : value === null ? "missing" : "extracted";
  const exported: ExportedField = {
    value,
    source,
    evidence:
      source === "extracted"
        ? field.evidence.flatMap((e) => (e.matchedPage === null ? [] : [{ page: e.matchedPage, quote: e.quote }]))
        : [],
  };
  if (field.extractedValue !== null && !sameJsonValue(field.extractedValue, value)) {
    exported.extractedValue = field.extractedValue;
  }
  return exported;
}
