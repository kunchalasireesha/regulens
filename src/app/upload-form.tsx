"use client";

import { useActionState, useState } from "react";
import { formatBytes } from "@/lib/format";
import { uploadDocumentAction, type UploadState } from "./actions";

const initialState: UploadState = { status: "idle" };

export function UploadForm({ maxUploadBytes }: { maxUploadBytes: number }) {
  const [state, formAction, pending] = useActionState(uploadDocumentAction, initialState);
  // Checked in the browser too, so an oversized file never hits the request body limit.
  const [clientError, setClientError] = useState<string | null>(null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const file = new FormData(event.currentTarget).get("file");
        if (file instanceof File && file.size > maxUploadBytes) {
          event.preventDefault();
          setClientError(`The file is larger than ${formatBytes(maxUploadBytes)}.`);
        } else {
          setClientError(null);
        }
      }}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
    >
      <label htmlFor="file" className="text-sm font-medium">
        Licensing application (PDF, up to {formatBytes(maxUploadBytes)})
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:hover:file:bg-zinc-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm">
        {clientError ? (
          <span className="text-red-700 dark:text-red-400">{clientError}</span>
        ) : (
          <StatusMessage state={state} />
        )}
      </p>
    </form>
  );
}

function StatusMessage({ state }: { state: UploadState }) {
  switch (state.status) {
    case "idle":
      return null;
    case "error":
      return <span className="text-red-700 dark:text-red-400">{state.message}</span>;
    case "duplicate":
      return (
        <span className="text-amber-700 dark:text-amber-400">
          This file was already uploaded as “{state.document.filename}”. No new document was created.
        </span>
      );
    case "created":
      return state.document.failed ? (
        <span className="text-amber-700 dark:text-amber-400">
          Uploaded “{state.document.filename}”, but no text could be read from it.
        </span>
      ) : (
        <span className="text-green-700 dark:text-green-400">
          Uploaded “{state.document.filename}” ({state.document.pageCount} pages). Extraction has
          started; the status below updates when it finishes.
        </span>
      );
  }
}
