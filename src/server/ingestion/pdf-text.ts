import { extractText, getDocumentProxy } from "unpdf";
import type { UploadRejectionCode } from "./errors";

export type PdfTextResult =
  | {
      ok: true;
      pageCount: number;
      /** Text per page; index 0 is page 1. */
      pages: string[];
      /** False when no page has any text, e.g. a scanned document. */
      hasTextLayer: boolean;
    }
  | { ok: false; code: Extract<UploadRejectionCode, "invalid_pdf" | "encrypted_pdf" | "too_many_pages"> };

/**
 * Extracts the text layer of each page. Checks the page count before reading any
 * text, so an oversized document is rejected without doing the expensive work.
 */
export async function readPdfText(
  bytes: Uint8Array,
  limits: { maxPages: number },
): Promise<PdfTextResult> {
  let pdf;
  try {
    // pdf.js takes ownership of (detaches) the buffer it is given, so pass a copy:
    // the caller still needs the bytes to store the file.
    pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0 });
  } catch (error) {
    return { ok: false, code: isPasswordError(error) ? "encrypted_pdf" : "invalid_pdf" };
  }

  try {
    if (pdf.numPages > limits.maxPages) return { ok: false, code: "too_many_pages" };
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map(cleanPageText);
    return {
      ok: true,
      pageCount: totalPages,
      pages,
      hasTextLayer: pages.some((page) => page.trim() !== ""),
    };
  } catch {
    return { ok: false, code: "invalid_pdf" };
  } finally {
    // Release pdf.js resources (parsed objects, fonts) for this document.
    await pdf.loadingTask.destroy();
  }
}

/** Postgres text columns cannot store NUL characters, which some PDFs emit. */
export function cleanPageText(text: string): string {
  return text.replaceAll("\u0000", "");
}

function isPasswordError(error: unknown): boolean {
  return error instanceof Error && error.name === "PasswordException";
}
