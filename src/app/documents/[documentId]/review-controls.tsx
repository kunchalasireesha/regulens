"use client";

import { useActionState, useState } from "react";
import type { DocumentReviewStatus } from "@/lib/domain/statuses";
import { canApprove, type ApprovalCheck } from "@/lib/review/approval";
import { ADDRESS_PARTS } from "@/lib/review/correction-input";
import { formatFieldValue } from "@/lib/review/format-value";
import { fieldKind } from "@/lib/schemas/field-paths";
import { formatTimestamp } from "@/lib/format";
import type { ReviewField, ReviewIssue } from "@/server/db/queries/review";
import {
  acceptFieldAction,
  approveDocumentAction,
  correctFieldAction,
  rejectDocumentAction,
  resolveIssueAction,
  type ReviewActionState,
} from "./actions";

// The forms an analyst uses to review a document. Each posts to a server action and shows
// its refusal message, if any; on success the page re-renders with the new state, so these
// components hold no copy of the data beyond what is being typed.

type Action = (previous: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;

const idle: ReviewActionState = { status: "idle" };

/** useActionState plus a callback on success (e.g. to close the form that was submitted). */
function useReviewAction(action: Action, onSuccess?: () => void) {
  return useActionState(async (previous: ReviewActionState, formData: FormData) => {
    const state = await action(previous, formData);
    if (state.status === "ok") onSuccess?.();
    return state;
  }, idle);
}

const buttonStyles = {
  primary:
    "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
  secondary:
    "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
  danger:
    "rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
};
const inputStyles =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900";

function ErrorMessage({ state }: { state: ReviewActionState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
      {state.message}
    </p>
  );
}

/** Accept, correct, pick a candidate, or mark as not stated. */
export function FieldReviewControls({ documentId, field }: { documentId: string; field: ReviewField }) {
  const [editing, setEditing] = useState(false);
  const [acceptState, accept, accepting] = useReviewAction(acceptFieldAction);
  const ids = (
    <>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="fieldPath" value={field.fieldPath} />
    </>
  );
  const undecided = field.extractionStatus === "ambiguous" && field.reviewStatus === "pending";

  return (
    <div className="flex flex-col gap-2">
      {undecided && Array.isArray(field.extractedValue) && (
        <CandidatePicker documentId={documentId} field={field} candidates={field.extractedValue} />
      )}
      {editing ? (
        <CorrectionForm documentId={documentId} field={field} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {field.reviewStatus === "pending" && !undecided && (
            <form action={accept}>
              {ids}
              <button type="submit" disabled={accepting} className={buttonStyles.primary}>
                {field.currentValue === null ? "Confirm not stated" : "Accept"}
              </button>
            </form>
          )}
          <button type="button" onClick={() => setEditing(true)} className={buttonStyles.secondary}>
            {undecided ? "Enter a different value" : "Correct"}
          </button>
        </div>
      )}
      <ErrorMessage state={acceptState} />
    </div>
  );
}

function CandidatePicker({
  documentId,
  field,
  candidates,
}: {
  documentId: string;
  field: ReviewField;
  candidates: unknown[];
}) {
  const [state, choose, pending] = useReviewAction(correctFieldAction);
  return (
    <form action={choose} className="flex flex-col gap-1">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="fieldPath" value={field.fieldPath} />
      <input type="hidden" name="mode" value="candidate" />
      <span className="text-xs font-medium">Choose the correct value:</span>
      <div className="flex flex-wrap gap-2">
        {candidates.map((candidate, index) => (
          <button
            key={index}
            type="submit"
            name="candidateIndex"
            value={index}
            disabled={pending}
            className={buttonStyles.secondary}
          >
            {formatFieldValue(field.fieldPath, candidate) ?? "—"}
          </button>
        ))}
      </div>
      <ErrorMessage state={state} />
    </form>
  );
}

function CorrectionForm({ documentId, field, onDone }: { documentId: string; field: ReviewField; onDone: () => void }) {
  const [state, correct, pending] = useReviewAction(correctFieldAction, onDone);
  const kind = fieldKind(field.fieldPath);
  // Start from the value under review, or from the model's value when there is none yet.
  const start = field.currentValue ?? (field.extractionStatus === "found" ? field.extractedValue : null);

  return (
    <form action={correct} className="flex flex-col gap-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="fieldPath" value={field.fieldPath} />
      {kind === "address" ? (
        <AddressInputs value={start} />
      ) : kind === "text_list" ? (
        <label className="flex flex-col gap-1 text-xs">
          One name per line (leave empty if the document declares none)
          <textarea
            name="value"
            rows={3}
            defaultValue={Array.isArray(start) ? start.join("\n") : ""}
            className={inputStyles}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-xs">
          Correct value
          <input
            name="value"
            required
            type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
            step={kind === "number" ? "any" : undefined}
            defaultValue={kind === "date" ? isoDateOrEmpty(start) : typeof start === "string" || typeof start === "number" ? start : ""}
            className={inputStyles}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        Reason (optional)
        <input name="note" maxLength={2000} className={inputStyles} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="value" disabled={pending} className={buttonStyles.primary}>
          Save correction
        </button>
        <button
          type="submit"
          name="mode"
          value="not_stated"
          formNoValidate
          disabled={pending}
          className={buttonStyles.secondary}
        >
          Not stated in document
        </button>
        <button type="button" onClick={onDone} className={buttonStyles.secondary}>
          Cancel
        </button>
      </div>
      <ErrorMessage state={state} />
    </form>
  );
}

const ADDRESS_LABELS: Record<(typeof ADDRESS_PARTS)[number], string> = {
  street: "Street",
  unit: "Unit (optional)",
  city: "City",
  state: "State",
  postalCode: "Postal code",
};

function AddressInputs({ value }: { value: unknown }) {
  const address = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return (
    <div className="grid grid-cols-2 gap-2">
      {ADDRESS_PARTS.map((part) => (
        <label key={part} className={`flex flex-col gap-1 text-xs ${part === "street" ? "col-span-2" : ""}`}>
          {ADDRESS_LABELS[part]}
          <input
            name={part}
            required={part !== "unit"}
            defaultValue={typeof address[part] === "string" ? address[part] : ""}
            className={inputStyles}
          />
        </label>
      ))}
    </div>
  );
}

function isoDateOrEmpty(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

const RESOLUTION_LABELS = {
  corrected: "Resolved by a correction",
  confirmed: "Confirmed as correct",
  accepted_unresolved: "Accepted as a known issue",
} as const;

/** The resolution of a closed issue, or the form to resolve an open one. */
export function IssueResolution({
  documentId,
  issue,
  editable,
}: {
  documentId: string;
  issue: ReviewIssue;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, resolve, pending] = useReviewAction(resolveIssueAction, () => setOpen(false));

  if (issue.resolution) {
    return (
      <p className="pl-1 text-xs text-zinc-500">
        {RESOLUTION_LABELS[issue.resolution]}
        {issue.resolutionNote && <>: “{issue.resolutionNote}”</>}
      </p>
    );
  }
  if (!editable) return null;
  if (!open) {
    return (
      <div className="pl-1">
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium underline underline-offset-2">
          Resolve…
        </button>
      </div>
    );
  }
  return (
    <form action={resolve} className="flex flex-col gap-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="issueId" value={issue.id} />
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        To fix the value instead, correct the field; the issue closes when the problem is gone.
      </p>
      <label className="flex flex-col gap-1 text-xs">
        Note {issue.severity === "critical" ? "(required)" : "(required when accepting as a known issue)"}
        <textarea name="note" rows={2} maxLength={2000} className={inputStyles} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="resolution" value="confirmed" disabled={pending} className={buttonStyles.primary}>
          Value is correct
        </button>
        <button
          type="submit"
          name="resolution"
          value="accepted_unresolved"
          disabled={pending}
          className={buttonStyles.secondary}
        >
          Accept as known issue
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonStyles.secondary}>
          Cancel
        </button>
      </div>
      <ErrorMessage state={state} />
    </form>
  );
}

/** What is left before approval, and the approve and reject actions; or the final decision. */
export function ApprovalPanel({
  documentId,
  reviewStatus,
  check,
  reviewedBy,
  reviewedAt,
}: {
  documentId: string;
  reviewStatus: DocumentReviewStatus;
  check: ApprovalCheck;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [approveState, approve, approving] = useReviewAction(approveDocumentAction);
  const [rejectState, reject, submittingReject] = useReviewAction(rejectDocumentAction);
  const by = `${reviewedBy ?? "unknown"}${reviewedAt ? ` on ${formatTimestamp(reviewedAt)}` : ""}`;

  if (reviewStatus === "approved") {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950">
        <span>Approved by {by}.</span>
        <a href={`/documents/${documentId}/export`} download className={buttonStyles.primary}>
          Download JSON
        </a>
      </section>
    );
  }
  if (reviewStatus === "rejected") {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
        Rejected by {by}. See the review history for the reason.
      </section>
    );
  }

  const ready = canApprove(check);
  const critical = check.blockingIssues.filter((issue) => issue.severity === "critical").length;
  const remaining = [
    check.pendingFields.length > 0 && `${plural(check.pendingFields.length, "field")} to review`,
    check.blockingIssues.length > 0 &&
      `${plural(check.blockingIssues.length, "open issue")}${critical > 0 ? ` (${critical} critical)` : ""}`,
  ].filter(Boolean);

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={ready ? "" : "text-zinc-600 dark:text-zinc-400"}>
          {ready ? "Every field is reviewed and no blocking issue is open." : `Before approval: ${remaining.join(", ")}.`}
        </span>
        <div className="flex gap-2">
          <form action={approve}>
            <input type="hidden" name="documentId" value={documentId} />
            <button type="submit" disabled={!ready || approving} className={buttonStyles.primary}>
              Approve
            </button>
          </form>
          {!rejecting && (
            <button type="button" onClick={() => setRejecting(true)} className={buttonStyles.danger}>
              Reject…
            </button>
          )}
        </div>
      </div>
      <ErrorMessage state={approveState} />
      {rejecting && (
        <form action={reject} className="flex flex-col gap-2">
          <input type="hidden" name="documentId" value={documentId} />
          <label className="flex flex-col gap-1 text-xs">
            Reason for rejecting (required)
            <textarea name="note" rows={2} required maxLength={2000} className={inputStyles} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={submittingReject} className={buttonStyles.danger}>
              Reject document
            </button>
            <button type="button" onClick={() => setRejecting(false)} className={buttonStyles.secondary}>
              Cancel
            </button>
          </div>
          <ErrorMessage state={rejectState} />
        </form>
      )}
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
