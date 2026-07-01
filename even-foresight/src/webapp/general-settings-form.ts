// Feature: foresight-webapp-ui
// GeneralSettingsForm — renders clock format, temperature unit, and notification
// duration controls. Persists each change via bridge within 1s, loads saved
// preferences on mount (within 3s), and shows error if bridge unavailable.

import type { GeneralSettings } from "./types";
import { STORAGE_KEYS, DEFAULT_GENERAL_SETTINGS } from "./types";
import { loadConfig, saveConfig } from "./storage-helpers";

/**
 * Clamp notification duration to an integer in [3, 15].
 * Values below 3 map to 3, values above 15 map to 15, fractional values
 * are rounded to the nearest integer.
 * Exported as a pure function for property testing.
 */
export function clampNotificationDuration(value: number): number {
  const rounded = Math.round(value);
  return Math.min(15, Math.max(3, rounded));
}

export interface GeneralSettingsFormInstance {
  mount(container: HTMLElement): void;
  unmount(): void;
  getSettings(): GeneralSettings;
}

export interface GeneralSettingsFormOptions {
  bridge: any | null;
}

/**
 * Creates the General Settings form component.
 * Renders clock format selector (12h/24h), temperature unit selector
 * (Fahrenheit/Celsius), and notification duration stepper (3–15s).
 * Persists each change via bridge immediately. Loads saved preferences on mount.
 */
