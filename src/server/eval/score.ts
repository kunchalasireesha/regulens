import type { EvidenceStatus } from "@/lib/domain/statuses";
import type { Address, ExtractionResult, FieldValue } from "@/lib/schemas/extraction";
import { fieldKind, listFields } from "@/lib/schemas/field-paths";
import { verifyResultEvidence } from "@/server/evidence/verify";
import { normalizeDate, normalizeStateCode } from "@/server/validation/normalize";
import { validateExtraction, type ValidationIssue } from "@/server/validation/validate";

// Scores an extraction against ground truth. Pure: no model, database, or file access,
// so the same function scores a live Gemini run, the mock, or (later) an analyst's
// corrections.
//
// Three questions, in order of how much they matter for compliance:
//   1. Is each value right? Fields are compared after the same normalization the app
//      applies (ISO dates, state codes), so "07/19/2019" and "2019-07-19" agree.
//   2. When a value is wrong, did the app flag it? An error with verified evidence and no
//      issue is the dangerous kind: nothing prompts the analyst to look.
//   3. Does validation report the same problems it would on the true values?

export type FieldOutcome =
  /** Expected a value and got the same value. */
  | "correct"
  /** The document has no value and the model said not_found. */
  | "correct_absent"
  | "wrong_value"
  /** Expected a value; the model said not_found or omitted the field (a missing person). */
  | "missed"
  /** The document has no value (or no such person) and the model returned one. */
  | "invented"
  /** The model returned candidates instead of a value; the analyst must choose. */
  | "ambiguous"
  /** Extraction failed, so there is no result to score. */
  | "no_result";

export const CORRECT_OUTCOMES: ReadonlySet<FieldOutcome> = new Set(["correct", "correct_absent"]);

export type FieldScore = {
  path: string;
  outcome: FieldOutcome;
  expected: FieldValue<unknown> | null;
  actual: FieldValue<unknown> | null;
  /** Null when the model returned no value to cite. */
  evidenceStatus: EvidenceStatus | null;
  /** Whether any validation issue (including evidence issues) names this field. */
  flagged: boolean;
};

export type IssueAgreement = {
  /** Issues validation raises on the ground truth, by key ("ruleId path,path"). */
  expected: string[];
  matched: string[];
  /** Raised on the truth but not on the extraction: a problem the analyst would not see. */
  missed: string[];
  /** Raised on the extraction but not on the truth: noise caused by extraction errors. */
  extra: string[];
};

export type DocumentScore = {
  fields: FieldScore[];
  issues: IssueAgreement;
};

/**
 * Scores one document. `actual` is null when extraction failed. People are matched by
 * position, since the prompt asks for document order and paths are positional.
 */
export function scoreDocument(
  pages: string[],
  expected: ExtractionResult,
  actual: ExtractionResult | null,
): DocumentScore {
  const expectedIssues = issueKeys(validateExtraction(expected).issues);
  const expectedFields = new Map(listFields(expected).map(({ path, field }) => [path, field]));

  if (!actual) {
    const fields = [...expectedFields].map(([path, field]): FieldScore => ({
      path,
      outcome: "no_result",
      expected: field,
      actual: null,
      evidenceStatus: null,
      flagged: false,
    }));
    return { fields, issues: { expected: expectedIssues, matched: [], missed: expectedIssues, extra: [] } };
  }

  const evidence = verifyResultEvidence(pages, actual);
  const report = validateExtraction(actual, evidence);
  const flaggedPaths = new Set(report.issues.flatMap((issue) => issue.fieldPaths));
  const actualFields = new Map(listFields(actual).map(({ path, field }) => [path, field]));

  // Expected paths first, then any extra people the model invented.
  const paths = [...new Set([...expectedFields.keys(), ...actualFields.keys()])];
  const fields = paths.map((path): FieldScore => {
    const want = expectedFields.get(path) ?? null;
    const got = actualFields.get(path) ?? null;
    return {
      path,
      outcome: compareField(path, want, got),
      expected: want,
      actual: got,
      evidenceStatus: got && got.status !== "not_found" ? evidence.get(path)!.evidenceStatus : null,
      flagged: flaggedPaths.has(path),
    };
  });

  // Evidence issues have no counterpart on the truth, which cites nothing.
  const actualIssues = issueKeys(report.issues.filter((issue) => !issue.ruleId.startsWith("evidence.")));
  return {
    fields,
    issues: {
      expected: expectedIssues,
      matched: expectedIssues.filter((key) => actualIssues.includes(key)),
      missed: expectedIssues.filter((key) => !actualIssues.includes(key)),
      extra: actualIssues.filter((key) => !expectedIssues.includes(key)),
    },
  };
}

