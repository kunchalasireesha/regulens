import type { IssueResolution } from "@/lib/domain/statuses";
import type { ValidationIssue } from "@/server/validation/validate";

// After a correction, the rules are re-run on the current values. This decides what that
// means for the stored issues. Pure.
//
// Only issues that name a changed field are touched. The re-run cannot reproduce every
// stored issue (evidence-to-value checks need the model's evidence, which a corrected
// value no longer has), so an issue about a field nobody changed is left exactly as it is.
//
// Two issues are the same when rule, fields, and message all match. The message carries
// the values involved ("adds up to 170%"), so a correction that changes the numbers
// replaces the issue instead of leaving a stale message open.

export type StoredIssue = {
  id: string;
  ruleId: string;
  fieldPaths: string[];
  message: string;
  resolution: IssueResolution | null;
};

export type IssueChanges = {
  /** Open issues that no longer apply: resolved as `corrected`. */
  resolve: string[];
  /** Problems the correction introduced: stored as new open issues. */
  insert: ValidationIssue[];
};

export function reconcileIssues(
  stored: readonly StoredIssue[],
  recomputed: readonly ValidationIssue[],
  changedPaths: ReadonlySet<string>,
): IssueChanges {
  const touchesChange = (issue: { fieldPaths: string[] }) => issue.fieldPaths.some((path) => changedPaths.has(path));
  const recomputedKeys = new Set(recomputed.map(issueKey));
  // An issue the analyst confirmed or accepted still stands; one that a correction
  // resolved does not, so if the problem comes back, it is raised again.
  const standingKeys = new Set(stored.filter((issue) => issue.resolution !== "corrected").map(issueKey));

  return {
    resolve: stored
      .filter((issue) => issue.resolution === null && touchesChange(issue) && !recomputedKeys.has(issueKey(issue)))
      .map((issue) => issue.id),
    insert: recomputed.filter((issue) => touchesChange(issue) && !standingKeys.has(issueKey(issue))),
  };
}

function issueKey(issue: Pick<StoredIssue, "ruleId" | "fieldPaths" | "message">): string {
  return JSON.stringify([issue.ruleId, [...issue.fieldPaths].sort(), issue.message]);
}
