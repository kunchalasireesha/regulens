// Status vocabularies shared by the database schema, server logic, and UI.
// Each dimension is tracked independently: a field can be "found" by the model,
// have "unverified" evidence, fail validation, and still be awaiting review.

export const PROCESSING_STATUSES = ["queued", "processing", "ready_for_review", "failed"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const DOCUMENT_REVIEW_STATUSES = ["unreviewed", "in_review", "approved", "rejected"] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export const EXTRACTION_STATUSES = ["found", "not_found", "ambiguous"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

/** Result of checking a model-cited quote against the extracted page text. */
export const EVIDENCE_VERIFICATIONS = ["verified", "page_corrected", "not_found"] as const;
export type EvidenceVerification = (typeof EVIDENCE_VERIFICATIONS)[number];

/** Field-level roll-up of its evidence; "none" means the model cited nothing. */
export const EVIDENCE_STATUSES = ["verified", "page_corrected", "unverified", "none"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const VALIDATION_STATUSES = ["not_validated", "valid", "warning", "error"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const FIELD_REVIEW_STATUSES = ["pending", "accepted", "corrected"] as const;
export type FieldReviewStatus = (typeof FIELD_REVIEW_STATUSES)[number];

export const ISSUE_SEVERITIES = ["critical", "warning", "info"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * How an analyst closed a validation issue. "accepted_unresolved" lets a record be
 * approved with a known issue, but the issue is still reported as unresolved on export.
 */
export const ISSUE_RESOLUTIONS = ["corrected", "confirmed", "accepted_unresolved"] as const;
export type IssueResolution = (typeof ISSUE_RESOLUTIONS)[number];

export const PROCESSING_STAGES = ["parse", "extract", "verify_evidence", "validate"] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

export const STAGE_OUTCOMES = ["started", "succeeded", "failed"] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

export const REVIEW_EVENT_TYPES = [
  "review_started",
  "field_accepted",
  "field_corrected",
  "issue_resolved",
  "document_approved",
  "document_rejected",
] as const;
export type ReviewEventType = (typeof REVIEW_EVENT_TYPES)[number];

export const USER_ROLES = ["analyst", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
