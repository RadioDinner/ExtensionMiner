// Money is integer cents everywhere (SPEC.md §4). Never floats.

/** Parse a display amount like "$1,234.56", "-$12.00", "1,234.56" into integer cents. */
export function parseAmountToCents(text: string): number | null {
  const cleaned = text.trim().replace(/[$,\s]/g, "");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [wholeRaw = "0", fracRaw = ""] = cleaned.replace(/^[+-]/, "").split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  const cents = parseInt(wholeRaw, 10) * 100 + parseInt(frac, 10);
  return negative ? -cents : cents;
}

/** Format integer cents as a plain dollar string, e.g. -123456 -> "-$1,234.56". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
}

/** Sum that refuses non-integers, for split validation (amounts must sum exactly, §R3). */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => {
    if (!Number.isInteger(v)) throw new Error(`non-integer cents value: ${v}`);
    return acc + v;
  }, 0);
}
