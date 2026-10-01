import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";
import { toastManager } from "./toast";
import "./ui.css";

function Toasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="toast-vp">
        {toasts.map((t) => (
          <Toast.Root key={t.id} toast={t} className="toast" swipeDirection={["down", "left", "right"]}>
            <Toast.Content className="toast-c">
              <Toast.Title className="toast-t" />
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

/** Wrap the app once; call toast() from ui/toast.ts anywhere. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} limit={1}>
      {children}
      <Toasts />
    </Toast.Provider>
  );
}
