# Deploying ReguLens (Vercel + Supabase, free tiers)

This deploys the public demo: one shared analyst account whose credentials are shown on
the login page, mock extraction (no AI key on the server, no documents sent to Google),
and a cap on how many documents visitors can upload.

```
Browser ──► Vercel (Next.js, Hobby)
              ├─► Supabase Postgres   via the transaction pooler (port 6543)
              └─► Supabase Storage    REST API, private bucket, secret key
Laptop ───► Supabase Postgres         via the session pooler (port 5432): migrate + seed
```

Budget about 45 minutes. Keep a scratch note open for the values marked **save**.

## 0. Before you start

- Locally, everything passes: `pnpm check`, `pnpm test:integration`, `pnpm test:e2e`.
- All Phase 9 code is committed and pushed to `main` on GitHub. Vercel builds from GitHub,
  not from your laptop.
- Pick one region for both services and use it in steps 1 and 5. Every page view makes
  several database round-trips, so the app and the database should sit next to each other.
  Vercel's default function region is Washington, D.C. (`iad1`); the matching Supabase
  region is **East US (North Virginia)**.

## 1. Create the Supabase project

1. https://supabase.com/dashboard → **New project**.
2. Name `regulens`, region as above.
3. **Database password:** generate one and **save** it. Letters and digits only make life
   easier, because the password goes inside a URL; otherwise URL-encode it.
4. If the form offers **Enable Data API**, untick it. The app never uses it (it talks to
   Postgres directly), and every table also has row-level security as a second guard
   (migration `0005_row_level_security`).
5. Create the project and wait for it to finish provisioning.

## 2. Collect connection details

Open the project's **Connect** dialog (top bar).

- **Session pooler** connection string (port **5432**) → **save** as `MIGRATE_URL`.
  Used from your laptop for migrations and seeding. (The *direct* connection is IPv6-only
  on the free tier and fails on many home networks; the session pooler works everywhere.)
- **Transaction pooler** connection string (port **6543**) → **save** as `RUNTIME_URL`.
  Used by Vercel, where many short-lived function instances share a few database
  connections. The app turns prepared statements off, which transaction mode requires.

Both look like
`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:<port>/postgres`.
Put your password in place of `[YOUR-PASSWORD]` and append `?sslmode=require` to both, so
the connection is encrypted even if the pooler would accept plain text.

Then **Project Settings → API Keys**:

- Project URL, `https://<project-ref>.supabase.co` → **save** as `SUPABASE_URL`.
- A **secret** key (`sb_secret_…`) → **save** as `SUPABASE_SECRET_KEY`. It bypasses all
  access rules: it only ever goes into Vercel's server-side environment.
- The **publishable** key (`sb_publishable_…`) → **save**, only for the check in step 7.

## 3. Create the storage bucket

**Storage → New bucket**:

- Name: `documents`
- **Public bucket: off.** Files are served only through the app, after sign-in.
- Restrict file size: `5 MB`. Restrict MIME types: `application/pdf`.

## 4. Migrate and seed the database (from your laptop)

Use a fresh terminal so the production URL can't leak into your dev shell. Variables set
in the shell take precedence over `.env.local`.

```bash
cd ~/Projects/regulens
nvm use
export DATABASE_URL='<MIGRATE_URL>'          # session pooler, port 5432
pnpm db:migrate                              # applies drizzle/0000 … 0005
DEMO_PASSWORD='<choose one>' pnpm db:seed    # demo organization + analyst@example.com
unset DATABASE_URL
```

**Save** the demo password: the login page will show it, so choose something you don't use
anywhere else. The seed never overwrites an existing password, so if you need to change it
later, update the user's password rather than re-seeding.

Check in **Table Editor**: 11 tables, each marked as having RLS enabled; `organizations` and
`users` have one row each.

## 5. Create the Vercel project

1. https://vercel.com/new → import `kunchalasireesha/regulens` from GitHub.
2. Framework preset: **Next.js** (detected). Leave build and install commands at their
   defaults; Vercel picks pnpm from `pnpm-lock.yaml` and Node 24 from `engines`.
3. Before the first deploy, open **Environment Variables** and add:

