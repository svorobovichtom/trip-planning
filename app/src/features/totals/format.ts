// Plain decimals for transfer rows and the balance table ("1 234,56"), and the
// copy-paste form for banking apps ("1234,56").

const dec = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decPlain = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/** 123456 -> "1 234,56" */
export const fmtDec = (g: number): string => dec.format(g / 100);
/** 123456 -> "1234,56" (what «скопировать» puts on the clipboard) */
export const copyDec = (g: number): string => decPlain.format(g / 100);
/** balances: "+12,00" / "−12,00" / "0,00" */
export const fmtDecSigned = (g: number): string => (g > 0 ? "+" : g < 0 ? "−" : "") + fmtDec(Math.abs(g));

const when = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** PocketBase date ("2026-10-01 14:05:00.000Z") or ISO -> "1 окт., 16:05"; "" if unknown */
export function fmtWhen(s?: string): string {
  const d = s ? new Date(String(s).replace(" ", "T")) : null;
  return d && !Number.isNaN(d.getTime()) ? when.format(d) : "";
}
