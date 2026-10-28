import type { EvidenceStatus, EvidenceVerification } from "@/lib/domain/statuses";
import type { Evidence, ExtractionResult, FieldValue } from "@/lib/schemas/extraction";
import { listFields } from "@/lib/schemas/field-paths";
import { normalizeForMatch, normalizedTextOf, type NormalizedText } from "./normalize-text";

// Evidence verification: is the text the model cited actually in the document?
//
// The model's citation is a claim, not a fact. Each quote is searched for on the cited
// page, then on every other page. This catches fabricated quotes and wrong page numbers.
// It cannot tell whether a real quote supports the value, so `valueSupported` separately
// checks that the value itself appears in the cited text.

export type EvidenceCheck = {
  /** For ambiguous fields: which candidate this evidence supports. */
  candidateIndex: number | null;
  citedPage: number;
  quote: string;
  verification: EvidenceVerification;
  /** Where the quote was found; null when it was not found. */
  matchedPage: number | null;
  /** Offsets into that page's original text (end exclusive). */
  matchStart: number | null;
  matchEnd: number | null;
};

export type FieldEvidenceResult = {
  evidenceStatus: EvidenceStatus;
  checks: EvidenceCheck[];
  /**
   * Whether the value appears in its own cited quotes (for ambiguous fields: every
   * candidate in its quotes). Null when there is nothing to check: no value, no evidence,
   * or a value with no text, such as an empty DBA list.
   */
  valueSupported: boolean | null;
};

/** Page text normalized once per document, so each quote lookup is a plain search. */
export type PageIndex = NormalizedText[];

export function indexPages(pages: string[]): PageIndex {
  return pages.map(normalizeForMatch);
}

/** Verifies the evidence of every field in a result, keyed by field path. */
export function verifyResultEvidence(
  pages: string[],
  result: ExtractionResult,
): Map<string, FieldEvidenceResult> {
  const index = indexPages(pages);
  return new Map(listFields(result).map(({ path, field }) => [path, verifyFieldEvidence(index, field)]));
}

export function verifyQuote(
  index: PageIndex,
  evidence: Evidence,
  candidateIndex: number | null = null,
): EvidenceCheck {
  const base = { candidateIndex, citedPage: evidence.page, quote: evidence.quote };
  const needle = normalizedTextOf(evidence.quote);
  if (needle !== "") {
    // Cited page first; an out-of-range citation just falls through to the others.
    const order = [evidence.page, ...index.map((_, i) => i + 1).filter((p) => p !== evidence.page)];
    for (const pageNumber of order) {
      const page = index[pageNumber - 1];
      const at = page?.text.indexOf(needle) ?? -1;
      if (!page || at === -1) continue;
      return {
        ...base,
        verification: pageNumber === evidence.page ? "verified" : "page_corrected",
        matchedPage: pageNumber,
        matchStart: page.starts[at]!,
        matchEnd: page.ends[at + needle.length - 1]!,
      };
    }
  }
  return { ...base, verification: "not_found", matchedPage: null, matchStart: null, matchEnd: null };
}

export function verifyFieldEvidence(index: PageIndex, field: FieldValue<unknown>): FieldEvidenceResult {
  if (field.status === "not_found") {
    return { evidenceStatus: "none", checks: [], valueSupported: null };
  }
  const claims =
    field.status === "found"
      ? [{ candidateIndex: null, value: field.value, evidence: field.evidence }]
      : field.candidates.map((candidate, i) => ({ candidateIndex: i, ...candidate }));

  const checks = claims.flatMap((claim) =>
    claim.evidence.map((evidence) => verifyQuote(index, evidence, claim.candidateIndex)),
  );
  const support = claims
    .map((claim) => valueAppearsIn(claim.value, claim.evidence.map((e) => e.quote)))
    .filter((supported) => supported !== null);

  return {
    evidenceStatus: rollUp(checks),
    checks,
    valueSupported: support.length === 0 ? null : support.every(Boolean),
  };
}

/** A field is only as trustworthy as its weakest citation. */
function rollUp(checks: EvidenceCheck[]): EvidenceStatus {
  if (checks.length === 0) return "none";
  if (checks.some((c) => c.verification === "not_found")) return "unverified";
  if (checks.some((c) => c.verification === "page_corrected")) return "page_corrected";
  return "verified";
}

/**
 * Whether every part of a value (each address component, each DBA name, the number)
 * appears in the quotes. Numbers are compared as numbers, so "62.50%" supports 62.5.
 */
export function valueAppearsIn(value: unknown, quotes: string[]): boolean | null {
  if (quotes.length === 0) return null;
  const parts = valueParts(value);
  if (parts.length === 0) return null;

  const haystack = normalizedTextOf(quotes.join("\n"));
  const numbers = new Set(
    [...haystack.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replaceAll(",", ""))),
  );
  return parts.every((part) =>
    typeof part === "number" ? numbers.has(part) : haystack.includes(normalizedTextOf(part)),
  );
}

function valueParts(value: unknown): (string | number)[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(valueParts);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(valueParts);
  return [];
}
