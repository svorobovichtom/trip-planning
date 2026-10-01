// «скопировать»: clipboard with a toast; a dialog with the text selected
// when the clipboard isn't available.
import { haptic } from "../../lib/haptics";
import { showCopy } from "../../ui/Confirm";
import { toast } from "../../ui/toast";

export async function copyText(s: string, fallbackTitle = "Скопируй"): Promise<void> {
  haptic();
  try {
    await navigator.clipboard.writeText(s);
    toast("Скопировано");
  } catch {
    void showCopy(fallbackTitle, s);
  }
}
