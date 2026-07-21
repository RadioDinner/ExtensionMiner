// A small, dependency-free RFC-4180-ish CSV parser for Amazon's "Request My
// Data" exports (Retail.OrderHistory). Handles quoted fields, escaped quotes
// (""), and commas/newlines inside quotes, plus CRLF and a UTF-8 BOM. Pure +
// tested.

/** Parse CSV text into rows of string fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // did the current row have any content/field?
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // strip BOM
  const n = text.length;

  const endField = (): void => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      started = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      endField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue; // CRLF: ignore CR, LF ends the row
    }
    if (c === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    started = true;
    i += 1;
  }
  // Flush a trailing field/row (file not ending in a newline). Skip a blank
  // trailing line (no field started and nothing buffered).
  if (started || field.length > 0) endRow();
  return rows;
}
