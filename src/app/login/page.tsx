import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth/navigation";
import { findCurrentUser } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · ReguLens" };

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
  return <LoginForm next={next} />;
}
