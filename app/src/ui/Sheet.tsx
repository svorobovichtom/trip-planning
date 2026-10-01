import { Drawer } from "@base-ui/react/drawer";
import { type ReactNode, type RefObject, useRef } from "react";
import "./ui.css";

/**
 * Bottom sheet (Base UI Drawer): slides up, swipe down / backdrop / Esc /
 * × to close. Focus goes to the popup itself unless `initialFocus` says
 * otherwise, so phones don't show a focus ring on ×.
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
    return popup.current;
  };
  return (
    // Same structure as Base UI's bottom-drawer demo. VirtualKeyboardProvider
    // only for sheets with text fields (`keyboard`), as in their keyboard demo.
    <Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <KeyboardWrap on={keyboard}>
        <Drawer.Portal>
          <Drawer.Backdrop className="sh-backdrop" />
          <Drawer.Viewport className="sh-viewport">
            <Drawer.Popup className={`sh-popup${keyboard ? " sh-kb" : ""}${className ? ` ${className}` : ""}`} ref={popup} initialFocus={focus}>
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
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </KeyboardWrap>
    </Drawer.Root>
  );
}
