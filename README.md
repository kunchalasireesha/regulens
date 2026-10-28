# ReguLens

AI-powered regulatory document intelligence: turn business licensing applications into
structured, traceable, validated records, with human review.

> Independent portfolio project. All sample documents and data are fictional.

**Status:** Phase 5: uploading a PDF runs the full pipeline (extract → verify evidence →
validate) in the background and stores reviewable fields, evidence, and validation issues;
the document list updates when processing finishes, and failed runs can be retried. The
review screen comes next.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Requirements

- Node.js 24 (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker (for local Postgres)

## Setup

```bash
nvm use
pnpm install
cp .env.example .env.local
pnpm db:up        # start Postgres in Docker
pnpm db:migrate   # apply migrations
pnpm db:seed      # demo organization and analyst (stands in for auth until it exists)
pnpm check        # lint + typecheck + unit tests
pnpm test:integration   # upload flow against a separate regulens_test database
pnpm dev          # http://localhost:3000
```

## Sample documents

`samples/` holds fictional applications rendered by `pnpm samples` (deterministic output):

| File | Purpose |
|---|---|
| `harborline-payments.pdf` | Complete and consistent; should validate cleanly |
| `cobalt-peak-remit.pdf` | Deliberate problems: ownership over 100%, invalid state, dates out of order |
| `scanned-no-text-layer.pdf` | No text layer, like a scan; stored but marked failed (no OCR) |

The fixtures in `scripts/samples/fixtures.ts` are also the ground truth for evaluation.

## AI provider

ReguLens uses the Google Gemini API free tier. Without a key it falls back to mock
extraction, so everything except real extraction works offline.

1. Sign in at [Google AI Studio](https://aistudio.google.com/apikey) and create an API key.
   No billing account is needed for the free tier.
2. Put it in `.env.local` (never in `.env.example`, never in client code):
   ```
   GEMINI_API_KEY=your-key
   ```
3. Optional: `GEMINI_MODEL` (default `gemini-3.8-flash`), or `AI_PROVIDER=mock` to force mocks.
4. Try it on a sample (prints the result and run metrics; stores nothing):
   ```bash
   pnpm extract samples/harborline-payments.pdf          # Gemini if a key is set
   pnpm extract samples/harborline-payments.pdf --mock   # always offline
   ```

The mock provider reads the "Label: value" lines of the sample form layout and answers in
the same JSON a model would, so its output goes through the same validation. On any other
layout it reports every field as not found.

Free-tier limits vary by model and are shown in
[AI Studio](https://aistudio.google.com/rate-limit). Free-tier inputs may be used by Google
to improve its products, so use only synthetic documents.
