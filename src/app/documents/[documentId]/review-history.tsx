import { formatTimestamp } from "@/lib/format";
import { formatFieldValue } from "@/lib/review/format-value";
import { fieldLabel } from "@/lib/schemas/field-paths";
import type { ReviewEvent, ReviewIssue } from "@/server/db/queries/review";

// The audit log of a document, oldest first, as stored in review_events (append-only).

export function ReviewHistory({ events, issues }: { events: ReviewEvent[]; issues: ReviewIssue[] }) {
  const issueMessages = new Map(issues.map((issue) => [issue.id, issue.message]));
  return (
    <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Review history</h2>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">No review actions yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <time dateTime={event.createdAt.toISOString()} className="shrink-0 text-xs text-zinc-500 sm:w-44 sm:pt-0.5">
                {formatTimestamp(event.createdAt)}
              </time>
              <span>
                <span className="font-medium">{event.actorName}</span> {describe(event, issueMessages)}
                {event.note && <span className="text-zinc-500"> — “{event.note}”</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const RESOLUTION_VERBS: Record<string, string> = {
  corrected: "resolved by correction",
  confirmed: "confirmed",
  accepted_unresolved: "accepted as a known issue",
};

function describe(event: ReviewEvent, issueMessages: Map<string, string>): string {
  const label = event.fieldPath ? fieldLabel(event.fieldPath).toLowerCase() : "";
  const value = (v: unknown) => (event.fieldPath && formatFieldValue(event.fieldPath, v)) ?? "not stated";
  switch (event.eventType) {
    case "review_started":
      return "started the review";
    case "field_accepted":
      return `accepted ${label}`;
    case "field_corrected":
      return `corrected ${label}: ${value(event.previousValue)} → ${value(event.newValue)}`;
    case "issue_resolved": {
      const resolution = (event.newValue as { resolution?: string } | null)?.resolution ?? "";
      const message = event.issueId ? issueMessages.get(event.issueId) : undefined;
      return `${RESOLUTION_VERBS[resolution] ?? "resolved"} an issue${message ? `: ${message}` : ""}`;
    }
    case "document_approved":
      return "approved the document";
    case "document_rejected":
      return "rejected the document";
  }
}
