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
  HUD_DURATION_MIN_S,
  HUD_DURATION_MAX_S,
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
  let durationInput: HTMLInputElement | null = null;
  let errorEl: HTMLElement | null = null;
  let durationRow: HTMLElement | null = null;
  let durationLabel: HTMLElement | null = null;
  let infoLabel: HTMLElement | null = null;
  let modeDescription: HTMLElement | null = null;
  const modeButtons = new Map<HudMode, HTMLButtonElement>();

  function updateUI(): void {
    const sleeps = currentMode === "inactivity-timer";

    if (durationInput) {
      durationInput.value = String(currentDuration);
      durationInput.disabled = !sleeps;
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
      // Matches the CSS in index.html (`.hud-mode-btn.active`) — this
      // previously toggled a differently-named "hud-mode-btn--active" class
      // that no stylesheet rule targeted, so the active mode never looked
      // any different from the inactive one.
      const active = mode === currentMode;
      button.classList.toggle("active", active);
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
    if (!durationInput) return;
    const raw = Number(durationInput.value);
    const next = Number.isFinite(raw)
      ? Math.round(
          Math.min(HUD_DURATION_MAX_S, Math.max(HUD_DURATION_MIN_S, raw)),
        )
      : currentDuration;
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

    durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.className = "hud-duration-input";
    durationInput.min = String(HUD_DURATION_MIN_S);
    durationInput.max = String(HUD_DURATION_MAX_S);
    durationInput.step = "1";
    durationInput.inputMode = "numeric";
    durationInput.setAttribute(
      "aria-label",
      `Seconds of inactivity before sleeping (${HUD_DURATION_MIN_S}–${HUD_DURATION_MAX_S})`,
    );
    // "change" (not "input") so an in-progress keystroke isn't clamped mid-type.
    durationInput.addEventListener("change", handleDurationChange);
    durationRow.appendChild(durationInput);
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
    // A value stored under an older preset list still needs to fit today's
    // range — clamp rather than snap, since any in-range value is now valid.
    currentDuration = Number.isFinite(stored)
      ? Math.round(
          Math.min(HUD_DURATION_MAX_S, Math.max(HUD_DURATION_MIN_S, stored!)),
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
      durationInput = null;
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
