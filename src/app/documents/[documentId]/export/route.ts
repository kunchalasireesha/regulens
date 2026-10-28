import { findCurrentUser } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { getDocumentReview } from "@/server/db/queries/review";
import { buildExport } from "@/server/export/build-export";

/**
 * Downloads an approved document as JSON. Anything not approved is refused with 409, so
 * an unreviewed extraction can never leave the system looking like a finished record.
 */
export async function GET(_request: Request, ctx: RouteContext<"/documents/[documentId]/export">) {
  const { documentId } = await ctx.params;
  const db = getDb();
  // A download has no page to redirect, so a missing session is a plain 401.
  const user = await findCurrentUser(db);
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const review = await getDocumentReview(db, user.organizationId, documentId);
  // Another organization's document and a malformed id look the same as a missing one.
  if (!review) return Response.json({ error: "not_found" }, { status: 404 });
  if (review.document.reviewStatus !== "approved") {
    return Response.json({ error: "not_approved" }, { status: 409 });
  }

  const filename = `${review.document.filename.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_")}.json`;
  return new Response(JSON.stringify(buildExport(review), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
