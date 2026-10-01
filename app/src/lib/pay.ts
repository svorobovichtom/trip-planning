// «Как тебе переводить»: Revtag / BLIK phone, normalised for people.revolut
// and people.phone (pb_migrations/1790000007_people_pay.js), and the
// one-tap Revolut link.
//
// Revolut link: https://revolut.me/<revtag>?amount=<minor units>&currency=PLN.
// revolut.me reads `amount` with parseInt as MINOR units (grosze): 50,34 zł is
// amount=5034 — a decimal "50.34" would come out as 0,50 zł. An unsupported
// currency drops both amount and currency. On iOS revolut.me is a universal
// link (apple-app-site-association covers every path except /money-request/*),
// so with the app installed it opens Revolut; without it, the revolut.me page
// (pay by card / Apple Pay, or open the app).

export const REVTAG_RE = /^[A-Za-z0-9._-]{2,40}$/;
/** what people.phone accepts (same as the migration's pattern) */
export const PHONE_RE = /^\+?[0-9 ]{6,20}$/;

/**
 * "@yulia", "yulia", "revolut.me/yulia", "https://revolut.me/@yulia?x=1" -> "yulia".
 * "" for empty input, null if it isn't a Revtag.
 */
export function normRevtag(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?revolut\.me\/+([^/?#\s]+)/i);
  if (url?.[1]) s = url[1];
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as is */
  }
  s = s.replace(/^@+/, "").trim();
  return REVTAG_RE.test(s) ? s : null;
}

/**
 * "+48 512-345-678", "(+48) 512 345 678", "0048512345678" -> "+48 512 345 678";
 * a 9-digit Polish number -> "512 345 678". "" for empty, null if not a phone.
 */
export function normPhone(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/[^0-9+\s().-]/.test(s)) return null;
  let d = s.replace(/[^0-9+]/g, "");
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  const plus = d.startsWith("+");
  d = d.replace(/\+/g, "");
  if (d.length < 6 || d.length > 15) return null;
  let out: string;
  if (plus && d.startsWith("48") && d.length === 11) out = `+48 ${group3(d.slice(2))}`;
  else if (!plus && d.length === 9) out = group3(d);
  else out = (plus ? "+" : "") + d;
  return out.length <= 20 && PHONE_RE.test(out) ? out : null;
}

const group3 = (d: string) => d.replace(/(\d{3})(?=\d)/g, "$1 ");

/** What «скопировать» puts on the clipboard for a bank's «na telefon» field: a Polish number without +48, others as digits. */
export function phoneForCopy(phone: string): string {
  const d = phone.replace(/[^0-9+]/g, "");
  return /^\+48\d{9}$/.test(d) ? d.slice(3) : d;
}

/** https://revolut.me/<revtag>?amount=<grosze>&currency=PLN; null if the tag or amount is unusable. */
export function revolutLink(revtag: string, g: number): string | null {
  const tag = normRevtag(revtag);
  if (!tag || !Number.isInteger(g) || g < 1) return null;
  return `https://revolut.me/${encodeURIComponent(tag)}?amount=${g}&currency=PLN`;
}
