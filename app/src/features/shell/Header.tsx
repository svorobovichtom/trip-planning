import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useListStats } from "../../lib/hooks";
import { openProfile, type Tab, useData, useLoaded, useMe, useUi } from "../../lib/stores";
import { Avatar } from "../../ui/Avatar";
import { ChevronIcon } from "../../ui/icons";
import { Morph } from "../../ui/Morph";
import { SectionChips } from "../list/SectionChips";
import { useListSummary } from "../list/summary";
import { usePaymentsSummary } from "../payments/summary";
import { useTotalsSummary } from "../totals/summary";
import { SyncPill } from "./SyncPill";

export const TITLES: Record<Tab, string> = { list: "Покупки в Ашан", exp: "Расходы", sum: "Итоги" };

/** Same two rows on every tab (title + my profile pill; one-line summary); the list adds chips and a progress line. */
export function Header() {
  const tab = useUi((s) => s.tab);
  const loaded = useLoaded();
  const summaries = { list: useListSummary(), exp: usePaymentsSummary(), sum: useTotalsSummary() };
  const { done, total } = useListStats();
  const h1 = useRef<HTMLHeadingElement>(null);
  const clip = useTitleClip(h1, TITLES[tab]);

  useEffect(() => {
    document.title = TITLES[tab];
  }, [tab]);

  return (
    <header className={`hdr${tab === "list" ? " on-list" : ""}`}>
      <div className="hin">
        <div className="top">
          <h1 ref={h1} className={clip ? "clip" : undefined}>
            <Morph>{TITLES[tab]}</Morph>
          </h1>
          <SyncPill />
          <span className="sp" />
          <MeButton />
        </div>
        <div className="sub">{loaded ? <Morph>{summaries[tab]}</Morph> : " "}</div>
        {tab === "list" && <SectionChips />}
      </div>
      <i className="hbar" aria-hidden="true" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
    </header>
  );
}

/** [avatar · name · chevron] opens the profile; nobody chosen yet: «Кто ты?» in ink, straight to that step. */
function MeButton() {
  const me = useMe();
  const loaded = useLoaded();
  const failed = useData((s) => s.loadFailed);
  const known = loaded || failed;
  const name = me ? me.name : known ? "Кто ты?" : "";
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef(name);
  useEffect(() => {
    if (prev.current === name) return;
    const was = prev.current;
    prev.current = name;
    if (!was) return; // first appearance after loading: no flash
    const b = ref.current;
    if (!b) return;
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
  }, [name]);
  // Not loaded yet: who I am is unknown, not «nobody» — a quiet placeholder, not the ink «Кто ты?».
  if (!me && !known) return <span className="me me-wait" aria-hidden="true" />;
  return (
    <button
      ref={ref}
      className={`me${me ? "" : " empty"}`}
      type="button"
      aria-haspopup="dialog"
      aria-label={me ? `Профиль: ${me.name}` : "Кто ты? Выбрать себя"}
      onClick={() => openProfile(me ? "main" : "who")}
    >
      {me && <Avatar person={me} size={26} />}
      {/* plain text, not <Morph>: a long name must end in an ellipsis */}
      <span className="nm">{name}</span>
      <ChevronIcon />
    </button>
  );
}

/** A title squeezed by the pills fades out at the edge instead of being cut. */
function useTitleClip(ref: RefObject<HTMLElement | null>, dep: string): boolean {
  const [clip, setClip] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClip(el.scrollWidth > el.clientWidth + 1);
    check();
    const t = setTimeout(check, 450); // after the morph settles
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [ref, dep]);
  return clip;
}
