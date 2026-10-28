import { z } from "zod";
import { addressSchema } from "@/lib/schemas/extraction";
import { fieldKind, type FieldKind } from "@/lib/schemas/field-paths";
import { normalizeDate } from "@/server/validation/normalize";
import { normalizeValue } from "@/server/validation/validate";

// Checks an analyst's value for a field. Pure.
//
// A correction must have the field's shape, like an extracted value. Beyond that, only
// dates must parse: the analyst picks them from a date input, so an unreadable date is a
// typing error, not something the document says. Every other business rule (a state
// that is not a US state, ownership over 100%) is left to validation, which reports it
// as an issue that blocks approval, exactly as it would for an extracted value.

const text = z.string().trim().min(1);

const VALUE_SCHEMAS: Record<FieldKind, z.ZodType> = {
  text,
  date: text.refine((value) => normalizeDate(value) !== null),
  number: z.number(),
  address: addressSchema,
  text_list: z.array(text),
};

export type PreparedCorrection = { ok: true; value: unknown } | { ok: false };

/**
 * Parses the value and stores it in the same form the pipeline stores extracted values:
 * normalized when a normal form exists (ISO date, state code), else as entered. null
 * means the analyst states the value is not in the document.
 */
export function prepareCorrection(path: string, value: unknown): PreparedCorrection {
  if (value === null) return { ok: true, value: null };
  const parsed = VALUE_SCHEMAS[fieldKind(path)].safeParse(value);
  if (!parsed.success) return { ok: false };
  return { ok: true, value: normalizeValue(path, parsed.data) ?? parsed.data };
}
