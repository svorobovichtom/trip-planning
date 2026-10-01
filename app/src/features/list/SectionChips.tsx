import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../../lib/haptics";
import { useSections } from "../../lib/hooks";
import { Morph } from "../../ui/Morph";
import { useScrollEl } from "../../ui/scroll";

export const secDomId = (i: number) => `sec${i}`;

/** One row of section chips: tap scrolls to the section; the one in view is highlighted. */
export function SectionChips() {
  const sections = useSections();
  const scrollRef = useScrollEl();
  const rowRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState<string>(secDomId(0));
  const lock = useRef(0);
  const sig = sections.map((s) => s.name).join("\u0001");

  // In-view highlight: the first section crossing the top ~22% of the scroll area.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const els = sections.map((_, i) => document.getElementById(secDomId(i))).filter((e): e is HTMLElement => !!e);
    const inView = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? inView.add(e.target.id) : inView.delete(e.target.id);
        if (Date.now() < lock.current) return;
        const first = els.find((el) => inView.has(el.id));
        if (first) setCurrent(first.id);
      },
      { root, rootMargin: "0px 0px -78% 0px" },
    );
    for (const el of els) io.observe(el);
    // The last sections are short and never reach the top band: at the very bottom, light the last one.
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (Date.now() < lock.current || root.scrollTop + root.clientHeight < root.scrollHeight - 4) return;
        const last = els[els.length - 1];
        if (last) setCurrent(last.id);
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [sig, scrollRef]);

  // Keep the current chip visible in the row.
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>(`[data-to="${current}"]`);
    if (!row || !chip || !row.offsetWidth) return;
    const l = chip.offsetLeft - row.offsetLeft;
    const pad = 16;
    if (l < row.scrollLeft + pad || l + chip.offsetWidth > row.scrollLeft + row.clientWidth - pad) {
      row.scrollTo({ left: Math.max(0, l - (row.clientWidth - chip.offsetWidth) / 2), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }, [current]);

  const go = (id: string) => {
    const sc = scrollRef.current;
    const sec = document.getElementById(id);
    if (!sc || !sec) return;
    const top = sc.scrollTop + sec.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
    lock.current = Date.now() + 900;
    setCurrent(id);
    sc.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return (
    <nav className="secs" ref={rowRef} aria-label="Разделы списка">
      {sections.map((s, i) => {
        const id = secDomId(i);
        const d = s.items.filter((it) => it.done).length;
        const t = s.items.length;
        return (
          <button
            key={s.name}
            className={`sc${t > 0 && d === t ? " full" : ""}`}
            type="button"
            data-to={id}
            aria-current={current === id ? "true" : undefined}
            onClick={() => go(id)}
          >
            <span className="t">{s.name}</span>
            <Morph className="n">{`${d}/${t}`}</Morph>
          </button>
        );
      })}
    </nav>
  );
}
