// Feature: foresight-webapp-ui
// ClockConfigForm — clock format settings (12h/24h).
// Accessible from the Apps list when tapping Clock.

import type { ViewRoute } from "./types";

export interface ClockConfigFormOptions {
  bridge: any | null;
  onBack: () => void;
}

export function createClockConfigForm(
  options: ClockConfigFormOptions,
): ViewRoute {
  const { onBack } = options;
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "app-config-container";

    // Back button
    const backBtn = document.createElement("button");
    backBtn.className = "app-config-back-btn";
    backBtn.textContent = "← Apps";
    backBtn.addEventListener("click", onBack);
    wrapper.appendChild(backBtn);

    // App header
    const header = document.createElement("div");
    header.className = "app-config-header";
    const title = document.createElement("h2");
    title.className = "app-config-title";
    title.textContent = "Clock";
    header.appendChild(title);
    const desc = document.createElement("p");
    desc.className = "app-config-description";
    desc.textContent = "Digital clock widget for the HUD home page.";
    header.appendChild(desc);
    wrapper.appendChild(header);

    // Info: clock format is in General Settings
    const info = document.createElement("div");
    info.className = "app-config-info";
    info.textContent =
      "Clock format (12h / 24h) can be changed in Settings → General.";
    wrapper.appendChild(info);

    return wrapper;
  }

  return {
    id: "clock-config",
    label: "Clock",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
    },

    unmount(): void {
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
    },
  };
}
