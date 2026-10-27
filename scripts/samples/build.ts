import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SampleAddress, SampleApplication } from "./fixtures";

// Renders a fictional "Form MTL-1" money transmitter license application.
//
// Content is placed on fixed pages so evidence page numbers are predictable:
//   1. Business information    2. Addresses and license request
//   3. Control persons         4. Attestation
//
// Output is byte-for-byte deterministic (fixed metadata dates, no producer stamp), so
// regenerating the samples does not change their SHA-256 and duplicate detection can
// be demonstrated with committed files.

const PAGE_WIDTH = 612; // US Letter, in points
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
const FORM_NAME = "Form MTL-1 (Sample)";

type Fonts = { regular: PDFFont; bold: PDFFont };

async function createDocument(title: string) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(title);
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  return pdf;
}

/** Writes lines top to bottom on one page. */
class PageWriter {
  private y = PAGE_HEIGHT - MARGIN;

  constructor(
    private readonly page: PDFPage,
    private readonly fonts: Fonts,
  ) {}

  title(text: string) {
    this.line(text, { font: this.fonts.bold, size: 16, gapAfter: 6 });
  }

  section(text: string) {
    this.y -= 14;
    this.line(text, { font: this.fonts.bold, size: 12, gapAfter: 4 });
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 8 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y + 8 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    this.y -= 6;
  }

  /** "Label: value", with continuation lines indented under the value. */
  field(label: string, value: string | string[]) {
    const values = Array.isArray(value) ? value : [value];
    const labelText = `${label}:`;
    const valueX = MARGIN + 190;
    this.page.drawText(labelText, { x: MARGIN, y: this.y, size: 10, font: this.fonts.bold });
    values.forEach((text, i) => {
      if (i > 0) this.y -= 14;
      this.page.drawText(text, { x: valueX, y: this.y, size: 10, font: this.fonts.regular });
    });
    this.y -= 18;
  }

  paragraph(text: string) {
    for (const line of wrap(text, this.fonts.regular, 10, PAGE_WIDTH - 2 * MARGIN)) {
      this.line(line, { font: this.fonts.regular, size: 10, gapAfter: 4 });
    }
    this.y -= 8;
  }

  line(text: string, { font, size, gapAfter }: { font: PDFFont; size: number; gapAfter: number }) {
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font });
    this.y -= size + gapAfter;
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatAddress(address: SampleAddress): string[] {
  const street = address.unit ? `${address.street}, ${address.unit}` : address.street;
  return [street, `${address.city}, ${address.state} ${address.postalCode}`];
}

function drawFooter(page: PDFPage, fonts: Fonts, pageNumber: number, pageCount: number) {
  const size = 8;
  const color = rgb(0.4, 0.4, 0.4);
  page.drawText("SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY", {
    x: MARGIN,
    y: 40,
    size,
    font: fonts.regular,
    color,
  });
  const label = `${FORM_NAME}  |  Page ${pageNumber} of ${pageCount}`;
  page.drawText(label, {
    x: PAGE_WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(label, size),
    y: 40,
    size,
    font: fonts.regular,
    color,
  });
}

export async function buildApplicationPdf(app: SampleApplication): Promise<Uint8Array> {
  const pdf = await createDocument(`Money Transmitter License Application - ${app.business.legalName}`);
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const newPage = () => new PageWriter(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), fonts);
  const { business, licensing, people } = app;

  const p1 = newPage();
  p1.line("Department of Financial Regulation (Fictional)", {
    font: fonts.regular,
    size: 10,
    gapAfter: 6,
  });
  p1.title("Money Transmitter License Application");
  p1.line(FORM_NAME, { font: fonts.regular, size: 10, gapAfter: 4 });
  p1.paragraph(
    "Complete all parts of this application. Attach additional sheets where necessary. " +
      "Applications missing required information will be returned to the applicant.",
  );
  p1.section("Part 1. Business Information");
  p1.field("Legal Name of Applicant", business.legalName);
  p1.field("DBA / Trade Names", business.dbaNames.length > 0 ? business.dbaNames : "None");
  p1.field("Jurisdiction of Formation", business.formationJurisdiction);
  p1.field("Date of Formation", business.formationDate);

  const p2 = newPage();
  p2.section("Part 2. Addresses");
  p2.field("Registered Office Address", formatAddress(business.registeredAddress));
  p2.field("Principal Place of Business", formatAddress(business.principalAddress));
  p2.section("Part 3. License Request");
  p2.field("License Type Requested", licensing.licenseType);
  p2.field("License Number", licensing.licenseNumber ?? "Not yet assigned");
  p2.field("Application Date", licensing.applicationDate);
  p2.field("Requested Expiration Date", licensing.expirationDate ?? "Not applicable");

  const p3 = newPage();
  p3.section("Part 4. Control Persons");
  p3.paragraph(
    "List each officer, director, and each person who directly or indirectly owns 10% " +
      "or more of the applicant.",
  );
  people.forEach((person, i) => {
    p3.line(`Control Person ${i + 1}`, { font: fonts.bold, size: 11, gapAfter: 6 });
    p3.field("Full Name", person.name);
    p3.field("Title", person.title);
    p3.field(
      "Ownership Percentage",
      person.ownershipPercentage === null ? "Not stated" : `${person.ownershipPercentage}%`,
    );
    p3.field("Relationship to Applicant", person.relationship);
  });

  const p4 = newPage();
  p4.section("Part 5. Attestation");
  p4.paragraph(
    `The undersigned, on behalf of ${business.legalName}, certifies that the information ` +
      "in this application is true, complete, and correct to the best of their knowledge.",
  );
  const signer = people[0];
  if (signer) {
    p4.field("Signature", `/s/ ${signer.name}`);
    p4.field("Name and Title", `${signer.name}, ${signer.title}`);
  }
  p4.field("Date", licensing.applicationDate);

  const pages = pdf.getPages();
  pages.forEach((page, i) => drawFooter(page, fonts, i + 1, pages.length));
  return pdf.save();
}

/**
 * A PDF with no text layer, like a scanned paper form: grey bars where text would be,
 * and no fonts. Used to exercise the "no text layer" failure path (OCR is out of scope).
 */
export async function buildScannedPdf(pageCount = 2): Promise<Uint8Array> {
  const pdf = await createDocument("Scanned application (no text layer)");
  for (let p = 0; p < pageCount; p++) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    for (let row = 0; row < 24; row++) {
      const width = 200 + ((row * 97 + p * 31) % 260);
      page.drawRectangle({
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - row * 26,
        width,
        height: 9,
        color: rgb(0.75, 0.75, 0.75),
      });
    }
  }
  return pdf.save();
}
