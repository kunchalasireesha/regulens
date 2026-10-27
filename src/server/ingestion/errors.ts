// Reasons an upload is rejected before anything is stored. Messages are safe to show
// to users: they describe the file, never internal state or raw parser errors.

export const UPLOAD_REJECTION_MESSAGES = {
  empty_file: "The file is empty.",
  file_too_large: "The file is larger than the upload limit.",
  not_a_pdf: "The file is not a PDF.",
  invalid_pdf: "The PDF is damaged or could not be read.",
  encrypted_pdf: "The PDF is password-protected. Upload an unprotected copy.",
  too_many_pages: "The PDF has more pages than the limit.",
} as const;

export type UploadRejectionCode = keyof typeof UPLOAD_REJECTION_MESSAGES;

/**
 * Failure codes stored on a document that was accepted but cannot be processed.
 * A scanned application is a legitimate submission, so it is kept and shown as
 * failed rather than rejected; OCR is out of scope.
 */
export const DOCUMENT_FAILURE_MESSAGES = {
  no_text_layer: "No selectable text was found. Scanned documents (OCR) are not supported yet.",
} as const;

export type DocumentFailureCode = keyof typeof DOCUMENT_FAILURE_MESSAGES;
