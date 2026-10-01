import { Drawer } from "@base-ui/react/drawer";
import { type ReactNode, type RefObject, useRef } from "react";
import "./ui.css";

/**
 * Bottom sheet (Base UI Drawer): slides up, swipe down / backdrop / Esc /
 * × to close. On touch no focus is moved on open (see `focus` below).
 */
function KeyboardWrap({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <Drawer.VirtualKeyboardProvider>{children}</Drawer.VirtualKeyboardProvider> : <>{children}</>;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  initialFocus,
  className,
  keyboard = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  /** The sheet has text fields: keep them above the on-screen keyboard. */
  keyboard?: boolean;
}) {
  const popup = useRef<HTMLDivElement>(null);
  // Keyboard: first field/button. Touch/mouse: the sheet itself (no ring on ×),
  // or the field passed in on devices with a fine pointer.
  const focus = (type: string) => {
    if (type === "keyboard") return initialFocus?.current ?? true;
    if (initialFocus?.current && matchMedia("(hover: hover) and (pointer: fine)").matches) return initialFocus.current;
    // Touch: move no focus at all. Focusing anything inside the popup while it
    // still sits below the screen (start of the slide-in) makes iOS Safari pan
    // the viewport to it — the sheet flashed at the top, then jumped back.
    return false;
  };
  return (
    // VirtualKeyboardProvider only for sheets with text fields (`keyboard`).
    // Layout: see ui.css (clipping viewport, pinned popup, scrolling box).
    <Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <KeyboardWrap on={keyboard}>
        <Drawer.Portal>
          <Drawer.Backdrop className="sh-backdrop" />
          <Drawer.Viewport className="sh-viewport">
            <Drawer.Popup className={`sh-popup${keyboard ? " sh-kb" : ""}${className ? ` ${className}` : ""}`} ref={popup} initialFocus={focus}>
              <div className="sh-box">
                <i className="sh-grab" aria-hidden="true" />
                <Drawer.Content className="sh-content">
                  <div className="sh-head">
                    <Drawer.Title className="sh-title">{title}</Drawer.Title>
                    <Drawer.Close className="sh-x" aria-label="Закрыть">
                      ×
                    </Drawer.Close>
                  </div>
                  {children}
                </Drawer.Content>
              </div>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </KeyboardWrap>
    </Drawer.Root>
  );
}
