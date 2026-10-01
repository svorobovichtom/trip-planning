import { useEffect, useState, useSyncExternalStore } from "react";
import { plural } from "../../lib/plural";
import { sessionStore, useStore } from "../../lib/stores";
import { queue } from "../../lib/sync";
import { Morph } from "../../ui/Morph";

const snapshot = () => `${queue.size}:${queue.flushing ? 1 : 0}`;

/**
 * Next to the title, only when something is off: offline, or writes still
 * queued. Short blips (a tap's own save, a quick reconnect) never show.
 */
export function SyncPill() {
  const q = useSyncExternalStore((fn) => queue.subscribe(fn), snapshot, snapshot);
  const online = useStore(sessionStore, (s) => s.online);
  const [n, flushing] = q.split(":").map(Number) as [number, number];
  const want = online === false ? "off" : n || flushing ? "busy" : "";
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (!want) {
      setShown("");
      return;
    }
    const t = setTimeout(() => setShown(want), want === "off" ? 1500 : 900);
    return () => clearTimeout(t);
  }, [want]);

  if (!shown || shown !== want) return <span className="net" role="status" aria-live="polite" hidden />;
  const text = shown === "off" ? `нет связи${n ? ` · ${n} ${plural(n, "ждёт", "ждут", "ждут")}` : ""}` : "сохраняю…";
  return (
    <span
      className="net"
      data-s={shown}
      role="status"
      aria-live="polite"
      title={shown === "off" ? "Отметки сохранены в телефоне и уйдут, когда появится связь" : undefined}
    >
      <Morph>{text}</Morph>
    </span>
  );
}
