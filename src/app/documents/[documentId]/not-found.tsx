import Link from "next/link";

export default function DocumentNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Document not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        It may have been removed, or the link is incorrect.{" "}
        <Link href="/" className="underline underline-offset-2">
          Back to all documents
        </Link>
      </p>
    </main>
  );
}
