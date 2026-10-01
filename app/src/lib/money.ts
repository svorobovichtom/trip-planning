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

/** "12,5 zł" / "12.50" / "1 234,56" -> PLN number (2 decimals), NaN if not a number. */
export function parseAmount(s: string): number {
  const t = String(s).replace(/[\s  ]|zł|pln/gi, "").replace(",", ".");
  if (!t || t === "." || !/^\d*\.?\d*$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100) / 100;
}
