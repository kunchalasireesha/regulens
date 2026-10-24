# ReguLens

AI-powered regulatory document intelligence: turn business licensing applications into
structured, traceable, validated records, with human review.

> Independent portfolio project. All sample documents and data are fictional.

**Status:** Phase 1 (foundation): schemas, database, configuration, tests.
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
pnpm check        # lint + typecheck + tests
```

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

Free-tier limits vary by model and are shown in
[AI Studio](https://aistudio.google.com/rate-limit). Free-tier inputs may be used by Google
to improve its products, so use only synthetic documents.
