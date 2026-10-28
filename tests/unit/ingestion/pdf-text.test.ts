import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { cleanPageText, readPdfText } from "@/server/ingestion/pdf-text";
import { buildApplicationPdf, buildScannedPdf } from "../../../scripts/samples/build";
import { harborline } from "../../../scripts/samples/fixtures";

const limits = { maxPages: 30 };

describe("readPdfText", () => {
  it("returns the text of each page in order", async () => {
    const result = await readPdfText(await buildApplicationPdf(harborline), limits);
    if (!result.ok) throw new Error(`unexpected ${result.code}`);

    expect(result.pageCount).toBe(4);
    expect(result.pages).toHaveLength(4);
    expect(result.hasTextLayer).toBe(true);
    expect(result.pages[0]).toContain("Legal Name of Applicant: Harborline Payments, Inc.");
    expect(result.pages[1]).toContain("License Number: MTL-2026-004417");
    expect(result.pages[2]).toContain("Full Name: Priya Raman");
    expect(result.pages[3]).toContain("Page 4 of 4");
  });

  it("does not consume the caller's buffer", async () => {
    // pdf.js detaches the ArrayBuffer it is given; the upload still needs the bytes.
    const bytes = await buildApplicationPdf(harborline);
    const length = bytes.length;
    await readPdfText(bytes, limits);
    expect(bytes.length).toBe(length);
  });

  it("reports a missing text layer instead of failing", async () => {
    const result = await readPdfText(await buildScannedPdf(2), limits);
    expect(result).toEqual({ ok: true, pageCount: 2, pages: ["", ""], hasTextLayer: false });
  });

  it("rejects documents over the page limit", async () => {
    const result = await readPdfText(await buildApplicationPdf(harborline), { maxPages: 3 });
    expect(result).toEqual({ ok: false, code: "too_many_pages" });
  });

  it("rejects bytes that are not a readable PDF", async () => {
    const corrupt = new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf");
    expect(await readPdfText(corrupt, limits)).toEqual({ ok: false, code: "invalid_pdf" });
  });

  it("rejects a truncated PDF", async () => {
    const bytes = await buildApplicationPdf(harborline);
    const result = await readPdfText(bytes.slice(0, Math.floor(bytes.length / 3)), limits);
    expect(result.ok).toBe(false);
  });

  it("accepts an empty-page PDF as having no text layer", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const result = await readPdfText(await pdf.save(), limits);
    expect(result).toMatchObject({ ok: true, pageCount: 1, hasTextLayer: false });
  });
});

describe("cleanPageText", () => {
  it("removes NUL characters, which Postgres text cannot store", () => {
    expect(cleanPageText("Legal\u0000 Name")).toBe("Legal Name");
  });
});
