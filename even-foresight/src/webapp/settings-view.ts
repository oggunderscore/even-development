// Feature: foresight-webapp-ui
// SettingsView — combines HUD Layout Editor, HUD Display Mode,
// and Input settings into a single settings page view route.

import type { ViewRoute } from "./types";
import { STORAGE_KEYS } from "./types";
import { createHudLayoutEditor } from "./hud-layout-editor";
import { createHudDurationControl } from "./hud-duration-control";
import { createMenuOrderEditor } from "./menu-order-editor";
import { loadConfig, saveConfig } from "./storage-helpers";
import {
  DOUBLE_TAP_MIN_MS,
  DOUBLE_TAP_MAX_MS,
  DOUBLE_TAP_DEFAULT_MS,
} from "../constants";

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
  const menuOrderEditor = createMenuOrderEditor({ bridge });

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

    // Menu order section
    const menuOrderSection = createSection(
      "Menu Order",
      "settings-view-section--menu-order",
    );
    wrapper.appendChild(menuOrderSection);

    const menuOrderContent = menuOrderSection.querySelector(
      ".settings-view-section-content",
    ) as HTMLElement;

    menuOrderEditor.mount(menuOrderContent);

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
    let currentDelay = DOUBLE_TAP_DEFAULT_MS;
    void loadConfig<number>(
      bridge,
      STORAGE_KEYS.DOUBLE_TAP_DELAY,
      DOUBLE_TAP_DEFAULT_MS,
    ).then((val) => {
      if (val >= DOUBLE_TAP_MIN_MS && val <= DOUBLE_TAP_MAX_MS) {
        currentDelay = val;
      }
      delayValue.textContent = `${currentDelay}ms`;
      updateDelayBtns();
    });
    delayValue.textContent = `${currentDelay}ms`;

    function updateDelayBtns(): void {
      delayDecBtn.disabled = currentDelay <= DOUBLE_TAP_MIN_MS;
      delayIncBtn.disabled = currentDelay >= DOUBLE_TAP_MAX_MS;
    }
    updateDelayBtns();

    delayDecBtn.addEventListener("click", () => {
      if (currentDelay > DOUBLE_TAP_MIN_MS) {
        currentDelay -= 50;
        delayValue.textContent = `${currentDelay}ms`;
        updateDelayBtns();
        void saveConfig(bridge, STORAGE_KEYS.DOUBLE_TAP_DELAY, currentDelay);
      }
    });

    delayIncBtn.addEventListener("click", () => {
      if (currentDelay < DOUBLE_TAP_MAX_MS) {
        currentDelay += 50;
        delayValue.textContent = `${currentDelay}ms`;
        updateDelayBtns();
        void saveConfig(bridge, STORAGE_KEYS.DOUBLE_TAP_DELAY, currentDelay);
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
    delayHint.textContent = `Time window for detecting double-taps (${DOUBLE_TAP_MIN_MS}–${DOUBLE_TAP_MAX_MS}ms). Lower = faster, but harder to trigger. If double-tap (menu, notifications) isn't registering, try raising this — check the "show_log" panel below to see what's actually being detected.`;
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
      menuOrderEditor.unmount();

      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
    },
  };
}
