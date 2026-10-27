import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildApplicationPdf, buildScannedPdf } from "../../../scripts/samples/build";
import { SAMPLE_APPLICATIONS } from "../../../scripts/samples/fixtures";

describe("sample PDFs", () => {
  it("are byte-for-byte deterministic", async () => {
    for (const app of SAMPLE_APPLICATIONS) {
      expect(await buildApplicationPdf(app)).toEqual(await buildApplicationPdf(app));
    }
  });

  it("match the committed files in samples/ (run `pnpm samples` if this fails)", async () => {
    for (const app of SAMPLE_APPLICATIONS) {
      const committed = new Uint8Array(await readFile(`samples/${app.slug}.pdf`));
      expect(committed).toEqual(await buildApplicationPdf(app));
    }
    const scanned = new Uint8Array(await readFile("samples/scanned-no-text-layer.pdf"));
    expect(scanned).toEqual(await buildScannedPdf());
  });
});
