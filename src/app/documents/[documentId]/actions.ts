"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { readCorrectionInput } from "@/lib/review/correction-input";
import { fieldKind } from "@/lib/schemas/field-paths";
import { getCurrentActor, type Actor } from "@/server/auth/current-actor";
import { getDb, type Database } from "@/server/db/client";
import {
  acceptField,
  approveDocument,
  correctField,
  rejectDocument,
  resolveIssue,
  type Correction,
  type ReviewResult,
} from "@/server/review/commands";
import { INVALID_VALUE_MESSAGES, REVIEW_ERROR_MESSAGES } from "@/server/review/errors";

// Thin adapters between the review forms and src/server/review: read and check the form,
// resolve the actor, run the command, and turn its result into something to display.
// The rules themselves (what may change, approval, the audit log) live in the commands.

export type ReviewActionState = { status: "idle" } | { status: "ok" } | { status: "error"; message: string };

const documentId = z.uuid();
const fieldPath = z.string().min(1).max(100);
const note = z.string().max(2000).optional();

const fieldInput = z.object({ documentId, fieldPath });
const correctionInput = z.object({
  documentId,
  fieldPath,
  mode: z.enum(["value", "candidate", "not_stated"]),
  candidateIndex: z.coerce.number().int().min(0).optional(),
  note,
});
const issueInput = z.object({
  documentId,
  issueId: z.uuid(),
  resolution: z.enum(["confirmed", "accepted_unresolved"]),
  note,
});
const approveInput = z.object({ documentId, note });
const rejectInput = z.object({ documentId, note: z.string().max(2000) });

export async function acceptFieldAction(_previous: ReviewActionState, formData: FormData) {
  const input = fieldInput.safeParse(formFields(formData));
  if (!input.success) return invalidRequest();
  return run((db, actor) => acceptField(db, actor, input.data));
}

export async function correctFieldAction(_previous: ReviewActionState, formData: FormData) {
  const input = correctionInput.safeParse(formFields(formData));
  if (!input.success) return invalidRequest();
  const { mode, candidateIndex, ...rest } = input.data;

  let correction: Correction;
  if (mode === "candidate") {
    if (candidateIndex === undefined) return invalidRequest();
    correction = { candidateIndex };
  } else {
    correction = { value: mode === "not_stated" ? null : readCorrectionInput(fieldKind(rest.fieldPath), formData) };
  }
  return run((db, actor) => correctField(db, actor, { ...rest, correction }), rest.fieldPath);
}

export async function resolveIssueAction(_previous: ReviewActionState, formData: FormData) {
  const input = issueInput.safeParse(formFields(formData));
  if (!input.success) return invalidRequest();
  return run((db, actor) => resolveIssue(db, actor, input.data));
}

export async function approveDocumentAction(_previous: ReviewActionState, formData: FormData) {
  const input = approveInput.safeParse(formFields(formData));
  if (!input.success) return invalidRequest();
  return run((db, actor) => approveDocument(db, actor, input.data));
}

export async function rejectDocumentAction(_previous: ReviewActionState, formData: FormData) {
  const input = rejectInput.safeParse(formFields(formData));
  if (!input.success) return invalidRequest();
  return run((db, actor) => rejectDocument(db, actor, input.data));
}

/** Text entries of a form, with empty inputs dropped so optional fields read as absent. */
function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && value !== "") fields[key] = value;
  }
  return fields;
}

async function run(
  command: (db: Database, actor: Actor) => Promise<ReviewResult>,
  fieldPath?: string,
): Promise<ReviewActionState> {
  const db = getDb();
  // Outside the try: it redirects to the login page when the session has ended.
  const actor = await getCurrentActor(db);
  try {
    const result = await command(db, actor);
    if (!result.ok) {
      const message =
        result.code === "invalid_value" && fieldPath
          ? INVALID_VALUE_MESSAGES[fieldKind(fieldPath)]
          : REVIEW_ERROR_MESSAGES[result.code];
      return { status: "error", message };
    }
    // Re-render the page so it shows the new values, issues, and history.
    refresh();
    return { status: "ok" };
  } catch (error) {
    // Only the error class: database errors can carry query parameters (document values).
    console.error("review action failed", { error: error instanceof Error ? error.name : typeof error });
    return { status: "error", message: "The change could not be saved. Please try again." };
  }
}

function invalidRequest(): ReviewActionState {
  return { status: "error", message: "The request was not valid. Reload the page and try again." };
}
