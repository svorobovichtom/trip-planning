import { Drawer } from "@base-ui/react/drawer";
import type { ReactNode, RefObject } from "react";
import { forwardRef, useRef } from "react";
import "./ui.css";
import "./fullsheet.css";

/**
 * Full-height bottom sheet (Base UI Drawer): fixed header, a scrolling
 * <SheetBody/> and an optional pinned <SheetFoot/>. The popup has a fixed height, so content
 * that changes (scan results, claims) never resizes it mid-animation.
 * Swipe down from the header, or from the body when it is scrolled to the top.
 */
export function FullSheet({
  open,
  onOpenChange,
  onClosed,
  title,
  head,
  children,
  initialFocus,
  focusAlways,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** after the close animation */
  onClosed?: () => void;
  title: ReactNode;
  /** extra controls in the header row, before × */
  head?: ReactNode;
  /** <SheetBody/> and optionally <SheetFoot/> */
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  /** focus `initialFocus` on touch devices too (e.g. «Ввести вручную» opens the keyboard) */
  focusAlways?: boolean;
  className?: string;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const focus = (type: string) => {
    if (type === "keyboard") return initialFocus?.current ?? true;
    if (initialFocus?.current && matchMedia("(hover: hover) and (pointer: fine)").matches) return initialFocus.current;
    // Touch: move no focus at all. Focusing anything inside the popup while it
    // still sits below the screen (start of the slide-in) makes iOS Safari pan
    // the viewport to it — the sheet flashed at the top, then jumped back.
    return false;
  };
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => onOpenChange(o)}
      onOpenChangeComplete={(o) => {
        // focusAlways on touch: focus the field only once the sheet has landed,
        // without scrolling — focusing it mid-slide made iOS pan the viewport.
        if (o && focusAlways && initialFocus?.current && !matchMedia("(hover: hover) and (pointer: fine)").matches) {
          initialFocus.current.focus({ preventScroll: true });
        }
        if (!o) onClosed?.();
      }}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="sh-backdrop" />
          <Drawer.Viewport className="fs-viewport">
            <Drawer.Popup className={`fs-popup${className ? ` ${className}` : ""}`} ref={popup} initialFocus={focus}>
              <div className="fs-head">
                <i className="sh-grab" aria-hidden="true" />
                <div className="sh-head">
                  <Drawer.Title className="sh-title">{title}</Drawer.Title>
                  <span className="fs-sp" />
                  {head}
                  <Drawer.Close className="sh-x" aria-label="Закрыть">
                    ×
                  </Drawer.Close>
                </div>
              </div>
              {children}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}

/** The scrolling part of a FullSheet. */
export const SheetBody = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(function SheetBody({ children, className }, ref) {
  return (
    <Drawer.Content className={`fs-body${className ? ` ${className}` : ""}`} ref={ref}>
      {children}
    </Drawer.Content>
  );
});

/** Pinned footer of a FullSheet (actions). */
export function SheetFoot({ children }: { children: ReactNode }) {
  return <div className="fs-foot">{children}</div>;
}