export function createGeneralSettingsForm(
  options: GeneralSettingsFormOptions,
): GeneralSettingsFormInstance {
  const { bridge } = options;

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let settings: GeneralSettings = { ...DEFAULT_GENERAL_SETTINGS };
  let errorEl: HTMLElement | null = null;

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }
  }

  function hideError(): void {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  async function persistSettings(): Promise<void> {
    const result = await saveConfig(
      bridge,
      STORAGE_KEYS.GENERAL_SETTINGS,
      settings,
    );
    if (!result.success) {
      showError("Value cannot be synced to glasses.");
    } else {
      hideError();
    }
  }

  function renderClockFormatSelector(parent: HTMLElement): void {
    const group = document.createElement("fieldset");
    group.className = "general-settings-fieldset";

    const legend = document.createElement("legend");
    legend.className = "general-settings-legend";
    legend.textContent = "Clock Format";
    group.appendChild(legend);

    const radioContainer = document.createElement("div");
    radioContainer.className = "general-settings-radio-group";

    const options12h = createRadioOption(
      "clock-format",
      "12h",
      "12-hour",
      settings.clockFormat === "12h",
    );
    const options24h = createRadioOption(
      "clock-format",
      "24h",
      "24-hour",
      settings.clockFormat === "24h",
    );

    options12h.input.addEventListener("change", () => {
      if (options12h.input.checked) {
        settings = { ...settings, clockFormat: "12h" };
        void persistSettings();
      }
    });

    options24h.input.addEventListener("change", () => {
      if (options24h.input.checked) {
        settings = { ...settings, clockFormat: "24h" };
        void persistSettings();
      }
    });

    radioContainer.appendChild(options12h.label);
    radioContainer.appendChild(options24h.label);
    group.appendChild(radioContainer);
    parent.appendChild(group);
  }

  function renderTemperatureUnitSelector(parent: HTMLElement): void {
    const group = document.createElement("fieldset");
    group.className = "general-settings-fieldset";

    const legend = document.createElement("legend");
    legend.className = "general-settings-legend";
    legend.textContent = "Temperature Unit";
    group.appendChild(legend);

    const radioContainer = document.createElement("div");
    radioContainer.className = "general-settings-radio-group";

    const optionF = createRadioOption(
      "temp-unit",
      "fahrenheit",
      "Fahrenheit",
      settings.temperatureUnit === "fahrenheit",
    );
    const optionC = createRadioOption(
      "temp-unit",
      "celsius",
      "Celsius",
      settings.temperatureUnit === "celsius",
    );

    optionF.input.addEventListener("change", () => {
      if (optionF.input.checked) {
        settings = { ...settings, temperatureUnit: "fahrenheit" };
        void persistSettings();
      }
    });

    optionC.input.addEventListener("change", () => {
      if (optionC.input.checked) {
        settings = { ...settings, temperatureUnit: "celsius" };
        void persistSettings();
      }
    });

    radioContainer.appendChild(optionF.label);
    radioContainer.appendChild(optionC.label);
    group.appendChild(radioContainer);
    parent.appendChild(group);
  }

  function renderNotificationDurationStepper(parent: HTMLElement): void {
    const group = document.createElement("fieldset");
    group.className = "general-settings-fieldset";

    const legend = document.createElement("legend");
    legend.className = "general-settings-legend";
    legend.textContent = "Notification Duration";
    group.appendChild(legend);

    const stepperContainer = document.createElement("div");
    stepperContainer.className = "general-settings-stepper";

    const decrementBtn = document.createElement("button");
    decrementBtn.className = "general-settings-stepper-btn";
    decrementBtn.textContent = "−";
    decrementBtn.type = "button";
    decrementBtn.setAttribute("aria-label", "Decrease notification duration");

    const valueDisplay = document.createElement("span");
    valueDisplay.className = "general-settings-stepper-value";
    valueDisplay.textContent = `${settings.notificationDurationSeconds}s`;

    const incrementBtn = document.createElement("button");
    incrementBtn.className = "general-settings-stepper-btn";
    incrementBtn.type = "button";
    incrementBtn.textContent = "+";
    incrementBtn.setAttribute("aria-label", "Increase notification duration");

    function updateStepperDisplay(): void {
      valueDisplay.textContent = `${settings.notificationDurationSeconds}s`;
      decrementBtn.disabled = settings.notificationDurationSeconds <= 3;
      incrementBtn.disabled = settings.notificationDurationSeconds >= 15;
    }

    decrementBtn.addEventListener("click", () => {
      const newVal = clampNotificationDuration(
        settings.notificationDurationSeconds - 1,
      );
      settings = { ...settings, notificationDurationSeconds: newVal };
      updateStepperDisplay();
      void persistSettings();
    });

    incrementBtn.addEventListener("click", () => {
      const newVal = clampNotificationDuration(
        settings.notificationDurationSeconds + 1,
      );
      settings = { ...settings, notificationDurationSeconds: newVal };
      updateStepperDisplay();
      void persistSettings();
    });

    stepperContainer.appendChild(decrementBtn);
    stepperContainer.appendChild(valueDisplay);
    stepperContainer.appendChild(incrementBtn);
    group.appendChild(stepperContainer);

    // Update initial button states
    updateStepperDisplay();

    parent.appendChild(group);
  }

  function createRadioOption(
    groupName: string,
    value: string,
    labelText: string,
    checked: boolean,
  ): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = document.createElement("label");
    label.className = "general-settings-radio-label";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = groupName;
    input.value = value;
    input.checked = checked;
    input.className = "general-settings-radio-input";

    const span = document.createElement("span");
    span.className = "general-settings-radio-text";
    span.textContent = labelText;

    label.appendChild(input);
    label.appendChild(span);

    return { label, input };
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "general-settings-container";

    const heading = document.createElement("h3");
    heading.className = "general-settings-heading";
    heading.textContent = "General Settings";
    wrapper.appendChild(heading);

    // Error display
    errorEl = document.createElement("div");
    errorEl.className = "general-settings-error";
    errorEl.style.display = "none";
    errorEl.setAttribute("role", "alert");
    wrapper.appendChild(errorEl);

    // Render controls
    renderClockFormatSelector(wrapper);
    renderTemperatureUnitSelector(wrapper);
    renderNotificationDurationStepper(wrapper);

    return wrapper;
  }

  async function loadSettings(): Promise<void> {
    const loaded = await loadConfig<GeneralSettings>(
      bridge,
      STORAGE_KEYS.GENERAL_SETTINGS,
      DEFAULT_GENERAL_SETTINGS,
    );
    settings = loaded;

    // Re-render with loaded settings
    if (rootEl && container) {
      container.removeChild(rootEl);
      rootEl = render();
      container.appendChild(rootEl);
    }
  }

  return {
    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);

      // Load saved preferences from bridge (within 3s)
      void loadSettings();
    },

    unmount(): void {
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
      errorEl = null;
    },

    getSettings(): GeneralSettings {
      return { ...settings };
    },
  };
}
