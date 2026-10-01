// Money. The database stores PLN as numbers; everything in the app is
// integer grosze (1 zł = 100 gr) so sums are exact.

export const grosze = (pln: unknown): number => {
  const n = Number(pln ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "PLN", currencyDisplay: "narrowSymbol" });
const money0 = new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "PLN", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0,
});

/** 12345 -> "123,45 zł" */
export const fmtG = (g: number): string => money.format(g / 100);
/** 12345 -> "123 zł" (rounded, for compact summaries) */
export const fmtG0 = (g: number): string => money0.format(g / 100);
/** "+1,00 zł" / "−1,00 zł" / "0,00 zł" — balances */
export const fmtSigned = (g: number): string => (g > 0 ? "+" : g < 0 ? "−" : "") + fmtG(Math.abs(g));
/** only negatives get a sign (receipt discounts) */
export const fmtMinus = (g: number): string => (g < 0 ? "−" : "") + fmtG(Math.abs(g));

/**
 * "12,5 zł" / "12.50" / "1 234,56" -> grosze (integer), NaN if not a number.
 * Exact: works on the digits, not on a float, so "1,005" is 101 gr (half up
 * at the third decimal), never 100 because 1.005 * 100 = 100.4999…
 * Only one decimal separator ("," or "."); no sign — amounts are never negative.
 */
export function parseG(s: string): number {
  const t = String(s).replace(/[\s  ]|zł|pln/gi, "").replace(",", ".");
  if (!t || t === "." || !/^\d*\.?\d*$/.test(t)) return Number.NaN;
  const [i = "", f = ""] = t.split(".");
  const g = Number(i || "0") * 100 + Number((f + "00").slice(0, 2)) + (f.charAt(2) >= "5" ? 1 : 0);
  return Number.isSafeInteger(g) ? g : Number.NaN;
}

/** "12,5 zł" / "12.50" / "1 234,56" -> PLN number (2 decimals), NaN if not a number. */
export function parseAmount(s: string): number {
  const g = parseG(s);
  return Number.isNaN(g) ? Number.NaN : g / 100;
}
