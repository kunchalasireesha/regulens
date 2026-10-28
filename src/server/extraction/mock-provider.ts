import type { ExtractionProvider, ExtractionRequest, ProviderResponse } from "./provider";
import type { ProviderField, ProviderResult } from "./response-schema";

// Offline stand-in for a model, used when no API key is configured and in tests.
//
// It reads "Label: value" lines from the sample Form MTL-1 layout (scripts/samples) and
// answers in the same flat JSON a model would, so its output goes through the same
// parsing and validation as a real response. It is not a general extractor: on any other
// layout every field comes back not_found, which is the honest answer for a mock.

type Line = { page: number; text: string };
type Address = NonNullable<ProviderResult["business"]["registeredAddress"]["value"]>;

const LABEL = /^([A-Z][A-Za-z /]*): (.*)$/;
const BLOCK_START = /^(Part \d+\.|Control Person \d+$|SYNTHETIC DOCUMENT)/;
const ABSENT = new Set(["Not yet assigned", "Not applicable", "Not stated"]);

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = "mock";
  readonly model = "mock-form-mtl-1";
  readonly promptVersion = "none";

  async generate({ pages }: ExtractionRequest): Promise<ProviderResponse> {
    const lines = pages.flatMap((text, i) =>
      text.split("\n").map((line) => ({ page: i + 1, text: line.trim() })),
    );
    return { text: JSON.stringify(extract(lines)), usage: null };
  }
}

function extract(lines: Line[]): ProviderResult {
  const controlPersonStarts = lines.flatMap((line, i) =>
    /^Control Person \d+$/.test(line.text) ? [i] : [],
  );
  const people = controlPersonStarts.map((start, n) => {
    const block = lines.slice(start + 1, controlPersonStarts[n + 1] ?? lines.length);
    return {
      name: textField(block, "Full Name"),
      title: textField(block, "Title"),
      ownershipPercentage: field(block, "Ownership Percentage", (value) => {
        const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
        return match ? Number(match[1]) : null;
      }),
      relationship: textField(block, "Relationship to Applicant"),
    };
  });

  return {
    business: {
      legalName: textField(lines, "Legal Name of Applicant"),
      dbaNames: field(lines, "DBA / Trade Names", (value, more) =>
        value === "None" ? [] : [value, ...more],
      ),
      formationJurisdiction: textField(lines, "Jurisdiction of Formation"),
      formationDate: textField(lines, "Date of Formation"),
      registeredAddress: field(lines, "Registered Office Address", parseAddress),
      principalAddress: field(lines, "Principal Place of Business", parseAddress),
    },
    licensing: {
      licenseType: textField(lines, "License Type Requested"),
      licenseNumber: textField(lines, "License Number"),
      applicationDate: textField(lines, "Application Date"),
      expirationDate: textField(lines, "Requested Expiration Date"),
    },
    people,
  };
}

function textField(lines: Line[], label: string): ProviderField<string> {
  return field(lines, label, (value, more) => [value, ...more].join(" "));
}

/**
 * Finds the first "label: value" line and parses its value plus any unlabeled
 * continuation lines. The quote is the label line and its continuations, verbatim.
 */
function field<T>(
  lines: Line[],
  label: string,
  parse: (value: string, continuation: string[]) => T | null,
): ProviderField<T> {
  const notFound: ProviderField<T> = {
    status: "not_found",
    value: null,
    evidence: [],
    candidates: [],
  };
  const index = lines.findIndex((line) => LABEL.exec(line.text)?.[1] === label);
  const line = lines[index];
  if (!line) return notFound;

  const value = LABEL.exec(line.text)?.[2]?.trim() ?? "";
  if (ABSENT.has(value)) return notFound;

  const continuation: string[] = [];
  for (const next of lines.slice(index + 1)) {
    if (next.page !== line.page || !next.text || LABEL.test(next.text)) break;
    if (BLOCK_START.test(next.text)) break;
    continuation.push(next.text);
  }

  const parsed = parse(value, continuation);
  if (parsed === null) return notFound;
  return {
    status: "found",
    value: parsed,
    evidence: [{ page: line.page, quote: [line.text, ...continuation].join("\n") }],
    candidates: [],
  };
}

/** "455 Market Street, Suite 1200" / "San Francisco, CA 94105" */
function parseAddress(firstLine: string, continuation: string[]): Address | null {
  const cityLine = /^(.+), (\S+) (\S+)$/.exec(continuation[0] ?? "");
  if (!cityLine) return null;
  const [street = firstLine, ...unit] = firstLine.split(", ");
  return {
    street,
    unit: unit.length > 0 ? unit.join(", ") : null,
    city: cityLine[1]!,
    state: cityLine[2]!,
    postalCode: cityLine[3]!,
  };
}
