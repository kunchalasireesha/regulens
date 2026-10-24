import {
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DOCUMENT_REVIEW_STATUSES,
  EVIDENCE_STATUSES,
  EVIDENCE_VERIFICATIONS,
  EXTRACTION_STATUSES,
  FIELD_REVIEW_STATUSES,
  ISSUE_RESOLUTIONS,
  ISSUE_SEVERITIES,
  PROCESSING_STAGES,
  PROCESSING_STATUSES,
  REVIEW_EVENT_TYPES,
  STAGE_OUTCOMES,
  USER_ROLES,
  VALIDATION_STATUSES,
} from "../../lib/domain/statuses"; // relative: drizzle-kit loads this file outside Next

// Every tenant-owned table carries organization_id, even where it is derivable
// through documents. The MVP runs a single organization, but scoping every query
// by this column now means row-level security can be added later without a
// data migration.

export const userRole = pgEnum("user_role", USER_ROLES);
export const processingStatus = pgEnum("processing_status", PROCESSING_STATUSES);
export const documentReviewStatus = pgEnum("document_review_status", DOCUMENT_REVIEW_STATUSES);
export const extractionStatus = pgEnum("extraction_status", EXTRACTION_STATUSES);
export const evidenceVerification = pgEnum("evidence_verification", EVIDENCE_VERIFICATIONS);
export const evidenceStatus = pgEnum("evidence_status", EVIDENCE_STATUSES);
export const validationStatus = pgEnum("validation_status", VALIDATION_STATUSES);
export const fieldReviewStatus = pgEnum("field_review_status", FIELD_REVIEW_STATUSES);
export const issueSeverity = pgEnum("issue_severity", ISSUE_SEVERITIES);
export const issueResolution = pgEnum("issue_resolution", ISSUE_RESOLUTIONS);
export const processingStage = pgEnum("processing_stage", PROCESSING_STAGES);
export const stageOutcome = pgEnum("stage_outcome", STAGE_OUTCOMES);
export const reviewEventType = pgEnum("review_event_type", REVIEW_EVENT_TYPES);
export const extractionRunStatus = pgEnum("extraction_run_status", ["succeeded", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("analyst"),
    createdAt: createdAt(),
  },
  (t) => [index("users_organization_idx").on(t.organizationId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    filename: text("filename").notNull(),
    /** SHA-256 of the file bytes, hex encoded. Used to detect duplicate uploads. */
    contentHash: char("content_hash", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    storageKey: text("storage_key").notNull(),
    processingStatus: processingStatus("processing_status").notNull().default("queued"),
    reviewStatus: documentReviewStatus("review_status").notNull().default("unreviewed"),
    /** Machine-readable failure reason, safe to show to users. Never raw error text. */
    failureCode: text("failure_code"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("documents_org_content_hash_unique").on(t.organizationId, t.contentHash),
    index("documents_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

const documentRef = () =>
  uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" });

const organizationRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id);

export const documentPages = pgTable(
  "document_pages",
  {
    organizationId: organizationRef(),
    documentId: documentRef(),
    /** 1-based, matching how analysts and the model refer to pages. */
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.pageNumber] })],
);

export const extractionRuns = pgTable(
  "extraction_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationRef(),
    documentId: documentRef(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    status: extractionRunStatus("status").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    /** What the run would cost at paid-tier list prices; free-tier runs cost nothing. */
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [index("extraction_runs_document_idx").on(t.documentId)],
);

export const extractedFields = pgTable(
  "extracted_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationRef(),
    documentId: documentRef(),
    extractionRunId: uuid("extraction_run_id")
      .notNull()
      .references(() => extractionRuns.id),
    /** Dotted path into ExtractionResult, e.g. "business.legalName" or "people[1].title". */
    fieldPath: text("field_path").notNull(),
    /** What the model returned. Never modified after extraction. */
    extractedValue: jsonb("extracted_value"),
    /** Deterministic normalization of extractedValue (e.g. ISO dates), when possible. */
    normalizedValue: jsonb("normalized_value"),
    /** The value the analyst stands behind; starts as normalized/extracted. */
    currentValue: jsonb("current_value"),
    extractionStatus: extractionStatus("extraction_status").notNull(),
    evidenceStatus: evidenceStatus("evidence_status").notNull().default("none"),
    validationStatus: validationStatus("validation_status").notNull().default("not_validated"),
    reviewStatus: fieldReviewStatus("review_status").notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("extracted_fields_document_path_unique").on(t.documentId, t.fieldPath)],
);

export const fieldEvidence = pgTable(
  "field_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationRef(),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => extractedFields.id, { onDelete: "cascade" }),
    /** For ambiguous fields: which candidate this evidence supports. */
    candidateIndex: integer("candidate_index"),
    citedPage: integer("cited_page").notNull(),
    quote: text("quote").notNull(),
    verification: evidenceVerification("verification").notNull(),
    /** Where the quote was actually found, when verification succeeded. */
    matchedPage: integer("matched_page"),
    matchStart: integer("match_start"),
    matchEnd: integer("match_end"),
  },
  (t) => [index("field_evidence_field_idx").on(t.fieldId)],
);

export const validationIssues = pgTable(
  "validation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationRef(),
    documentId: documentRef(),
    ruleId: text("rule_id").notNull(),
    severity: issueSeverity("severity").notNull(),
    fieldPaths: text("field_paths").array().notNull(),
    message: text("message").notNull(),
    resolution: issueResolution("resolution"),
    resolutionNote: text("resolution_note"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("validation_issues_document_idx").on(t.documentId)],
);

/** Append-only audit log of analyst actions. Rows are never updated or deleted. */
export const reviewEvents = pgTable(
  "review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationRef(),
    documentId: documentRef(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    eventType: reviewEventType("event_type").notNull(),
    fieldPath: text("field_path"),
    issueId: uuid("issue_id").references(() => validationIssues.id),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("review_events_document_idx").on(t.documentId, t.createdAt)],
);

/** Pipeline telemetry. Stores stage outcomes and error codes, never document content. */
export const processingEvents = pgTable(
  "processing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: organizationRef(),
    documentId: documentRef(),
    stage: processingStage("stage").notNull(),
    outcome: stageOutcome("outcome").notNull(),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [index("processing_events_document_idx").on(t.documentId, t.createdAt)],
);
