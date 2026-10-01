import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import { CloseIcon } from "../../ui/icons";
import { closeViewer, useViewer } from "./state";

/** Full-screen dark receipt viewer. Tap toggles fit / 2x at the tapped spot; pinch is the browser's own. */
export function ReceiptViewer() {
  const v = useViewer();
  const [zoom, setZoom] = useState(false);
  const [last, setLast] = useState(v);
  const box = useRef<HTMLDivElement>(null);
  if (v && v !== last) {
    setLast(v);
    setZoom(false);
  }
  const shown = v ?? last;

  const onTap = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const next = !zoom;
    setZoom(next);
    if (next) {
      requestAnimationFrame(() => {
        const b = box.current;
        if (!b) return;
        b.scrollLeft = fx * img.offsetWidth - b.clientWidth / 2;
        b.scrollTop = fy * img.offsetHeight - b.clientHeight / 2;
      });
    }
  };

  return (
    <Dialog.Root open={!!v} onOpenChange={(o) => !o && closeViewer()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="vw-backdrop" />
        <Dialog.Popup className="vw" aria-label="Фото чека" initialFocus={box}>
          <div className="vw-h">
            <div className="vw-c">
              <Dialog.Title className="vw-t">{shown?.title || "Чек"}</Dialog.Title>
              {shown?.meta && <span>{shown.meta}</span>}
            </div>
            <Dialog.Close className="sh-x vw-x" aria-label="Закрыть">
              <CloseIcon />
            </Dialog.Close>
          </div>
          <div className={`vw-box${zoom ? " zoom" : ""}`} ref={box} tabIndex={-1}>
            {shown && <img src={shown.src} alt="Фото чека" onClick={onTap} draggable={false} />}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
