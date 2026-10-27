import { describe, expect, it } from "vitest";
import { checkFileBytes, sanitizeFilename } from "@/server/ingestion/file-checks";

const bytes = (text: string) => new TextEncoder().encode(text);
const limits = { maxUploadBytes: 1024 };

describe("checkFileBytes", () => {
  it("accepts bytes that start with the PDF header", () => {
    expect(checkFileBytes(bytes("%PDF-1.7\n..."), limits)).toBeNull();
  });

  it("rejects empty files", () => {
    expect(checkFileBytes(new Uint8Array(), limits)).toBe("empty_file");
  });

  it("rejects files over the size limit", () => {
    const big = new Uint8Array(1025);
    big.set(bytes("%PDF-"));
    expect(checkFileBytes(big, limits)).toBe("file_too_large");
  });

  it("checks content, not the file extension", () => {
    expect(checkFileBytes(bytes("PK\u0003\u0004 zip renamed to .pdf"), limits)).toBe("not_a_pdf");
    expect(checkFileBytes(bytes("%PD"), limits)).toBe("not_a_pdf");
  });
});

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("Harborline MTL application.pdf")).toBe("Harborline MTL application.pdf");
  });

  it("drops directory components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\app.pdf")).toBe("app.pdf");
  });

  it("removes control characters and collapses whitespace", () => {
    expect(sanitizeFilename("  bad\u0000\u001bname \n\t.pdf ")).toBe("badname .pdf");
  });

  it("falls back when nothing usable remains", () => {
    expect(sanitizeFilename("")).toBe("document.pdf");
    expect(sanitizeFilename("..")).toBe("document.pdf");
    expect(sanitizeFilename("dir/")).toBe("document.pdf");
  });

  it("caps the length without splitting characters", () => {
    const result = sanitizeFilename(`${"é".repeat(300)}.pdf`);
    expect([...result]).toHaveLength(200);
  });
});
