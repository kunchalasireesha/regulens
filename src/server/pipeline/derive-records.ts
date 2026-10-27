import type { EvidenceStatus, ExtractionStatus, ValidationStatus } from "@/lib/domain/statuses";
import type { ExtractionResult, FieldValue } from "@/lib/schemas/extraction";
import { listFields } from "@/lib/schemas/field-paths";
import type { EvidenceCheck, FieldEvidenceResult } from "@/server/evidence/verify";
import type { ValidationIssue, ValidationReport } from "@/server/validation/validate";

// Turns a validated extraction, its evidence checks, and its validation report into the
// rows an analyst reviews: one field per path with its evidence, plus the document's
// issues. Pure, so a stored run can be re-derived later without calling the model.

export type DerivedField = {
  fieldPath: string;
  extractionStatus: ExtractionStatus;
  /**
   * What the model returned: the value of a found field, the candidate values of an
   * ambiguous one (in candidate order), null when not found.
   */
  extractedValue: unknown;
  normalizedValue: unknown;
  /**
   * The value review starts from: normalized when available, else as extracted. Null for
   * ambiguous and not_found fields, which have no value until an analyst supplies one.
   */
  currentValue: unknown;
  evidenceStatus: EvidenceStatus;
  validationStatus: ValidationStatus;
  evidence: EvidenceCheck[];
};

export type DerivedRecords = {
  fields: DerivedField[];
  issues: ValidationIssue[];
};

export function deriveRecords(
  result: ExtractionResult,
  evidence: ReadonlyMap<string, FieldEvidenceResult>,
  report: ValidationReport,
): DerivedRecords {
  const fields = listFields(result).map(({ path, field }): DerivedField => {
    const checks = evidence.get(path);
    const validation = report.fields.get(path);
    if (!checks || !validation) throw new Error(`no evidence or validation for ${path}`);
    const extractedValue = extractedValueOf(field);
    return {
      fieldPath: path,
      extractionStatus: field.status,
      extractedValue,
      normalizedValue: validation.normalizedValue,
      currentValue: field.status === "found" ? (validation.normalizedValue ?? extractedValue) : null,
      evidenceStatus: checks.evidenceStatus,
      validationStatus: validation.validationStatus,
      evidence: checks.checks,
    };
  });

  return { fields, issues: report.issues };
}

function extractedValueOf(field: FieldValue<unknown>): unknown {
  switch (field.status) {
    case "found":
      return field.value;
    case "ambiguous":
      return field.candidates.map((candidate) => candidate.value);
    case "not_found":
      return null;
  }
}
