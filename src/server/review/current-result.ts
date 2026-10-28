import type { ExtractionStatus, FieldReviewStatus } from "@/lib/domain/statuses";
import { extractionResultSchema, type ExtractionResult, type FieldValue } from "@/lib/schemas/extraction";

// Rebuilds an ExtractionResult from the stored field rows, using the values the analyst
// currently stands behind, so the validation rules can be re-run after a correction
// exactly as they ran on the model's output. Pure.

export type StoredField = {
  fieldPath: string;
  extractionStatus: ExtractionStatus;
  extractedValue: unknown;
  currentValue: unknown;
  reviewStatus: FieldReviewStatus;
};

/**
 * A field with a current value is `found`. A field without one is `not_found`, except an
 * ambiguous field that still has no value: it stays ambiguous with its original
 * candidates until the analyst picks one or corrects it to "not stated". Evidence is left
 * empty; callers that need the evidence roll-up pass it to validation separately.
 */
export function currentResult(fields: readonly StoredField[]): ExtractionResult {
  const root: Record<string, unknown> = { business: {}, licensing: {}, people: [] };
  for (const field of fields) {
    const person = /^people\[(\d+)\]\.(\w+)$/.exec(field.fieldPath);
    const value = currentFieldValue(field);
    if (person) {
      const people = root.people as Record<string, unknown>[];
      const index = Number(person[1]);
      people[index] = { ...people[index], [person[2]!]: value };
    } else {
      const [section, key] = field.fieldPath.split(".") as [string, string];
      (root[section] as Record<string, unknown>)[key] = value;
    }
  }
  // Rows come from the database: parse instead of trusting that every field is present.
  return extractionResultSchema.parse(root);
}

function currentFieldValue(field: StoredField): FieldValue<unknown> {
  if (field.currentValue !== null) return { status: "found", value: field.currentValue, evidence: [] };
  const undecided = field.extractionStatus === "ambiguous" && field.reviewStatus !== "corrected";
  if (undecided && Array.isArray(field.extractedValue)) {
    return {
      status: "ambiguous",
      candidates: field.extractedValue.map((value: unknown) => ({ value, evidence: [] })),
    };
  }
  return { status: "not_found" };
}
