import { connection } from "next/server";
import { Suspense } from "react";
import { getEnv } from "@/server/env";
import { DocumentList } from "./document-list";
import { UploadForm } from "./upload-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">ReguLens</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload a licensing application to extract, verify, and review its contents.
        </p>
      </header>

      <Suspense fallback={<div className="h-32 rounded-lg border border-zinc-200 dark:border-zinc-800" />}>
        <UploadSection />
      </Suspense>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading documents…</p>}>
          <DocumentList />
        </Suspense>
      </section>
    </main>
  );
}

async function UploadSection() {
  // Read limits at request time so they follow the runtime environment, not the build.
  await connection();
  return <UploadForm maxUploadBytes={getEnv().maxUploadBytes} />;
}
