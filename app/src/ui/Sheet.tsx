import { Drawer } from "@base-ui/react/drawer";
import { type ReactNode, type RefObject, useRef } from "react";
import "./ui.css";

/**
 * Bottom sheet (Base UI Drawer): slides up, swipe down / backdrop / Esc /
 * × to close. Focus goes to the popup itself unless `initialFocus` says
 * otherwise, so phones don't show a focus ring on ×.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  initialFocus,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
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
    // modal="trap-focus": keep focus inside, but skip Base UI's page scroll
    // lock. The page itself never scrolls (only #scroll does), and the lock's
    // body styles shifted the layout under the opening sheet on iOS.
    <Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)} modal="trap-focus">
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="sh-backdrop" />
          <Drawer.Viewport className="sh-viewport">
            <Drawer.Popup className={`sh-popup${className ? ` ${className}` : ""}`} ref={popup} initialFocus={focus}>
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
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}
