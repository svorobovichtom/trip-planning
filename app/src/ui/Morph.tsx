import type { ElementType } from "react";
import { TextMorph } from "torph/react";

/**
 * Text that changes in place (titles, counters, names) morphs instead of
 * jumping. torph renders an accessible copy too, so read state from
 * attributes/aria in tests, not textContent.
 */
export function Morph({ children, className, as = "span" }: { children: string; className?: string; as?: ElementType }) {
  return (
    <TextMorph as={as} className={className} locale="ru" duration={420}>
      {children}
    </TextMorph>
  );
}
