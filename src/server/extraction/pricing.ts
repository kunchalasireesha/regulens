import type { TokenUsage } from "./provider";

// Paid-tier list prices, used to report what a run *would* cost. Free-tier runs cost
// nothing; the estimate exists so cost per document can be tracked before any move to
// paid usage. Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-25).

type Price = { from: string; inputPerMTok: number; outputPerMTok: number };

/** Per model, oldest first. Each entry applies from its date until the next one. */
const PRICES: Record<string, Price[]> = {
  "gemini-3.8-flash": [
    // Introductory pricing, half the standard rate.
    { from: "2026-01-01", inputPerMTok: 0.75, outputPerMTok: 3.75 },
    { from: "2027-01-01", inputPerMTok: 1.5, outputPerMTok: 7.5 },
  ],
};

/** Returns null for models without a known price or runs without reported usage. */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage | null,
  at: Date = new Date(),
): number | null {
  if (!usage) return null;
  const day = at.toISOString().slice(0, 10);
  const price = PRICES[model]?.findLast((entry) => entry.from <= day);
  if (!price) return null;
  const cost =
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1e6;
  // numeric(12, 6) in the database.
  return Math.round(cost * 1e6) / 1e6;
}
