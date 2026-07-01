// Feature: hud-settings-refinement
// HudDurationControl — HUD mode toggle (Always ON / Hidden) and duration selector.
// In Hidden mode, the HUD only appears on notifications or when double-tapped to wake.
// Duration controls how long it stays visible before hiding again.

import type { HudDurationConfig, HudModeConfig, HudMode } from "./types";
import {
  STORAGE_KEYS,
  DEFAULT_HUD_DURATION,
  DEFAULT_HUD_MODE,
  DURATION_OPTIONS,
} from "./types";
import { loadConfig, saveConfig } from "./storage-helpers";

export interface HudDurationControlOptions {
  bridge: any | null;
}

export interface HudDurationControl {
  mount(container: HTMLElement): void;
  unmount(): void;
  getValue(): number;
  getMode(): HudMode;
}

/**
 * Creates the HUD display settings control.
 *
 * Renders:
 * 1. A mode toggle — "Always ON" keeps the HUD permanently visible;
 *    "Hidden" only shows the HUD on notifications or double-tap wake.
 * 2. A "HUD Duration: X seconds" dropdown (only active in Hidden mode)
 *    controlling how long the HUD stays visible before auto-hiding.
 *
 * Loads saved values on mount, defaults to always-on / 5s.
 * Persists changes via bridge; shows error if unavailable.
 */
