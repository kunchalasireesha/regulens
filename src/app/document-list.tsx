import Link from "next/link";
import { connection } from "next/server";
import { formatBytes, formatTimestamp } from "@/lib/format";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { listRecentDocuments } from "@/server/db/queries/documents";
import { DocumentStatus, isInFlight } from "./document-status";
import { RefreshWhileProcessing } from "./refresh-while-processing";

export async function DocumentList() {
  // Database reads must happen per request, not during prerendering.
  await connection();
  const db = getDb();
  const actor = await getCurrentActor(db);
  const documents = await listRecentDocuments(db, actor.organizationId);

  if (documents.length === 0) {
    return <p className="text-sm text-zinc-500">No documents yet. Upload a sample from samples/.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <RefreshWhileProcessing active={documents.some(isInFlight)} />
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="py-2 pr-4 font-medium">File</th>
            <th className="py-2 pr-4 font-medium">Pages</th>
            <th className="py-2 pr-4 font-medium">Size</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
              <td className="py-2 pr-4 font-medium break-all">
                <Link href={`/documents/${doc.id}`} className="underline-offset-2 hover:underline">
                  {doc.filename}
                </Link>
              </td>
              <td className="py-2 pr-4 tabular-nums">{doc.pageCount ?? "–"}</td>
              <td className="py-2 pr-4 tabular-nums">{formatBytes(doc.sizeBytes)}</td>
              <td className="py-2 pr-4">
                <DocumentStatus doc={doc} />
              </td>
              <td className="py-2 whitespace-nowrap text-zinc-500">
                <time dateTime={doc.createdAt.toISOString()}>{formatTimestamp(doc.createdAt)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
