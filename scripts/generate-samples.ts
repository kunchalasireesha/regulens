import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildApplicationPdf, buildScannedPdf } from "./samples/build";
import { SAMPLE_APPLICATIONS } from "./samples/fixtures";

// Usage: pnpm samples
// Writes the fictional sample applications to samples/. Output is deterministic, so
// re-running this only changes files when the fixtures or layout change.

const OUT_DIR = "samples";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const outputs: [string, Uint8Array][] = [];
  for (const app of SAMPLE_APPLICATIONS) {
    outputs.push([`${app.slug}.pdf`, await buildApplicationPdf(app)]);
  }
  outputs.push(["scanned-no-text-layer.pdf", await buildScannedPdf()]);

  for (const [name, bytes] of outputs) {
    await writeFile(join(OUT_DIR, name), bytes);
    console.log(`wrote ${join(OUT_DIR, name)} (${bytes.length} bytes)`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
