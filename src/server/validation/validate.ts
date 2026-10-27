import type { IssueSeverity, ValidationStatus } from "@/lib/domain/statuses";
import type { Address, ExtractionResult } from "@/lib/schemas/extraction";
import { listFields } from "@/lib/schemas/field-paths";
import { normalizeDate, normalizeStateCode } from "./normalize";
import { RULES, type RuleContext, type ValidationIssue } from "./rules";

export type { ValidationIssue } from "./rules";

export type FieldValidation = {
  /** Comparable form of a found value (ISO date, state code); null when none applies. */
  normalizedValue: unknown;
  validationStatus: ValidationStatus;
};

export type ValidationReport = {
  issues: ValidationIssue[];
  /** Keyed by field path, for every field in the result. */
  fields: Map<string, FieldValidation>;
};

/**
 * Normalizes values and applies every business rule. Pure: the same result and evidence
 * always produce the same report, so it can be re-run after an analyst correction or a
 * rule change without calling the model.
 */
export function validateExtraction(
  result: ExtractionResult,
  evidence?: RuleContext["evidence"],
): ValidationReport {
  const fields = listFields(result);
  const normalized = new Map(
    fields.map(({ path, field }) => [
      path,
      field.status === "found" ? normalizeValue(path, field.value) : null,
    ]),
  );

  const issues = RULES.flatMap((rule) => rule({ result, fields, normalized, evidence }));

  return {
    issues,
    fields: new Map(
      fields.map(({ path }) => [
        path,
        {
          normalizedValue: normalized.get(path) ?? null,
          validationStatus: statusFor(path, issues),
        },
      ]),
    ),
  };
}

const DATE_KEYS = new Set(["formationDate", "applicationDate", "expirationDate"]);
const ADDRESS_KEYS = new Set(["registeredAddress", "principalAddress"]);

/** Exported for tests. Returns null when the field has no normalized form or is not recognized. */
export function normalizeValue(path: string, value: unknown): unknown {
  const key = path.split(".").at(-1)!;
  if (DATE_KEYS.has(key) && typeof value === "string") return normalizeDate(value);
  if (key === "formationJurisdiction" && typeof value === "string") return normalizeStateCode(value);
  if (ADDRESS_KEYS.has(key)) {
    const address = value as Address;
    const state = normalizeStateCode(address.state);
    return state ? { ...address, state } : null;
  }
  return null;
}

const STATUS_BY_SEVERITY: Record<IssueSeverity, ValidationStatus> = {
  critical: "error",
  warning: "warning",
  info: "valid",
};
const RANK: Record<ValidationStatus, number> = { not_validated: 0, valid: 1, warning: 2, error: 3 };

/** A field takes the status of the most severe issue that names it. */
function statusFor(path: string, issues: ValidationIssue[]): ValidationStatus {
  return issues
    .filter((issue) => issue.fieldPaths.includes(path))
    .map((issue) => STATUS_BY_SEVERITY[issue.severity])
    .reduce<ValidationStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "valid");
}
