import { connection } from "next/server";
import { formatTimestamp } from "@/lib/format";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getDb } from "@/server/db/client";
import { getExtractionStats } from "@/server/db/queries/dashboard";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Per provider and model: how often extraction succeeds, how long it takes, what it would cost. */
export async function ExtractionStats() {
  await connection();
  const db = getDb();
  const actor = await getCurrentActor(db);
  const stats = await getExtractionStats(db, actor.organizationId);

  if (stats.length === 0) {
    return <p className="text-sm text-zinc-500">No extraction runs yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="py-2 pr-4 font-medium">Model</th>
            <th className="py-2 pr-4 text-right font-medium">Runs</th>
            <th className="py-2 pr-4 text-right font-medium">Succeeded</th>
            <th className="py-2 pr-4 text-right font-medium">Median latency</th>
            <th className="py-2 pr-4 text-right font-medium">Tokens in / out</th>
            <th className="py-2 pr-4 text-right font-medium" title="At paid-tier list prices">
              Est. cost
            </th>
            <th className="py-2 font-medium">Last run</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {stats.map((row) => (
            <tr key={`${row.provider}/${row.model}`} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4">
                <span className="font-medium">{row.model}</span>
                <span className="ml-2 text-xs text-zinc-500">{row.provider}</span>
              </td>
              <td className="py-2 pr-4 text-right">{row.runs}</td>
              <td className="py-2 pr-4 text-right">
                {row.succeeded} ({Math.round((row.succeeded / row.runs) * 100)}%)
              </td>
              <td className="py-2 pr-4 text-right">
                {row.medianLatencyMs === null ? "–" : `${(row.medianLatencyMs / 1000).toFixed(1)} s`}
              </td>
              <td className="py-2 pr-4 text-right">
                {row.inputTokens.toLocaleString("en-US")} / {row.outputTokens.toLocaleString("en-US")}
              </td>
              <td className="py-2 pr-4 text-right">
                {row.estimatedCostUsd === null ? "–" : usd.format(Number(row.estimatedCostUsd))}
              </td>
              <td className="py-2 whitespace-nowrap text-zinc-500">
                {row.lastRunAt && (
                  <time dateTime={row.lastRunAt.toISOString()}>{formatTimestamp(row.lastRunAt)}</time>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-zinc-500">
        Cost is what the runs would cost at paid-tier list prices; free-tier runs are not billed.
      </p>
    </div>
  );
}