| Name | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `<RUNTIME_URL>` | transaction pooler, port **6543**. Mark *Sensitive*. |
| `DATABASE_POOL_MAX` | `5` | connections per function instance; the pooler multiplexes |
| `AI_PROVIDER` | `mock` | no AI key on the public demo |
| `STORAGE_BACKEND` | `supabase` | |
| `SUPABASE_URL` | `<SUPABASE_URL>` | |
| `SUPABASE_SECRET_KEY` | `<SUPABASE_SECRET_KEY>` | Mark *Sensitive*. |
| `SUPABASE_STORAGE_BUCKET` | `documents` | |
| `MAX_UPLOAD_BYTES` | `4194304` | 4 MB: Vercel rejects request bodies over 4.5 MB before the app sees them |
| `MAX_PAGES` | `30` | |
| `MAX_DOCUMENTS` | `25` | caps what visitors can upload in total |
| `PUBLIC_DEMO` | `true` | shows the demo credentials on the login page |
| `DEMO_PASSWORD` | the password from step 4 | Must match what the seed set. Mark *Sensitive*. |

   `MAX_UPLOAD_BYTES` is also read at build time (`next.config.ts` sizes the Server Action
   body limit from it), so it must be set before the build, not only at runtime.

4. **Deploy.** After it succeeds, set **Settings → Functions → Function Region** to the
   region from step 0 if it isn't already, and redeploy if you changed it.

## 6. Smoke test the live site

Open the deployment URL in a private window.

- [ ] The login page shows `analyst@example.com`, the demo password, and a link to the
      sample PDFs on GitHub.
- [ ] A wrong password is rejected; the right one signs you in.
- [ ] Download a sample from the link and upload it. It goes from Queued to ready for review
      within a few seconds (refresh if needed).
- [ ] Uploading the same file again reports it as already uploaded.
- [ ] `scanned-no-text-layer.pdf` ends up under Failed with a reason.
- [ ] The review page shows the document text with evidence highlighted.
- [ ] Correct a field, resolve issues, approve, and download the JSON export.
- [ ] Supabase **Storage → documents** holds one object per distinct upload, named by its
      SHA-256.
- [ ] Vercel **Logs** for the deployment show no errors.

## 7. Security checks

- [ ] The Data API exposes nothing. Should print `[]`, or an error if the Data API is off:
  ```bash
  curl -s 'https://<project-ref>.supabase.co/rest/v1/users?select=email' \
    -H 'apikey: <publishable key>'
  ```
- [ ] The bucket is private. Should fail with an error, not return a PDF:
  ```bash
  curl -s 'https://<project-ref>.supabase.co/storage/v1/object/public/documents/<any object name>'
  ```
- [ ] Supabase **Advisors → Security Advisor** reports no "RLS disabled" errors.
- [ ] `view-source:` on the login page and a browser devtools search for `sb_secret` and
      `postgres.` find nothing: secrets stay on the server.
- [ ] Session cookie (devtools → Application → Cookies) is `HttpOnly`, `Secure`, `SameSite=Lax`.

## Operating the demo

**Resetting visitor data.** Everyone shares one account, so documents pile up until
`MAX_DOCUMENTS` blocks new uploads. In Supabase **SQL Editor**:

```sql
-- TRUNCATE bypasses the append-only trigger on review_events (row triggers don't fire),
-- and CASCADE empties every table that references documents. Users and sessions stay.
TRUNCATE documents CASCADE;
```

Then empty the bucket in **Storage → documents** (select all → delete). Files are
content-addressed, so a leftover file is harmless but wastes space.

**Inactivity pause.** Free Supabase projects pause after about a week without traffic; the
site then fails to load data. Restore the project from the Supabase dashboard (it takes a
minute or two). Visit the site before you share the link with a recruiter.

**Rolling back.** Vercel → **Deployments** → pick the last good one → **Promote to
Production**. Migrations are not rolled back automatically; every migration so far only
adds, so an older build runs against a newer schema.

**Shipping changes.** Push to `main` and Vercel redeploys. A change that adds a migration
needs step 4's `pnpm db:migrate` against `MIGRATE_URL` *before* the push, so the new code
never runs against the old schema.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Pages error; logs say "Invalid or missing environment variables: …" | A variable from step 5 is missing or malformed; the message names it (never its value). Fix it and redeploy. |
| Upload fails with "Body exceeded … limit" or HTTP 413 | `MAX_UPLOAD_BYTES` above 4 MB, or changed without a redeploy. |
| `password authentication failed` | Wrong password, or special characters not URL-encoded. The pooler user is `postgres.<project-ref>`, not `postgres`. |
| `pnpm db:migrate` hangs or `ENETUNREACH` | You used the direct connection (IPv6). Use the session pooler. |
| Upload fails with "Storage upload failed with HTTP 400/404" | Bucket name differs from `SUPABASE_STORAGE_BUCKET`, or the MIME restriction lacks `application/pdf`. |
| HTTP 401/403 from Storage | Wrong key in `SUPABASE_SECRET_KEY` (the publishable key does not work). |
| Login page has no demo credentials | `PUBLIC_DEMO` not `true`, or not redeployed after setting it. |
| Demo credentials are rejected | `DEMO_PASSWORD` in Vercel differs from the one used for `pnpm db:seed`. |
| Vercel install warns about the pnpm version | Add `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses `packageManager` from `package.json`. |
