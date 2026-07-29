/**
 * On-screen diagnostic log for the phone UI.
 *
 * Glasses input arrives over BLE with no console attached, so this panel is
 * the only practical way to see what the firmware actually sent. It starts
 * collapsed — it used to sit permanently over the bottom of every screen.
 */

const MAX_ENTRIES = 40;

export interface DebugLog {
  append(message: string): void;
  clear(): void;
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Wires the log panel and its toggle button.
 *
 * Both elements are optional; when absent (tests, or a trimmed index.html)
 * the returned log is a no-op rather than a source of null checks at every
 * call site.
 */
export function createDebugLog(
  panel: HTMLElement | null,
  toggle: HTMLElement | null,
): DebugLog {
  if (!panel) {
    return { append: () => {}, clear: () => {} };
  }

  let open = false;

  function setOpen(next: boolean): void {
    open = next;
    panel!.classList.toggle("debug-log--open", open);
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "hide_log" : "show_log";
    }
  }

  toggle?.addEventListener("click", () => setOpen(!open));
  setOpen(false);

  return {
    append(message: string): void {
      const entry = document.createElement("div");
      entry.className = "debug-log__entry";
      entry.textContent = `[${timestamp()}] ${message}`;
      panel.appendChild(entry);

      while (panel.childElementCount > MAX_ENTRIES) {
        panel.removeChild(panel.firstElementChild!);
      }
      panel.scrollTop = panel.scrollHeight;
    },

    clear(): void {
      panel.replaceChildren();
    },
  };
}
