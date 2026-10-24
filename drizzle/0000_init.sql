CREATE TYPE "public"."document_review_status" AS ENUM('unreviewed', 'in_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('verified', 'page_corrected', 'unverified', 'none');--> statement-breakpoint
CREATE TYPE "public"."evidence_verification" AS ENUM('verified', 'page_corrected', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."extraction_run_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('found', 'not_found', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."field_review_status" AS ENUM('pending', 'accepted', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."issue_resolution" AS ENUM('corrected', 'confirmed', 'accepted_unresolved');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('critical', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."processing_stage" AS ENUM('parse', 'extract', 'verify_evidence', 'validate');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('queued', 'processing', 'ready_for_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_event_type" AS ENUM('review_started', 'field_accepted', 'field_corrected', 'issue_resolved', 'document_approved', 'document_rejected');--> statement-breakpoint
CREATE TYPE "public"."stage_outcome" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('analyst', 'admin');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('not_validated', 'valid', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "document_pages" (
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "document_pages_document_id_page_number_pk" PRIMARY KEY("document_id","page_number")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_hash" char(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"storage_key" text NOT NULL,
	"processing_status" "processing_status" DEFAULT 'queued' NOT NULL,
	"review_status" "document_review_status" DEFAULT 'unreviewed' NOT NULL,
	"failure_code" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_content_hash_unique" UNIQUE("organization_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"extracted_value" jsonb,
	"normalized_value" jsonb,
	"current_value" jsonb,
	"extraction_status" "extraction_status" NOT NULL,
	"evidence_status" "evidence_status" DEFAULT 'none' NOT NULL,
	"validation_status" "validation_status" DEFAULT 'not_validated' NOT NULL,
	"review_status" "field_review_status" DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_fields_document_path_unique" UNIQUE("document_id","field_path")
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"status" "extraction_run_status" NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"estimated_cost_usd" numeric(12, 6),
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"candidate_index" integer,
	"cited_page" integer NOT NULL,
	"quote" text NOT NULL,
	"verification" "evidence_verification" NOT NULL,
	"matched_page" integer,
	"match_start" integer,
	"match_end" integer
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"stage" "processing_stage" NOT NULL,
	"outcome" "stage_outcome" NOT NULL,
	"duration_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" "review_event_type" NOT NULL,
	"field_path" text,
	"issue_id" uuid,
	"previous_value" jsonb,
	"new_value" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'analyst' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "validation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"severity" "issue_severity" NOT NULL,
	"field_paths" text[] NOT NULL,
	"message" text NOT NULL,
	"resolution" "issue_resolution",
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_evidence" ADD CONSTRAINT "field_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_evidence" ADD CONSTRAINT "field_evidence_field_id_extracted_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."extracted_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_events" ADD CONSTRAINT "processing_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_events" ADD CONSTRAINT "processing_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_issue_id_validation_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."validation_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_org_created_idx" ON "documents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "extraction_runs_document_idx" ON "extraction_runs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "field_evidence_field_idx" ON "field_evidence" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "processing_events_document_idx" ON "processing_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "review_events_document_idx" ON "review_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "users_organization_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "validation_issues_document_idx" ON "validation_issues" USING btree ("document_id");