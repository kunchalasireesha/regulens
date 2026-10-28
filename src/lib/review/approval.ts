import type { FieldReviewStatus, IssueResolution, IssueSeverity } from "@/lib/domain/statuses";

// The approval rule, shared by the server (which enforces it inside the approval
// transaction) and the review screen (which explains what is still missing).
//
// A document can be approved when every field has been accepted or corrected, and no
// critical or warning issue is still open. An open issue must be resolved first: by
// correcting the value, confirming it is right, or accepting it as a known issue.
// Info issues are notes and never block.

export const BLOCKING_SEVERITIES: readonly IssueSeverity[] = ["critical", "warning"];

export type ApprovalCheck = {
  /** Fields still awaiting review, by path. */
  pendingFields: string[];
  /** Open critical and warning issues. */
  blockingIssues: { id: string; severity: IssueSeverity }[];
};

export function checkApproval(
  fields: readonly { fieldPath: string; reviewStatus: FieldReviewStatus }[],
  issues: readonly { id: string; severity: IssueSeverity; resolution: IssueResolution | null }[],
): ApprovalCheck {
  return {
    pendingFields: fields.filter((field) => field.reviewStatus === "pending").map((field) => field.fieldPath),
    blockingIssues: issues
      .filter((issue) => issue.resolution === null && BLOCKING_SEVERITIES.includes(issue.severity))
      .map(({ id, severity }) => ({ id, severity })),
  };
}

export function canApprove(check: ApprovalCheck): boolean {
  return check.pendingFields.length === 0 && check.blockingIssues.length === 0;
}
