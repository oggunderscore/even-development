// Feature: foresight-webapp-ui
// SettingsView — combines HUD Layout Editor, HUD Display Mode,
// and Input settings into a single settings page view route.

import type { ViewRoute } from "./types";
import { createHudLayoutEditor } from "./hud-layout-editor";
import { createHudDurationControl } from "./hud-duration-control";
import { loadConfig, saveConfig } from "./storage-helpers";

export interface SettingsViewOptions {
  bridge: any | null;
}

/**
 * Creates the Settings view route.
 *
 * Mounts two sub-components:
 * 1. HUD Layout Editor — 2×5 grid for placing widgets on the glasses HUD
 * 2. HUD Duration Control — mode toggle and duration for hidden mode
 */
export function createSettingsView(options: SettingsViewOptions): ViewRoute {
  const { bridge } = options;

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;

  const layoutEditor = createHudLayoutEditor({ bridge });
  const durationControl = createHudDurationControl({ bridge });

  function createSection(title: string, className: string): HTMLElement {
    const section = document.createElement("section");
    section.className = `settings-view-section ${className}`;

    const heading = document.createElement("h2");
    heading.className = "settings-view-section-title";
    heading.textContent = title;
    section.appendChild(heading);

    const content = document.createElement("div");
    content.className = "settings-view-section-content";
    section.appendChild(content);

    return section;
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "settings-view-container";

    // HUD Layout section
    const layoutSection = createSection(
      "HUD Layout",
      "settings-view-section--layout",
    );
    wrapper.appendChild(layoutSection);

    const layoutContent = layoutSection.querySelector(
      ".settings-view-section-content",
    ) as HTMLElement;

    layoutEditor.mount(layoutContent);

    // Inactivity timer section
    const displaySection = createSection(
      "HUD Sleep",
      "settings-view-section--display",
    );
    wrapper.appendChild(displaySection);

    const displayContent = displaySection.querySelector(
      ".settings-view-section-content",
    ) as HTMLElement;

    durationControl.mount(displayContent);

    // Input Settings section — double-tap delay
    const inputSection = createSection("Input", "settings-view-section--input");
    wrapper.appendChild(inputSection);

    const inputContent = inputSection.querySelector(
      ".settings-view-section-content",
    ) as HTMLElement;

    // Double-tap delay slider
    const delayRow = document.createElement("div");
    delayRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:12px 0;";

    const delayLabel = document.createElement("span");
    delayLabel.style.cssText = "font-size:12px;color:var(--text);";
    delayLabel.textContent = "Double-tap Window";

    const delayValueGroup = document.createElement("div");
    delayValueGroup.style.cssText = "display:flex;align-items:center;gap:10px;";

    const delayValue = document.createElement("span");
    delayValue.style.cssText =
      "font-size:13px;font-weight:600;color:var(--text-bright);min-width:50px;text-align:center;";

    const delayDecBtn = document.createElement("button");
    delayDecBtn.className = "hud-duration-btn";
    delayDecBtn.textContent = "−";
    delayDecBtn.type = "button";

    const delayIncBtn = document.createElement("button");
    delayIncBtn.className = "hud-duration-btn";
    delayIncBtn.textContent = "+";
    delayIncBtn.type = "button";

    // Load current value
    let currentDelay = 400;
    void loadConfig<number>(bridge, "foresight-doubletap-delay-v1", 400).then(
      (val) => {
        if (val >= 200 && val <= 800) currentDelay = val;
        delayValue.textContent = `${currentDelay}ms`;
        updateDelayBtns();
      },
    );
    delayValue.textContent = `${currentDelay}ms`;

    function updateDelayBtns(): void {
      delayDecBtn.disabled = currentDelay <= 200;
      delayIncBtn.disabled = currentDelay >= 800;
    }
    updateDelayBtns();

    delayDecBtn.addEventListener("click", () => {
      if (currentDelay > 200) {
        currentDelay -= 50;
        delayValue.textContent = `${currentDelay}ms`;
        updateDelayBtns();
        void saveConfig(bridge, "foresight-doubletap-delay-v1", currentDelay);
      }
    });

    delayIncBtn.addEventListener("click", () => {
      if (currentDelay < 800) {
        currentDelay += 50;
        delayValue.textContent = `${currentDelay}ms`;
        updateDelayBtns();
        void saveConfig(bridge, "foresight-doubletap-delay-v1", currentDelay);
      }
    });

    delayValueGroup.appendChild(delayDecBtn);
    delayValueGroup.appendChild(delayValue);
    delayValueGroup.appendChild(delayIncBtn);
    delayRow.appendChild(delayLabel);
    delayRow.appendChild(delayValueGroup);
    inputContent.appendChild(delayRow);

    const delayHint = document.createElement("div");
    delayHint.style.cssText =
      "font-size:10px;color:var(--text-dim);margin-top:4px;letter-spacing:0.5px;";
    delayHint.textContent =
      "Time window for detecting double-taps (200–800ms). Lower = faster, but harder to trigger.";
    inputContent.appendChild(delayHint);

    return wrapper;
  }

  return {
    id: "settings",
    label: "Settings",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
    },

    unmount(): void {
      layoutEditor.unmount();
      durationControl.unmount();

      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
    },
  };
}
