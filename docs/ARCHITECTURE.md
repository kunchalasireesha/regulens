# ReguLens Architecture

ReguLens turns licensing application PDFs into structured, traceable, validated records.
An LLM drafts the extraction; deterministic code verifies evidence and applies business
rules; a compliance analyst reviews, corrects, and explicitly approves.

## Pipeline

```
upload ─► file checks (magic bytes, size, page limit) ─► sha256 ─► duplicate check
       ─► store file ─► documents row (processing_status = queued)
       ─► pipeline.run(documentId)
            claim     atomic UPDATE … WHERE processing_status = 'queued'
            parse     page text → document_pages; no text layer → failed (OCR is out of scope)
            extract   AI provider → JSON → Zod parse → extraction_runs (tokens, latency, cost)
            verify    each cited quote is searched for in the normalized page text
            validate  deterministic rules → validation_issues
          ─► processing_status = ready_for_review
review ─► edit / resolve issues / approve or reject (review_events, append-only)
export ─► approved records only; extracted vs. corrected vs. missing kept distinct
```

## Module boundaries

| Path | Responsibility |
|---|---|
| `src/app` | Routes, server actions, route handlers. Input validation only. |
| `src/lib/domain` | Shared status vocabularies. |
| `src/lib/schemas` | Zod contracts shared across server and UI. |
| `src/server/env.ts` | Server-only config. Selects the AI provider. |
| `src/server/db` | Drizzle schema, client, org-scoped queries. |
| `src/server/ingestion` | File checks, hashing, PDF text extraction. |
| `src/server/extraction` | `ExtractionProvider` interface, Gemini and mock implementations, prompt. |
| `src/server/evidence` | Quote normalization and verification. Pure. |
| `src/server/validation` | Business rules. Pure. |
| `src/server/pipeline` | Stage orchestration, processing events, idempotency. |
| `src/server/review` | Edits, issue resolution, approval rules. |
| `src/server/export` | Approved record → export JSON. Pure. |

Evidence, validation, and export are pure functions with no database or network access,
so they are unit-tested directly and reused unchanged by the evaluation script.

## Key decisions

**Schema checks shape; validation checks rules.** The extraction schema accepts an
ownership percentage of 150 or a state code of "XX", because rejecting them would discard
what the document says. Validation reports them as reviewable issues.

**Explicit absence.** Every field is `found`, `not_found`, or `ambiguous` (with at least two
candidates). A missing value is never an empty string or a guess.

**Evidence is verified, never trusted.** The model cites `{ page, quote }`. Code normalizes
both sides and searches the cited page, then all pages: `verified`, `page_corrected`
(stored with the real page), or `not_found`, which flags the field for review.

**Separate statuses.** Documents track processing and review status separately. Fields
track extraction, evidence, validation, and review status separately.

**Raw, normalized, and current values.** `extracted_value` is never modified;
`normalized_value` is deterministic (ISO dates, state codes); `current_value` is what the
analyst stands behind. Analyst corrections double as labeled evaluation data.

**AI provider behind an interface.** Gemini (free tier) by default; a mock provider is used
when no key is configured and in all automated tests. The provider-facing JSON schema is
kept within Gemini's supported JSON Schema subset (no `const`), and every response is
re-validated with Zod, since the API does not enforce keywords such as `minLength`.

**Tenancy.** Single organization in the MVP; every tenant-owned table has
`organization_id`, and every query is scoped by it, so row-level security can be added later
without a data migration.

**Append-only audit log.** A database trigger rejects UPDATE and DELETE on `review_events`.
This also prevents deleting reviewed documents until a retention policy exists.

**Processing without a worker.** The pipeline is a plain function triggered after upload,
with an atomic claim to prevent double processing. It can move to a job queue without
changes to the stages.

## Data handling

- Synthetic documents only. Gemini free-tier inputs may be used by Google to improve its
  products, so real applicant data must not be sent to the free tier.
- No document text or identifiers in logs or processing events.
- API keys are read only in server-only modules.
- Authentication and per-user authorization are added before any public deployment.
