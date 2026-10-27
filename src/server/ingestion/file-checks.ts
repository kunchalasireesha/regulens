import type { UploadRejectionCode } from "./errors";

// Cheap checks that run before the file is parsed. They look at bytes, not at the
// client-supplied name or MIME type, both of which the browser lets users control.

const PDF_MAGIC = new TextEncoder().encode("%PDF-");
const MAX_FILENAME_LENGTH = 200;
const FALLBACK_FILENAME = "document.pdf";

export function checkFileBytes(
  bytes: Uint8Array,
  limits: { maxUploadBytes: number },
): UploadRejectionCode | null {
  if (bytes.length === 0) return "empty_file";
  if (bytes.length > limits.maxUploadBytes) return "file_too_large";
  if (!PDF_MAGIC.every((byte, i) => bytes[i] === byte)) return "not_a_pdf";
  return null;
}

/**
 * Cleans a client-supplied filename for display. The name is never used to build a
 * storage path (files are stored by content hash), so this is about readability and
 * keeping control characters out of the UI and database, not path safety.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  // Drop control characters, collapse whitespace.
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return FALLBACK_FILENAME;
  return [...cleaned].slice(0, MAX_FILENAME_LENGTH).join("");
}
