// Small shared pieces of the payments UI.
import { useMemo } from "react";
import { fmtG, grosze } from "../../lib/money";
import { pb } from "../../lib/pb";
import { usePeople } from "../../lib/stores";
import type { Expense } from "../../lib/types";
import { isPdf } from "../../lib/image";
import { CheckIcon, ReceiptIcon } from "../../ui/icons";
import { openViewer } from "./state";

export const fmtDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

export function useNames(): (id: string | null | undefined) => string {
  const people = usePeople();
  return useMemo(() => {
    const m = new Map(people.map((p) => [p.id, p.name]));
    return (id) => (id && m.get(id)) || "?";
  }, [people]);
}

export const expenseName = (x: Expense): string => x.title || x.category || (x.receipt ? "Чек" : "Платёж");

export const thumbUrl = (x: Expense): string => (x.receipt ? pb.files.getURL(x, x.receipt, { thumb: "400x0" }) : "");

/** Opens the saved receipt: images in the viewer, PDFs in a new tab. */
export function viewReceipt(x: Expense, payer: string): void {
  if (!x.receipt) return;
  const g = grosze(x.amount);
  openViewer({
    src: pb.files.getURL(x, x.receipt),
    pdf: isPdf(x.receipt),
    title: expenseName(x),
    meta: [g ? fmtG(g) : "", `платил ${payer}`].filter(Boolean).join(" · "),
  });
}

/** Receipt thumbnail: the photo, «PDF», or a receipt icon. */
export function Thumb({ x, src, pdf, scanning, onOpen, className }: {
  x?: Expense;
  /** local preview (object URL) instead of the saved file */
  src?: string | null;
  pdf?: boolean;
  scanning?: boolean;
  onOpen?: () => void;
  className?: string;
}) {
  const file = x?.receipt;
  const isP = pdf ?? (file ? isPdf(file) : false);
  const url = src ?? (x && file && !isP ? thumbUrl(x) : "");
  const inner = isP ? <span className="th-pdf">PDF</span> : url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <ReceiptIcon />;
  const cls = `thumb${scanning ? " scan" : ""}${className ? ` ${className}` : ""}`;
  if (!onOpen || (!file && !src)) return <span className={cls}>{inner}</span>;
  return (
    <button className={cls} type="button" aria-label="Открыть чек" onClick={onOpen}>
      {inner}
    </button>
  );
}

export function CheckBox() {
  return (
    <span className="pbox" aria-hidden="true">
      <CheckIcon />
    </span>
  );
}

export const CameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </svg>
);

export const GalleryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <circle cx="9.5" cy="9.5" r="1.5" />
    <path d="M20 15l-4.5-4.5L6 20" />
  </svg>
);
