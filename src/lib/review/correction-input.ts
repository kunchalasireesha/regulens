import type { FieldKind } from "@/lib/schemas/field-paths";

// Reads an analyst's correction out of a submitted form, by field kind. This only gives
// the input its shape (a number, a list of lines, an address object); whether the value
// is acceptable is decided on the server by the field's schema.

/** Control names of an address correction; every other kind uses a single "value". */
export const ADDRESS_PARTS = ["street", "unit", "city", "state", "postalCode"] as const;

export function readCorrectionInput(kind: FieldKind, form: FormData): unknown {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  switch (kind) {
    case "text":
    case "date":
      return text("value");
    case "number": {
      const value = text("value");
      // Number("") is 0; an empty input is a missing value, not zero.
      return value === "" ? undefined : Number(value);
    }
    case "text_list":
      // One name per line; an empty list means the document declares none.
      return text("value")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    case "address":
      return {
        street: text("street"),
        unit: text("unit") || null,
        city: text("city"),
        state: text("state"),
        postalCode: text("postalCode"),
      };
  }
}
