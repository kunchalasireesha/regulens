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
| `src/lib/schemas` | Zod contracts shared across server and UI; field paths and labels. |
| `src/server/env.ts` | Server-only config. Selects the AI provider. |
| `src/server/auth` | Password hashing, database sessions, current actor (the data access layer's entry point). |
| `src/proxy.ts` | Redirects requests without a session cookie to `/login`. Convenience only. |
| `src/server/db` | Drizzle schema, client, org-scoped queries. |
| `src/server/ingestion` | File checks, hashing, PDF text extraction, file storage, upload service. |
| `src/server/extraction` | `ExtractionProvider` interface, Gemini and mock implementations, prompt. |
| `src/server/evidence` | Quote normalization and verification. Pure. |
| `src/server/validation` | Business rules. Pure. |
| `src/server/pipeline` | Stage orchestration, processing events, idempotency. |
| `src/server/review` | Edits, issue resolution, approval rules. |
| `src/server/export` | Approved record → export JSON. Pure. |
| `scripts/samples` | Fictional sample applications: fixtures (ground truth) and PDF renderer. |

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

**What evidence matching tolerates.** Quote and page text are normalized the same way
before searching: Unicode compatibility forms (ligatures, non-breaking spaces), accents,
curly quotes and dashes, case, and whitespace runs (so a quote that joins wrapped lines
still matches). A changed word or reordered phrase does not match. The normalizer keeps a
map to the original text, so matches are stored as offsets into the page the analyst sees.
A verified quote proves the text exists, not that it supports the value, so the value
itself (each address part, each DBA name; numbers compared numerically) must also appear
in its quotes, or the field gets an `evidence.value_mismatch` warning.

**Validation rules and severities.** Rules are pure functions over the result plus the
evidence roll-up; they never change a value. `critical` means the record is wrong or
incomplete as extracted (required field missing, expiration not after application date,
ownership outside 0–100% or totalling over 100%, invalid state); `warning` means an
analyst should look (unverified or missing evidence, ambiguous value, unparseable date,
registered office outside the state of formation); `info` is expected but worth noting
(no license number yet). A field's validation status is the most severe issue naming it.
Dates are compared after normalization to ISO, so "07/19/2019" and "2026-08-02" compare
correctly; numeric dates are read month-first, as on US forms.

**Separate statuses.** Documents track processing and review status separately. Fields
track extraction, evidence, validation, and review status separately.

**Raw, normalized, and current values.** `extracted_value` is never modified;
`normalized_value` is deterministic (ISO dates, state codes); `current_value` is what the
analyst stands behind. Analyst corrections double as labeled evaluation data.

**AI provider behind an interface.** Gemini (free tier) by default; a mock provider is used
when no key is configured and in all automated tests. The provider-facing JSON schema is
kept within Gemini's supported JSON Schema subset (no `const`), and every response is
re-validated with Zod, since the API does not enforce keywords such as `minLength`.

**Flat provider schema, strict domain schema.** The model fills a flat shape in which every
field always has `status`, `value`, `evidence`, and `candidates`, derived from Zod with
`z.toJSONSchema` (a unit test fails if it uses a keyword outside Gemini's documented subset
or emits numeric bounds). The response is converted to the domain union and parsed with the
strict domain schema; contradictions such as a `not_found` field with a value fail as
`schema_mismatch` instead of being repaired. Failures log field paths, never values.

**Every extraction attempt is recorded.** `extraction_runs` stores provider, model, prompt
and schema versions, tokens (thinking tokens count as output), latency, a paid-tier cost
estimate, an error code on failure, and the validated result on success, so fields can be
re-derived after a verification or validation change without calling the model again.
Retries are limited to transient HTTP failures (3 attempts, capped backoff), since a
free-tier 429 can mean the daily quota is spent.

**Tenancy.** Single organization in the MVP; every tenant-owned table has
`organization_id`, and every query is scoped by it, so row-level security can be added later
without a data migration.

**Append-only audit log.** A database trigger rejects UPDATE and DELETE on `review_events`.
This also prevents deleting reviewed documents until a retention policy exists.

**Rejected vs. failed uploads.** A file that is not a readable PDF, is encrypted, or
exceeds the size or page limit is rejected and nothing is stored. A valid PDF with no text
layer (a scan) is a legitimate submission: it is stored and marked `failed` with
`no_text_layer`, so it stays visible. Checks use the file's bytes, never its name or MIME type.

**Duplicate detection and storage.** Files are stored under
`{organization_id}/{sha256}.pdf`. A unique `(organization_id, content_hash)` constraint
plus `ON CONFLICT DO NOTHING` makes concurrent uploads of the same file create exactly one
document. The file is written before the database rows; because keys are content-derived,
an orphaned write after a failed insert is harmless and a retry reuses it.

**Processing without a worker.** The pipeline is a plain function that the upload action
schedules with Next.js `after()`, so the response returns while the model runs; the
document list polls until nothing is in flight. It can move to a job queue without changes
to the stages.

**Processing state machine.** `queued → processing → ready_for_review | failed`, plus
`failed → queued` (retry) for retryable codes. A scanned PDF (`no_text_layer`) is not
retryable: the stored text cannot change. Every transition is one conditional `UPDATE`,
so the database decides races: of five concurrent runs, exactly one claims the document.

**Stale attempts and fencing.** A claim increments `processing_attempts`. An attempt still
`processing` after 15 minutes (well above the slowest Gemini run: 3 × 120 s plus backoff)
is presumed dead and can be reclaimed or retried. The claimer finishes only while the
attempt number is still its own, so a stalled run that wakes up after being replaced
cannot overwrite the newer attempt (it returns `superseded` and its work is discarded).
Staleness is computed in SQL against the database clock, never the web server's.

**One transaction per outcome.** The model call runs outside any transaction, since it can
take minutes. Everything after it (the status change, fields, evidence, issues, and stage
events) commits together, so a document is never `ready_for_review` with partial fields.
The status `UPDATE` runs first: it locks the row, and if the claim is no longer current
nothing has been written yet.

**Stored field values.** `extracted_value` is the value as the model returned it (for an
ambiguous field, the list of candidate values; null when not found). `current_value`
starts as the normalized value, or the extracted value when there is no normalized form,
and is null for ambiguous and missing fields until an analyst supplies one. Unexpected
pipeline errors are logged by error class and Postgres code only, because database errors
can carry query parameters, which here are document values.

**Review screen.** `/documents/[id]` shows fields beside the document's extracted text,
with every located quote highlighted at its stored offsets, so the analyst sees exactly
the words the value came from. Overlapping quotes are split into runs that carry every
field citing them. Unverified quotes have no location and are listed on the field instead.
Fields are ordered by an explicit comparator, not by the stored result, because `jsonb`
does not preserve object key order. A malformed id and another organization's document
both render the same not-found page.

**Review commands.** Accepting or correcting a field, resolving an issue, approving, and
rejecting are commands in `src/server/review`; server actions only parse the form. Each
command runs in one transaction that first locks the document row (`SELECT … FOR UPDATE`),
so commands on one document run one at a time and approval checks a consistent state. A
refused command throws inside the transaction, so it writes nothing, not even the
`review_started` event. Every change is logged to `review_events` with the previous and
new value. Approved and rejected documents are final.

**Corrections are re-validated.** A correction is checked against the field's shape, stored
in normalized form (ISO date, state code), and the rules are re-run on the current values.
Only issues naming the changed field are touched: an open one that no longer applies is
resolved as `corrected`, and a problem the correction introduces (ownership typed as 150)
becomes a new open issue. Issues match on rule, fields, and message, so a total that
changes from 170% to 110% replaces the old issue instead of leaving a stale message.
Evidence rules skip corrected fields: the analyst's value is their own.

**Approval rule.** Every field accepted or corrected, and no open critical or warning issue.
An issue is resolved by correcting the value, confirming it, or accepting it as a known
issue; accepting, or overruling a critical issue, needs a note. Info issues never block.
The rule is one pure function shared by the server and the review screen.

**Export.** `GET /documents/[id]/export` returns JSON for approved documents only (409
otherwise). Each value is labeled `extracted` (with its verified quotes), `corrected` (with
the model's value), or `missing`, and every issue is listed with its resolution.

**Authentication.** Email and password, hashed with Node's built-in scrypt at the OWASP
parameters (N=2^17, r=8, p=1), which are stored in each hash so they can be raised later.
Signing in creates a row in `sessions` keyed by the SHA-256 of a random 256-bit token; the
browser holds the token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
A database session, unlike a signed stateless cookie, ends the moment the row is deleted,
and a copy of the table cannot be used to sign in. Sessions last 12 hours with no sliding
renewal. An unknown email is checked against a decoy hash, so it takes as long to reject
as a wrong password, and both get the same message. There is no sign-up page: accounts
are issued (`pnpm user:create`), as in a real compliance team.

**Where authorization happens.** `proxy.ts` only checks that a cookie exists, to redirect
early with a `next` path; it never touches the database. The real check is
`getCurrentActor`, which every page, server action, and route handler calls: it looks the
session up (expiry compared on the database clock) and returns the user's organization,
which scopes every query. A forged or expired cookie passes the proxy and is stopped there.
The export route answers 401 instead of redirecting, since a download has no page. After
login, `next` is accepted only as a same-site path, so the form is not an open redirect.

## Data handling

- Synthetic documents only. Gemini free-tier inputs may be used by Google to improve its
  products, so real applicant data must not be sent to the free tier.
- No document text or identifiers in logs or processing events.
- API keys are read only in server-only modules.
- Passwords are stored only as scrypt hashes, session tokens only as SHA-256 hashes.
