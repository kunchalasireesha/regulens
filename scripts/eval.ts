import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXTRACTION_SCHEMA_VERSION } from "../src/lib/schemas/extraction";
import { createExtractionProvider } from "../src/server/extraction/create-provider";
import { runExtraction, type ExtractionOutcome } from "../src/server/extraction/run";
import { parseEnv } from "../src/server/env";
import {
  CORRECT_OUTCOMES,
  scoreDocument,
  summarize,
  type DocumentScore,
  type EvalSummary,
  type FieldScore,
} from "../src/server/eval/score";
import { readPdfText } from "../src/server/ingestion/pdf-text";
import { SAMPLE_APPLICATIONS } from "./samples/fixtures";
import { groundTruthOf } from "./samples/ground-truth";

// Usage: pnpm eval [--mock] [--json <file>]
// Runs extraction on every sample in samples/ and scores it against the fixtures the PDFs
// were rendered from: field accuracy, evidence, whether errors were flagged, and whether
// validation raises the same issues as on the true values. Nothing is stored in the
// database. Uses Gemini when GEMINI_API_KEY is set in .env.local, otherwise (or with
// --mock) the offline mock provider, which should score 100%.
//
// Calls the model once per sample (4 requests), well within the free tier's limits.
// Free-tier inputs may be used by Google to improve its products: synthetic documents only.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

type RunMetadata = {
  status: ExtractionOutcome["status"];
  errorCode: string | null;
  latencyMs: number;
  usage: ExtractionOutcome["usage"];
  estimatedCostUsd: number | null;
};

type DocumentRun = { slug: string; run: RunMetadata; score: DocumentScore };

type RunTotals = {
  succeeded: number;
  medianLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

async function main() {
  const { values } = parseArgs({
    options: {
      mock: { type: "boolean", default: false },
      json: { type: "string" },
    },
  });

  const env = parseEnv(process.env);
  const provider = createExtractionProvider(values.mock ? { kind: "mock" } : env.ai);
  console.error(`evaluating ${SAMPLE_APPLICATIONS.length} samples with ${provider.name} (${provider.model})…\n`);

  const runs: DocumentRun[] = [];
  for (const app of SAMPLE_APPLICATIONS) {
    const parsed = await readPdfText(new Uint8Array(readFileSync(`samples/${app.slug}.pdf`)), env);
    if (!parsed.ok) throw new Error(`Cannot read samples/${app.slug}.pdf: ${parsed.code}`);

    const outcome = await runExtraction(provider, parsed.pages);
    const actual = outcome.status === "succeeded" ? outcome.result : null;
    const score = scoreDocument(parsed.pages, groundTruthOf(app), actual);
    const run: RunMetadata = {
      status: outcome.status,
      errorCode: outcome.status === "failed" ? outcome.errorCode : null,
      latencyMs: outcome.latencyMs,
      usage: outcome.usage,
      estimatedCostUsd: outcome.estimatedCostUsd,
    };
    runs.push({ slug: app.slug, run, score });
    printDocument(app.slug, run, score);
  }

  const summary = summarize(runs.map((run) => run.score));
  const succeeded = runs.filter(({ run }) => run.status === "succeeded");
  const latencies = succeeded.map(({ run }) => run.latencyMs).sort((a, b) => a - b);
  const usage = runs.flatMap(({ run }) => (run.usage ? [run.usage] : []));
  const costs = runs.flatMap(({ run }) => (run.estimatedCostUsd === null ? [] : [run.estimatedCostUsd]));
  const metrics: RunTotals = {
    succeeded: succeeded.length,
    medianLatencyMs: latencies.length === 0 ? null : latencies[Math.floor((latencies.length - 1) / 2)]!,
    inputTokens: usage.length === 0 ? null : usage.reduce((sum, u) => sum + u.inputTokens, 0),
    outputTokens: usage.length === 0 ? null : usage.reduce((sum, u) => sum + u.outputTokens, 0),
    estimatedCostUsd: costs.length === 0 ? null : costs.reduce((sum, c) => sum + c, 0),
  };
  printSummary(summary, metrics);

  if (values.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      provider: provider.name,
      model: provider.model,
      promptVersion: provider.promptVersion,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      metrics,
      summary,
      documents: runs,
    };
    writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`\nwrote ${values.json}`);
  }
}

function printDocument(slug: string, run: RunMetadata, score: DocumentScore) {
  const correct = score.fields.filter((f) => CORRECT_OUTCOMES.has(f.outcome)).length;
  const status = run.status === "succeeded" ? "ok" : `FAILED ${run.errorCode}`;
  const tokens = run.usage ? ` · tokens ${run.usage.inputTokens} in / ${run.usage.outputTokens} out` : "";
  console.log(
    `${slug.padEnd(22)} ${status.padEnd(6)} ${correct}/${score.fields.length} fields correct · ${run.latencyMs} ms${tokens}`,
  );

  // Synthetic documents, so printing values is safe and makes errors easy to read.
  for (const field of score.fields) {
    if (CORRECT_OUTCOMES.has(field.outcome) || field.outcome === "no_result") continue;
    console.log(
      `  ${field.outcome.padEnd(11)} ${field.path.padEnd(32)} ${field.flagged ? "flagged  " : "UNFLAGGED"}` +
        `  expected ${describe(field.expected)} · got ${describe(field.actual)}`,
    );
  }
  for (const key of score.issues.missed) console.log(`  issue missed   ${key}`);
  for (const key of score.issues.extra) console.log(`  issue extra    ${key}`);
}

function describe(field: FieldScore["expected"]): string {
  if (!field || field.status === "not_found") return "not_found";
  if (field.status === "ambiguous") return `ambiguous ${JSON.stringify(field.candidates.map((c) => c.value))}`;
  return JSON.stringify(field.value);
}

function printSummary(summary: EvalSummary, metrics: RunTotals) {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
  const { byOutcome: o, evidence, errors, issues } = summary;

  console.log(`\nsummary (${summary.documents} documents, ${metrics.succeeded} extracted)`);
  console.log(`  field accuracy     ${summary.correct}/${summary.fields} (${pct(summary.correct, summary.fields)})`);
  console.log(
    `    correct ${o.correct} · correct absent ${o.correct_absent} · wrong ${o.wrong_value} · missed ${o.missed}` +
      ` · invented ${o.invented} · ambiguous ${o.ambiguous} · no result ${o.no_result}`,
  );
  console.log(`  evidence located   ${evidence.located}/${evidence.cited} (${pct(evidence.located, evidence.cited)})`);
  console.log(`  errors flagged     ${errors.flagged}/${errors.total} (${pct(errors.flagged, errors.total)})`);
  console.log(
    `  issues             matched ${issues.matched}/${issues.expected} (${pct(issues.matched, issues.expected)})` +
      ` · missed ${issues.missed} · extra ${issues.extra}`,
  );
  console.log(
    `  run                median latency ${metrics.medianLatencyMs ?? "n/a"} ms · tokens ${metrics.inputTokens ?? "n/a"} in /` +
      ` ${metrics.outputTokens ?? "n/a"} out · paid-tier estimate ` +
      (metrics.estimatedCostUsd === null ? "n/a" : `$${metrics.estimatedCostUsd.toFixed(6)}`),
  );

  const weak = summary.byField.filter((f) => f.correct < f.fields);
  console.log(weak.length === 0 ? "\nevery field type fully correct" : "\nfield types with errors:");
  for (const f of weak) console.log(`  ${f.key.padEnd(32)} ${f.correct}/${f.fields}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
