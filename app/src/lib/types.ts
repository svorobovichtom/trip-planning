// Record shapes as PocketBase returns them. Schema: pb_migrations/*.js
// (payments fields: 1790000005_payments.js, scan output: pb_hooks/scan_lib.js).

export interface BaseRecord {
  id: string;
  created?: string;
  updated?: string;
  collectionId?: string;
  collectionName?: string;
}

export interface Person extends BaseRecord {
  name: string;
  sort?: number;
}

export interface Item extends BaseRecord {
  key: string;
  section: string;
  name: string;
  pl?: string;
  qty?: string;
  sort: number;
  done: boolean;
  /** person id or "" */
  done_by?: string;
  /** PocketBase date string or "" */
  done_at?: string;
}

/** A receipt line from the background scan (expenses.lines[]). */
export interface ReceiptLine {
  text: string;
  qty?: number | null;
  /** kg | g | l | ml | szt | "" */
  unit?: string | null;
  /** PLN for the whole line; negative = discount; null = unknown */
  price?: number | null;
  category?: string | null;
  /** items.id this line was matched to, or null/"" */
  item_id?: string | null;
}

export type ScanStatus = "" | "pending" | "running" | "done" | "failed";
export type SplitMode = "" | "equal" | "amounts" | "claims";

export interface Expense extends BaseRecord {
  title?: string;
  /** PLN; 0 = not known yet (the background scan fills it) */
  amount: number;
  currency?: string;
  category?: string;
  paid_by: string;
  /** empty = everyone */
  split_between?: string[];
  receipt?: string;
  note?: string;
  spent_at?: string;
  lines?: ReceiptLine[] | null;
  scan_status?: ScanStatus;
  /** "lines_mismatch" = lines don't add up to the total */
  scan_error?: string;
  scanned_at?: string;
  split_mode?: SplitMode;
  /** {personId: grosze | null}; null = «авто», an equal share of the rest */
  split_amounts?: Record<string, number | null> | null;
}

/** "I had receipt line `line` of expense `expense`". Unique per triple. */
export interface Claim {
  id: string;
  expense: string;
  line: number;
  person: string;
  /** optimistic copy not yet confirmed by the server */
  tmp?: boolean;
}

export const CATEGORIES = [
  "Мясо и рыба", "Молочка и яйца", "Овощи и зелень", "Фрукты", "Бакалея",
  "Снеки", "Гриль и быт", "Напитки и алкоголь", "Жильё",
  "Транспорт и бензин", "Кафе и рестораны", "Другое",
] as const;
