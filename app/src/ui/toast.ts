// One global toast manager (Base UI), usable outside React. Rendered by
// <Toaster/> in ui/Toaster.tsx.
import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

let lastId: string | undefined;

/** Short status message above the tab bar; a new one replaces the old. */
export function toast(message: string, timeout = 3200): void {
  if (lastId) toastManager.close(lastId);
  lastId = toastManager.add({ title: message, timeout, priority: "high" });
}
