// HudDurationControl — the HUD inactivity timer.
//
// "Never Sleep" keeps the HUD lit indefinitely. "Sleep After" blanks it once
// the wearer has gone the selected number of seconds without input, so the
// display is not permanently in their field of view; any gesture wakes it.

import type { HudDurationConfig, HudModeConfig, HudMode } from "./types";
import {
  STORAGE_KEYS,
  DEFAULT_HUD_DURATION,
  DEFAULT_HUD_MODE,
  DURATION_OPTIONS,
  normalizeHudMode,
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

const MODE_LABEL: Record<HudMode, string> = {
  "always-on": "Never Sleep",
  "inactivity-timer": "Sleep After",
};

const MODE_DESCRIPTION: Record<HudMode, string> = {
  "always-on": "HUD stays lit until you exit. Double-tap opens the Apps Menu.",
  "inactivity-timer":
    "HUD blanks after the selected idle time. Any tap or swipe wakes it; double-tap opens the Apps Menu.",
};

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
  let infoLabel: HTMLElement | null = null;
  let modeDescription: HTMLElement | null = null;
  const modeButtons = new Map<HudMode, HTMLButtonElement>();

  function updateUI(): void {
    const sleeps = currentMode === "inactivity-timer";

    if (selectEl) {
      selectEl.value = String(currentDuration);
      selectEl.disabled = !sleeps;
    }
    if (durationRow) {
      durationRow.style.opacity = sleeps ? "1" : "0.4";
    }
    if (durationLabel) {
      durationLabel.textContent = `Sleep after ${currentDuration} seconds`;
    }
    if (infoLabel) {
      // Only meaningful when there is no timer to explain.
      infoLabel.style.display = sleeps ? "none" : "block";
    }
    for (const [mode, button] of modeButtons) {
      const active = mode === currentMode;
      button.classList.toggle("hud-mode-btn--active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (modeDescription) {
      modeDescription.textContent = MODE_DESCRIPTION[currentMode];
    }
  }

  function showError(message: string): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  function clearError(): void {
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }

  async function persist(): Promise<void> {
    const modeResult = await saveConfig<HudModeConfig>(
      bridge,
      STORAGE_KEYS.HUD_MODE,
      { mode: currentMode },
    );
    const durationResult = await saveConfig<HudDurationConfig>(
      bridge,
      STORAGE_KEYS.HUD_DURATION,
      { displayDurationSeconds: currentDuration },
    );

    if (modeResult.success && durationResult.success) {
      clearError();
    } else {
      showError("Not synced to glasses. Your choice is saved on this phone.");
    }
  }

  function handleDurationChange(): void {
    if (!selectEl) return;
    const next = Number(selectEl.value);
    if (!Number.isFinite(next)) return;
    currentDuration = next;
    updateUI();
    void persist();
  }

  function handleModeChange(mode: HudMode): void {
    if (mode === currentMode) return;
    currentMode = mode;
    updateUI();
    void persist();
  }

  function buildModeButton(mode: HudMode): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "hud-mode-btn";
    button.type = "button";
    button.textContent = MODE_LABEL[mode];
    button.addEventListener("click", () => handleModeChange(mode));
    modeButtons.set(mode, button);
    return button;
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "hud-duration-container";

    const modeLabel = document.createElement("label");
    modeLabel.className = "hud-duration-field-label";
    modeLabel.textContent = "Inactivity Timer";
    wrapper.appendChild(modeLabel);

    const modeGroup = document.createElement("div");
    modeGroup.className = "hud-mode-toggle";
    modeGroup.setAttribute("role", "group");
    modeGroup.setAttribute("aria-label", "HUD inactivity timer");
    modeGroup.appendChild(buildModeButton("always-on"));
    modeGroup.appendChild(buildModeButton("inactivity-timer"));
    wrapper.appendChild(modeGroup);

    modeDescription = document.createElement("p");
    modeDescription.className = "hud-mode-description";
    wrapper.appendChild(modeDescription);

    durationRow = document.createElement("div");
    durationRow.className = "hud-duration-row";

    durationLabel = document.createElement("label");
    durationLabel.className = "hud-duration-field-label";
    durationRow.appendChild(durationLabel);

    selectEl = document.createElement("select");
    selectEl.className = "hud-duration-select";
    selectEl.setAttribute("aria-label", "Seconds of inactivity before sleeping");
    for (const seconds of DURATION_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(seconds);
      option.textContent = `${seconds} seconds`;
      selectEl.appendChild(option);
    }
    selectEl.addEventListener("change", handleDurationChange);
    durationRow.appendChild(selectEl);
    wrapper.appendChild(durationRow);

    infoLabel = document.createElement("div");
    infoLabel.className = "hud-duration-info-label";
    infoLabel.textContent =
      "No timer is running — the HUD stays lit until you exit.";
    wrapper.appendChild(infoLabel);

    const explanation = document.createElement("p");
    explanation.className = "hud-duration-explanation";
    explanation.textContent =
      "Controls how long the HUD appears before it sleeps. Notifications wake it regardless of this setting.";
    wrapper.appendChild(explanation);

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
    currentMode = normalizeHudMode(modeConfig?.mode);

    const durationConfig = await loadConfig<HudDurationConfig>(
      bridge,
      STORAGE_KEYS.HUD_DURATION,
      DEFAULT_HUD_DURATION,
    );
    const stored = durationConfig?.displayDurationSeconds;
    // A stored value from the old 3/8s option set is no longer selectable;
    // snapping to the nearest current option keeps the <select> consistent
    // with what is actually persisted.
    currentDuration = Number.isFinite(stored)
      ? DURATION_OPTIONS.reduce((best, option) =>
          Math.abs(option - stored!) < Math.abs(best - stored!) ? option : best,
        )
      : DEFAULT_HUD_DURATION.displayDurationSeconds;

    updateUI();
  }

  return {
    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
      updateUI();
      void loadSavedValues();
    },

    unmount(): void {
      // Listeners live on elements that are about to be dropped, so removing
      // the subtree is sufficient — and unlike the previous version, which
      // passed fresh closures to removeEventListener, it actually works.
      rootEl?.remove();
      rootEl = null;
      container = null;
      selectEl = null;
      errorEl = null;
      durationRow = null;
      durationLabel = null;
      infoLabel = null;
      modeDescription = null;
      modeButtons.clear();
    },

    getValue(): number {
      return currentDuration;
    },

    getMode(): HudMode {
      return currentMode;
    },
  };
}
