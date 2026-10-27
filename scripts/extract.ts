import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fieldLabel, listFields } from "../src/lib/schemas/field-paths";
import { verifyResultEvidence } from "../src/server/evidence/verify";
import { createExtractionProvider } from "../src/server/extraction/create-provider";
import { EXTRACTION_ERROR_MESSAGES } from "../src/server/extraction/errors";
import { runExtraction } from "../src/server/extraction/run";
import { parseEnv } from "../src/server/env";
import { readPdfText } from "../src/server/ingestion/pdf-text";
import { validateExtraction } from "../src/server/validation/validate";

// Usage: pnpm extract <file.pdf> [--mock]
// Runs page-text extraction, AI extraction, evidence verification, and validation on a
// local PDF and prints the result, a review report, and run metrics. Nothing is stored. Uses Gemini when GEMINI_API_KEY is set in
// .env.local, otherwise (or with --mock) the offline mock provider.
//
// Free-tier inputs may be used by Google to improve its products: synthetic documents only.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mock: { type: "boolean", default: false } },
  });
  const file = positionals[0];
  if (!file) throw new Error("Usage: pnpm extract <file.pdf> [--mock]");

  const env = parseEnv(process.env);
  const provider = createExtractionProvider(values.mock ? { kind: "mock" } : env.ai);

  const parsed = await readPdfText(new Uint8Array(readFileSync(file)), env);
  if (!parsed.ok) throw new Error(`Cannot read PDF: ${parsed.code}`);

  console.error(`extracting ${parsed.pageCount} pages with ${provider.name} (${provider.model})…`);
  const outcome = await runExtraction(provider, parsed.pages);

  if (outcome.status === "succeeded") {
    console.log(JSON.stringify(outcome.result, null, 2));
    printReport(parsed.pages, outcome.result);
  } else {
    console.error(`failed: ${outcome.errorCode}: ${EXTRACTION_ERROR_MESSAGES[outcome.errorCode]}`);
    if (outcome.issuePaths.length > 0) {
      console.error(`invalid fields: ${outcome.issuePaths.join(", ")}`);
    }
  }
  const { latencyMs, usage, estimatedCostUsd } = outcome;
  console.error(
    `latency ${latencyMs} ms · tokens in ${usage?.inputTokens ?? "n/a"} / out ${usage?.outputTokens ?? "n/a"}` +
      ` · paid-tier cost estimate ${estimatedCostUsd === null ? "n/a" : `$${estimatedCostUsd.toFixed(6)}`}`,
  );
  if (outcome.status === "failed") process.exitCode = 1;
}

/** Per-field statuses and validation issues, as an analyst would see them in review. */
function printReport(pages: string[], result: Parameters<typeof listFields>[0]) {
  const evidence = verifyResultEvidence(pages, result);
  const report = validateExtraction(result, evidence);

  console.error("\nfields (extraction · evidence · validation):");
  for (const { path, field } of listFields(result)) {
    const fieldEvidence = evidence.get(path)!;
    const corrected = fieldEvidence.checks
      .filter((c) => c.verification === "page_corrected")
      .map((c) => ` (cited p.${c.citedPage}, found p.${c.matchedPage})`)
      .join("");
    const validation = report.fields.get(path)!;
    console.error(
      `  ${fieldLabel(path).padEnd(38)} ${field.status.padEnd(9)} · ` +
        `${fieldEvidence.evidenceStatus.padEnd(14)} · ${validation.validationStatus}${corrected}`,
    );
  }

  console.error(`\nissues (${report.issues.length}):`);
  for (const issue of report.issues) {
    console.error(`  [${issue.severity}] ${issue.ruleId}: ${issue.message}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
