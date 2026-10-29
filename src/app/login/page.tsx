import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth/navigation";
import { findCurrentUser } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { DEMO_ANALYST } from "@/server/db/seed-data";
import { getEnv } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · ReguLens" };

const SAMPLES_URL = "https://github.com/kunchalasireesha/regulens/tree/main/samples";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to ReguLens</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Accounts are created by an administrator.
        </p>
      </header>
      {/* The return path and the session are per request, so the form streams in. */}
      <Suspense fallback={<div className="h-64" />}>
        {searchParams.then(({ next }) => (
          <LoginSection next={safeNextPath(next)} />
        ))}
      </Suspense>
    </main>
  );
}

async function LoginSection({ next }: { next: string }) {
  // Already signed in (e.g. a bookmarked login page): go straight on.
  if (await findCurrentUser(getDb())) redirect(next);
  // Read per request, inside the streamed section: the page shell is prerendered at
  // build time, where a deployment's runtime configuration may not apply.
  const demo = getEnv().publicDemo;
  return (
    <>
      {demo ? <DemoNotice password={demo.password} /> : null}
      <LoginForm next={next} />
    </>
  );
}

function DemoNotice({ password }: { password: string }) {
  return (
    <section
      aria-label="Demo account"
      className="flex flex-col gap-2 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700"
    >
      <p>
        Public demo. Sign in as <code className="font-mono">{DEMO_ANALYST.email}</code> with
        password <code className="font-mono">{password}</code>.
      </p>
      <p className="text-zinc-600 dark:text-zinc-400">
        Extraction is simulated, and everything you upload is visible to other visitors. Use
        the fictional{" "}
        <a href={SAMPLES_URL} className="underline" target="_blank" rel="noreferrer">
          sample applications
        </a>
        , never real data.
      </p>
    </section>
  );
}
