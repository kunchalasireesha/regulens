import type { FieldKind } from "@/lib/schemas/field-paths";

// Reasons a review command is refused. Nothing is written when a command is refused.
// Messages are safe to show to users and never repeat the submitted value.

export const REVIEW_ERROR_MESSAGES = {
  document_not_found: "This document no longer exists.",
  not_reviewable: "This document is not open for review: it is still processing, or it was already approved or rejected.",
  field_not_found: "This field does not exist on the document.",
  issue_not_found: "This issue does not exist on the document.",
  issue_already_resolved: "This issue was already resolved.",
  no_value: "This field has no value to accept. Choose a candidate or enter a value.",
  unchanged: "That is already the current value. Use Accept instead.",
  invalid_value: "The value is not valid for this field.",
  invalid_candidate: "That candidate does not exist.",
  note_required: "Add a note explaining the decision.",
  approval_blocked: "The document cannot be approved yet.",
} as const;

export type ReviewErrorCode = keyof typeof REVIEW_ERROR_MESSAGES;

/** A more specific message for an invalid correction, by the kind of field. */
export const INVALID_VALUE_MESSAGES: Record<FieldKind, string> = {
  text: "Enter a value.",
  date: "Enter a valid date.",
  number: "Enter a number.",
  address: "Enter at least the street, city, state, and postal code.",
  text_list: "Enter one name per line.",
};
