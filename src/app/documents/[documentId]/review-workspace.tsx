"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceStatus, FieldReviewStatus, IssueSeverity, ValidationStatus } from "@/lib/domain/statuses";
import { formatFieldValue, sameJsonValue } from "@/lib/review/format-value";
import { segmentText, type HighlightRange } from "@/lib/review/highlight";
import { fieldGroup, fieldLabel, fieldShortLabel } from "@/lib/schemas/field-paths";
import type { ReviewEvidence, ReviewField, ReviewIssue } from "@/server/db/queries/review";
import { FieldReviewControls, IssueResolution } from "./review-controls";

// Review screen: fields on the left, the document's text on the right, with every
// verified quote highlighted where it was found. Selecting a field shows its evidence,
// issues, and review actions, and scrolls the document to its first highlight; clicking a
// highlight selects the field that cited it. Once the document is approved or rejected,
// `editable` is false and the screen is read-only.

type Page = { pageNumber: number; text: string };

type Props = {
  documentId: string;
  editable: boolean;
  fields: ReviewField[];
  issues: ReviewIssue[];
  pages: Page[];
};

export function ReviewWorkspace({ documentId, editable, fields, issues, pages }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const documentPane = useRef<HTMLDivElement>(null);
  const fieldPane = useRef<HTMLDivElement>(null);

  const { rangesByPage, fieldByEvidence } = useMemo(() => indexEvidence(fields), [fields]);
  const issuesByField = useMemo(() => {
    const byField = new Map<string, ReviewIssue[]>();
    for (const issue of issues) {
      for (const path of issue.fieldPaths) byField.set(path, [...(byField.get(path) ?? []), issue]);
    }
    return byField;
  }, [issues]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, ReviewField[]>();
    for (const field of fields) {
      const { label } = fieldGroup(field.fieldPath);
      byGroup.set(label, [...(byGroup.get(label) ?? []), field]);
    }
    return byGroup;
  }, [fields]);

  function selectField(path: string) {
    setSelectedPath(path);
    // Scroll only inside the document pane (it is the offset parent of its marks), so
    // the field list the analyst is reading never jumps.
    const pane = documentPane.current;
    const mark = pane?.querySelector<HTMLElement>(`[data-fields~="${CSS.escape(path)}"]`);
    if (pane && mark) pane.scrollTo({ top: mark.offsetTop - pane.clientHeight / 3, behavior: "smooth" });
  }

  function selectFromHighlight(paths: string[]) {
    // Overlapping quotes: cycle through the fields that cite these words.
    const current = selectedPath ? paths.indexOf(selectedPath) : -1;
    setSelectedPath(paths[(current + 1) % paths.length]!);
  }

  // After the selected card has expanded, bring it into view in the field list (a no-op
  // when it already is, e.g. when the analyst clicked the card itself).
  useEffect(() => {
    if (!selectedPath) return;
    fieldPane.current
      ?.querySelector<HTMLElement>(`[data-field="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedPath]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div ref={fieldPane} className="flex flex-col gap-6 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-2">
        <IssueSummary documentId={documentId} editable={editable} issues={issues} onSelectField={selectField} />
        {[...groups].map(([label, groupFields]) => (
          <section key={label} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">{label}</h2>
            <ul className="flex flex-col gap-2">
              {groupFields.map((field) => (
                <FieldCard
                  key={field.id}
                  documentId={documentId}
                  editable={editable}
                  field={field}
                  issues={issuesByField.get(field.fieldPath) ?? []}
                  selected={field.fieldPath === selectedPath}
                  onSelect={() => selectField(field.fieldPath)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div
        ref={documentPane}
        className="relative flex flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto dark:border-zinc-800 dark:bg-zinc-950"
      >
        {pages.map((page) => (
          <section key={page.pageNumber} aria-label={`Page ${page.pageNumber}`}>
            <h3 className="mb-1 text-xs font-medium text-zinc-500">Page {page.pageNumber}</h3>
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {segmentText(page.text, rangesByPage.get(page.pageNumber) ?? []).map((segment) => {
                if (segment.ids.length === 0) return segment.text;
                const paths = [...new Set(segment.ids.map((id) => fieldByEvidence.get(id)!))];
                const active = selectedPath !== null && paths.includes(selectedPath);
                return (
                  <mark
                    key={segment.start}
                    data-fields={paths.join(" ")}
                    title={paths.map(fieldLabel).join(", ")}
                    onClick={() => selectFromHighlight(paths)}
                    className={`cursor-pointer rounded-sm text-inherit ${
                      active ? "bg-amber-300 dark:bg-amber-600" : "bg-amber-100 dark:bg-amber-950"
                    }`}
                  >
                    {segment.text}
                  </mark>
                );
              })}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Highlight ranges per page, and which field each evidence row belongs to. */
function indexEvidence(fields: ReviewField[]) {
  const rangesByPage = new Map<number, HighlightRange[]>();
  const fieldByEvidence = new Map<string, string>();
  for (const field of fields) {
    for (const evidence of field.evidence) {
      fieldByEvidence.set(evidence.id, field.fieldPath);
      // Unverified quotes have no location; they are listed on the field instead.
      if (evidence.matchedPage === null || evidence.matchStart === null || evidence.matchEnd === null) continue;
      const ranges = rangesByPage.get(evidence.matchedPage) ?? [];
      ranges.push({ id: evidence.id, start: evidence.matchStart, end: evidence.matchEnd });
      rangesByPage.set(evidence.matchedPage, ranges);
    }
  }
  return { rangesByPage, fieldByEvidence };
}

const SEVERITY_STYLES: Record<IssueSeverity, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  warning: { label: "Warning", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  info: { label: "Info", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

function IssueSummary({
  documentId,
  editable,
  issues,
  onSelectField,
}: {
  documentId: string;
  editable: boolean;
  issues: ReviewIssue[];
  onSelectField: (path: string) => void;
}) {
  if (issues.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">No validation issues.</p>;
  }
  const open = issues.filter((issue) => issue.resolution === null).length;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
        Issues ({open} open of {issues.length})
      </h2>
      <ul className="flex flex-col gap-2 text-sm">
        {issues.map((issue) => (
          <li
            key={issue.id}
            className={`flex flex-col gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800 ${
              issue.resolution ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              <Badge {...SEVERITY_STYLES[issue.severity]} />
              <span>{issue.message}</span>
            </div>
            {issue.fieldPaths.length > 0 && (
              <div className="flex flex-wrap gap-x-3 pl-1 text-xs">
                {issue.fieldPaths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => onSelectField(path)}
                    className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {fieldLabel(path)}
                  </button>
                ))}
              </div>
            )}
            <IssueResolution documentId={documentId} issue={issue} editable={editable} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const EVIDENCE_STYLES: Partial<Record<EvidenceStatus, { label: string; className: string }>> = {
  verified: { label: "Verified", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  page_corrected: {
    label: "Page corrected",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  unverified: {
    label: "Unverified evidence",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  none: { label: "No evidence", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
};

const VALIDATION_STYLES: Partial<Record<ValidationStatus, { label: string; className: string }>> = {
  error: { label: "Error", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  warning: { label: "Warning", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
};

const REVIEW_STYLES: Partial<Record<FieldReviewStatus, { label: string; className: string }>> = {
  accepted: { label: "Accepted", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  corrected: { label: "Corrected", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
};

function FieldCard({
  documentId,
  editable,
  field,
  issues,
  selected,
  onSelect,
}: {
  documentId: string;
  editable: boolean;
  field: ReviewField;
  issues: ReviewIssue[];
  selected: boolean;
  onSelect: () => void;
}) {
  const { fieldPath: path, extractionStatus } = field;
  const corrected = field.reviewStatus === "corrected";
  // A not_found field has no evidence by definition, and the evidence of a corrected field
  // describes the model's value, not the one shown; only badge evidence for extracted values.
  const evidenceBadge = extractionStatus === "not_found" || corrected ? undefined : EVIDENCE_STYLES[field.evidenceStatus];
  const validationBadge = VALIDATION_STYLES[field.validationStatus];
  const reviewBadge = REVIEW_STYLES[field.reviewStatus];
  const openIssues = issues.filter((issue) => issue.resolution === null);
  const value = formatFieldValue(path, field.currentValue);
  // What the document said, when it differs from the value shown: the model's value for a
  // correction, or the original form of a normalized value.
  const original =
    extractionStatus !== "not_found" && !sameJsonValue(field.extractedValue, field.currentValue)
      ? extractionStatus === "ambiguous"
        ? corrected
          ? "Ambiguous in the document"
          : null
        : `${corrected ? "Extracted" : "As written"}: ${formatFieldValue(path, field.extractedValue)}`
      : null;

  return (
    <li
      data-field={path}
      className={`rounded-md border text-sm ${
        selected
          ? "border-zinc-900 dark:border-zinc-100"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className="flex w-full flex-col gap-1 p-2 text-left"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="mr-auto font-medium">{fieldShortLabel(path)}</span>
          {extractionStatus === "not_found" && (
            <Badge label="Not found" className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
          )}
          {extractionStatus === "ambiguous" && (
            <Badge label="Ambiguous" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" />
          )}
          {evidenceBadge && <Badge {...evidenceBadge} />}
          {validationBadge && <Badge {...validationBadge} />}
          {reviewBadge && <Badge {...reviewBadge} />}
        </span>
        <span className={value === null ? "text-zinc-500 italic" : ""}>
          {value ??
            (extractionStatus === "ambiguous" && !corrected ? "Needs an analyst to choose" : "Not stated in the document")}
        </span>
        {original !== null && <span className="text-xs text-zinc-500">{original}</span>}
      </button>

      {selected && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
          {openIssues.map((issue) => (
            <p key={issue.id} className="flex items-start gap-2 text-xs">
              <Badge {...SEVERITY_STYLES[issue.severity]} />
              <span>{issue.message}</span>
            </p>
          ))}
          {extractionStatus === "ambiguous" && Array.isArray(field.extractedValue) ? (
            <ol className="flex flex-col gap-2">
              {field.extractedValue.map((candidate, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <span className="text-xs font-medium">
                    Candidate {index + 1}: {formatFieldValue(path, candidate) ?? "—"}
                  </span>
                  <EvidenceList evidence={field.evidence.filter((e) => e.candidateIndex === index)} />
                </li>
              ))}
            </ol>
          ) : (
            <>
              {corrected && field.evidence.length > 0 && (
                <p className="text-xs text-zinc-500">Cited for the extracted value:</p>
              )}
              <EvidenceList evidence={field.evidence} />
            </>
          )}
          {editable && <FieldReviewControls documentId={documentId} field={field} />}
        </div>
      )}
    </li>
  );
}

function EvidenceList({ evidence }: { evidence: ReviewEvidence[] }) {
  if (evidence.length === 0) return <p className="text-xs text-zinc-500">No evidence cited.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {evidence.map((item) => (
        <li key={item.id} className="flex flex-col gap-0.5 text-xs">
          <q className="font-mono">{item.quote}</q>
          <span className={item.verification === "not_found" ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}>
            {describeEvidence(item)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function describeEvidence(item: ReviewEvidence): string {
  switch (item.verification) {
    case "verified":
      return `Found on page ${item.matchedPage}`;
    case "page_corrected":
      return `Cited page ${item.citedPage}, found on page ${item.matchedPage}`;
    case "not_found":
      return `Cited page ${item.citedPage}, but this text does not appear in the document`;
  }
}

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}