export function createHudDurationControl(
  options: HudDurationControlOptions,
): HudDurationControl {
  const { bridge } = options;
  let currentDuration = DEFAULT_HUD_DURATION.displayDurationSeconds;
  let currentMode: HudMode = DEFAULT_HUD_MODE.mode;
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let selectEl: HTMLSelectElement | null = null;
  let errorEl: HTMLElement | null = null;
  let durationRow: HTMLElement | null = null;
  let durationLabel: HTMLElement | null = null;
  let modeAlwaysOnBtn: HTMLButtonElement | null = null;
  let modeHiddenBtn: HTMLButtonElement | null = null;
  let modeDescription: HTMLElement | null = null;

  function updateUI(): void {
    if (selectEl) {
      selectEl.value = String(currentDuration);
      selectEl.disabled = currentMode === "always-on";
    }
    if (durationRow) {
      // Show duration row only in hidden mode
      durationRow.style.opacity = currentMode === "hidden" ? "1" : "0.4";
    }
    if (durationLabel) {
      durationLabel.textContent = `HUD Duration: ${currentDuration} seconds`;
    }
    if (modeAlwaysOnBtn && modeHiddenBtn) {
      modeAlwaysOnBtn.classList.toggle(
        "hud-mode-btn--active",
        currentMode === "always-on",
      );
      modeHiddenBtn.classList.toggle(
        "hud-mode-btn--active",
        currentMode === "hidden",
      );
      modeAlwaysOnBtn.setAttribute(
        "aria-pressed",
        String(currentMode === "always-on"),
      );
      modeHiddenBtn.setAttribute(
        "aria-pressed",
        String(currentMode === "hidden"),
      );
    }
    if (modeDescription) {
      modeDescription.textContent =
        currentMode === "always-on"
          ? "HUD is always visible. Double-tap opens Apps Menu."
          : "HUD only appears on notifications or double-tap wake. Double-tap opens Apps Menu.";
    }
  }

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }
  }

  function clearError(): void {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  async function persistDuration(): Promise<void> {
    const config: HudDurationConfig = {
      displayDurationSeconds: currentDuration,
    };
    const result = await saveConfig(bridge, STORAGE_KEYS.HUD_DURATION, config);
    if (!result.success) {
      showError("Duration cannot be synced to glasses.");
    } else {
      clearError();
    }
  }

  async function persistMode(): Promise<void> {
    const config: HudModeConfig = { mode: currentMode };
    const result = await saveConfig(bridge, STORAGE_KEYS.HUD_MODE, config);
    if (!result.success) {
      showError("Mode cannot be synced to glasses.");
    } else {
      clearError();
    }
  }

  function handleDurationChange(): void {
    if (selectEl) {
      currentDuration = Number(selectEl.value);
      updateUI();
      persistDuration();
    }
  }

  function handleModeChange(mode: HudMode): void {
    if (mode !== currentMode) {
      currentMode = mode;
      updateUI();
      persistMode();
    }
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "hud-duration-container";

    // Mode toggle section
    const modeLabel = document.createElement("label");
    modeLabel.className = "hud-duration-field-label";
    modeLabel.textContent = "HUD Mode";
    wrapper.appendChild(modeLabel);

    const modeGroup = document.createElement("div");
    modeGroup.className = "hud-mode-toggle";
    modeGroup.setAttribute("role", "group");
    modeGroup.setAttribute("aria-label", "HUD display mode");

    modeAlwaysOnBtn = document.createElement("button");
    modeAlwaysOnBtn.className = "hud-mode-btn";
    modeAlwaysOnBtn.type = "button";
    modeAlwaysOnBtn.textContent = "Always ON";
    modeAlwaysOnBtn.setAttribute("aria-pressed", "true");
    modeAlwaysOnBtn.addEventListener("click", () =>
      handleModeChange("always-on"),
    );
    modeGroup.appendChild(modeAlwaysOnBtn);

    modeHiddenBtn = document.createElement("button");
    modeHiddenBtn.className = "hud-mode-btn";
    modeHiddenBtn.type = "button";
    modeHiddenBtn.textContent = "Hidden";
    modeHiddenBtn.setAttribute("aria-pressed", "false");
    modeHiddenBtn.addEventListener("click", () => handleModeChange("hidden"));
    modeGroup.appendChild(modeHiddenBtn);

    wrapper.appendChild(modeGroup);

    // Mode description
    modeDescription = document.createElement("p");
    modeDescription.className = "hud-mode-description";
    modeDescription.textContent =
      "HUD is always visible. Double-tap opens Apps Menu.";
    wrapper.appendChild(modeDescription);

    // Duration row (label + dropdown)
    durationRow = document.createElement("div");
    durationRow.className = "hud-duration-row";

    durationLabel = document.createElement("label");
    durationLabel.className = "hud-duration-field-label";
    durationLabel.textContent = `HUD Duration: ${currentDuration} seconds`;
    durationRow.appendChild(durationLabel);

    selectEl = document.createElement("select");
    selectEl.className = "hud-duration-select";
    selectEl.setAttribute("aria-label", "HUD display duration in seconds");
    for (const seconds of DURATION_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(seconds);
      option.textContent = `${seconds} seconds`;
      selectEl.appendChild(option);
    }
    selectEl.value = String(currentDuration);
    selectEl.addEventListener("change", handleDurationChange);
    durationRow.appendChild(selectEl);

    wrapper.appendChild(durationRow);

    // Error message area
    errorEl = document.createElement("div");
    errorEl.className = "hud-duration-error";
    errorEl.style.display = "none";
    wrapper.appendChild(errorEl);

    return wrapper;
  }

  async function loadSavedValues(): Promise<void> {
    const modeConfig = await loadConfig<HudModeConfig>(
      bridge,
      STORAGE_KEYS.HUD_MODE,
      DEFAULT_HUD_MODE,
    );
    currentMode = modeConfig.mode;

    const durationConfig = await loadConfig<HudDurationConfig>(
      bridge,
      STORAGE_KEYS.HUD_DURATION,
      DEFAULT_HUD_DURATION,
    );
    currentDuration = durationConfig.displayDurationSeconds;

    updateUI();
  }

  return {
    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
      updateUI();
      loadSavedValues();
    },

    unmount(): void {
      if (selectEl) {
        selectEl.removeEventListener("change", handleDurationChange);
      }
      if (modeAlwaysOnBtn) {
        modeAlwaysOnBtn.removeEventListener("click", () =>
          handleModeChange("always-on"),
        );
      }
      if (modeHiddenBtn) {
        modeHiddenBtn.removeEventListener("click", () =>
          handleModeChange("hidden"),
        );
      }
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
      selectEl = null;
      errorEl = null;
      durationRow = null;
      durationLabel = null;
      modeDescription = null;
      modeAlwaysOnBtn = null;
      modeHiddenBtn = null;
    },

    getValue(): number {
      return currentDuration;
    },

    getMode(): HudMode {
      return currentMode;
    },
  };
}