/** Exported for tests. A missing field (no such person) counts as not_found. */
export function compareField(
  path: string,
  expected: FieldValue<unknown> | null,
  actual: FieldValue<unknown> | null,
): FieldOutcome {
  const wantValue = expected?.status === "found";
  if (actual?.status === "ambiguous") return "ambiguous";
  if (actual?.status !== "found") return wantValue ? "missed" : "correct_absent";
  if (!wantValue) return "invented";
  return sameValue(path, expected.value, actual.value) ? "correct" : "wrong_value";
}

/** Exported for tests. Compares values the way the app reads them, by field kind. */
export function sameValue(path: string, expected: unknown, actual: unknown): boolean {
  switch (fieldKind(path)) {
    case "date":
      return sameNormalized(normalizeDate, expected, actual);
    case "number":
      return typeof expected === "number" && expected === actual;
    case "address":
      return sameAddress(expected as Address, actual as Address);
    case "text_list":
      return sameList(expected, actual);
    case "text":
      return path.endsWith("formationJurisdiction")
        ? sameNormalized(normalizeStateCode, expected, actual)
        : sameText(expected, actual);
  }
}

/**
 * Equal after Unicode compatibility folding and whitespace collapsing. Case and
 * punctuation still count: "Harborline Payments Inc" is not the applicant's legal name.
 */
function sameText(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && canonical(a) === canonical(b);
}

function canonical(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Compares normalized forms when both normalize; otherwise falls back to the text. */
function sameNormalized(normalize: (input: string) => string | null, a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const [na, nb] = [normalize(a), normalize(b)];
  return na !== null && nb !== null ? na === nb : sameText(a, b);
}

function sameAddress(a: Address, b: Address): boolean {
  return (
    sameText(a.street, b.street) &&
    (a.unit === null ? b.unit === null : sameText(a.unit, b.unit)) &&
    sameText(a.city, b.city) &&
    sameNormalized(normalizeStateCode, a.state, b.state) &&
    sameText(a.postalCode, b.postalCode)
  );
}

/** Order-insensitive: DBA names have no meaningful order. */
function sameList(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sorted = (list: unknown[]) => list.map((item) => canonical(String(item))).sort();
  const [sa, sb] = [sorted(a), sorted(b)];
  return sa.every((item, i) => item === sb[i]);
}

/** Rule and fields identify an issue; messages are left out because they carry values. */
function issueKeys(issues: ValidationIssue[]): string[] {
  return [...new Set(issues.map((issue) => `${issue.ruleId} ${[...issue.fieldPaths].sort().join(",")}`))];
}

export type EvalSummary = {
  documents: number;
  fields: number;
  correct: number;
  /** correct / fields; ambiguous fields count against it. */
  accuracy: number;
  byOutcome: Record<FieldOutcome, number>;
  /** "people[].title" → accuracy across every person in every document. */
  byField: { key: string; fields: number; correct: number }[];
  /** Of fields the model gave a value, how many cite text found in the document. */
  evidence: { cited: number; located: number };
  /** Fields the model got wrong in any way, and how many of them a validation issue names. */
  errors: { total: number; flagged: number };
  issues: { expected: number; matched: number; missed: number; extra: number };
};

export function summarize(documents: DocumentScore[]): EvalSummary {
  const fields = documents.flatMap((doc) => doc.fields);
  const byOutcome = Object.fromEntries(
    (["correct", "correct_absent", "wrong_value", "missed", "invented", "ambiguous", "no_result"] as const).map(
      (outcome) => [outcome, fields.filter((f) => f.outcome === outcome).length],
    ),
  ) as Record<FieldOutcome, number>;
  const correct = fields.filter((f) => CORRECT_OUTCOMES.has(f.outcome)).length;

  const byKey = new Map<string, { fields: number; correct: number }>();
  for (const field of fields) {
    const key = field.path.replace(/^people\[\d+\]/, "people[]");
    const entry = byKey.get(key) ?? { fields: 0, correct: 0 };
    entry.fields += 1;
    if (CORRECT_OUTCOMES.has(field.outcome)) entry.correct += 1;
    byKey.set(key, entry);
  }

  const cited = fields.filter((f) => f.evidenceStatus !== null);
  const errors = fields.filter((f) => !CORRECT_OUTCOMES.has(f.outcome) && f.outcome !== "no_result");
  const count = (pick: (issues: IssueAgreement) => string[]) =>
    documents.reduce((sum, doc) => sum + pick(doc.issues).length, 0);

  return {
    documents: documents.length,
    fields: fields.length,
    correct,
    accuracy: fields.length === 0 ? 0 : correct / fields.length,
    byOutcome,
    byField: [...byKey].map(([key, entry]) => ({ key, ...entry })),
    evidence: {
      cited: cited.length,
      located: cited.filter((f) => f.evidenceStatus === "verified" || f.evidenceStatus === "page_corrected").length,
    },
    errors: { total: errors.length, flagged: errors.filter((f) => f.flagged).length },
    issues: {
      expected: count((i) => i.expected),
      matched: count((i) => i.matched),
      missed: count((i) => i.missed),
      extra: count((i) => i.extra),
    },
  };
}
