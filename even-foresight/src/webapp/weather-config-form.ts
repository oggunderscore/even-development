// Feature: foresight-webapp-ui
// WeatherConfigForm — renders weather location configuration with geolocation
// toggle, display options (temp, condition, humidity, unit), and bridge persistence.

import type { ViewRoute, WeatherLocationConfig } from "./types";
import { STORAGE_KEYS, DEFAULT_WEATHER_LOCATION } from "./types";
import {
  STORAGE_KEYS as SCHEMA_KEYS,
  DEFAULT_WEATHER_CONFIG,
  type WeatherConfig,
} from "../storage/schemas";
import { loadConfig, saveConfig } from "./storage-helpers";

/**
 * Validate a manual location string.
 * Accepts strings with length in [1, 50], rejects length 0 or > 50.
 * Exported for property testing.
 */
export function validateLocation(location: string): boolean {
  return location.length >= 1 && location.length <= 50;
}

export interface WeatherConfigFormOptions {
  bridge: any | null;
  onBack?: () => void;
}

/**
 * Creates the Weather configuration form view route.
 * Renders a "Use Current Location" toggle and manual location input,
 * handles geolocation requests, validates input, and persists via bridge.
 */
export function createWeatherConfigForm(
  options: WeatherConfigFormOptions,
): ViewRoute {
  const { bridge, onBack } = options;
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let config: WeatherLocationConfig = { ...DEFAULT_WEATHER_LOCATION };
  let weatherConfig: WeatherConfig = { ...DEFAULT_WEATHER_CONFIG };

  // DOM references
  let toggleInput: HTMLInputElement | null = null;
  let locationInput: HTMLInputElement | null = null;
  let errorEl: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let unitSelect: HTMLSelectElement | null = null;
  const displayCheckboxes = new Map<
    "showTemperature" | "showCondition" | "showHumidity",
    HTMLInputElement
  >();

  // Pending timers, cleared on unmount so a save cannot fire into a
  // torn-down form.
  let locationSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadState(): Promise<void> {
    config = await loadConfig<WeatherLocationConfig>(
      bridge,
      STORAGE_KEYS.WEATHER_LOCATION,
      { ...DEFAULT_WEATHER_LOCATION },
    );
    weatherConfig = await loadConfig<WeatherConfig>(
      bridge,
      SCHEMA_KEYS.WEATHER_CONFIG,
      { ...DEFAULT_WEATHER_CONFIG },
    );
    updateUI();
  }

  function updateUI(): void {
    if (!toggleInput || !locationInput) return;

    toggleInput.checked = config.useCurrentLocation;
    locationInput.value = config.manualLocation;
    locationInput.disabled = config.useCurrentLocation;

    // The display controls are rendered before loadState() resolves, so they
    // must be re-synced here or saved settings appear to have been discarded.
    if (unitSelect) {
      unitSelect.value = weatherConfig.unit;
    }
    for (const [key, checkbox] of displayCheckboxes) {
      checkbox.checked = weatherConfig[key] !== false;
    }

    clearError();
    clearStatus();
  }

  function clearError(): void {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.remove("weather-config-error--visible");
    }
  }

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add("weather-config-error--visible");
    }
  }

  function clearStatus(): void {
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove(
        "weather-config-status--success",
        "weather-config-status--error",
      );
    }
  }

  function showStatus(message: string, type: "success" | "error"): void {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.classList.add(`weather-config-status--${type}`);
    }
  }

  function handleToggleChange(): void {
    if (!toggleInput || !locationInput) return;

    if (toggleInput.checked) {
      // Request geolocation
      if (!navigator.geolocation) {
        showError("Location permission is required to use current position");
        toggleInput.checked = false;
        locationInput.disabled = false;
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Success: store coords, disable manual input
          config.useCurrentLocation = true;
          config.lastKnownCoords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          if (locationInput) {
            locationInput.disabled = true;
          }
          clearError();
          void autoSave();
        },
        () => {
          // Denied/Error: show error, revert toggle, re-enable input
          showError("Location permission is required to use current position");
          if (toggleInput) {
            toggleInput.checked = false;
          }
          config.useCurrentLocation = false;
          if (locationInput) {
            locationInput.disabled = false;
          }
        },
      );
    } else {
      // Toggle disabled: enable manual input
      config.useCurrentLocation = false;
      locationInput.disabled = false;
      clearError();
      void autoSave();
    }
  }

  function handleLocationInput(): void {
    if (!locationInput) return;
    // Enforce max 50 chars
    if (locationInput.value.length > 50) {
      locationInput.value = locationInput.value.slice(0, 50);
    }
    config.manualLocation = locationInput.value;
  }

  /** Debounced auto-save while the user is still typing a location. */
  function handleLocationInputWithSave(): void {
    handleLocationInput();
    if (locationSaveTimer) clearTimeout(locationSaveTimer);
    locationSaveTimer = setTimeout(() => {
      locationSaveTimer = null;
      if (config.manualLocation.length > 0) {
        void autoSave();
      }
    }, 800);
  }

  /** Persists both records and reports the outcome. */
  async function autoSave(): Promise<void> {
    clearError();
    clearStatus();

    const [locationResult, configResult] = await Promise.all([
      saveConfig<WeatherLocationConfig>(
        bridge,
        STORAGE_KEYS.WEATHER_LOCATION,
        config,
      ),
      saveConfig<WeatherConfig>(
        bridge,
        SCHEMA_KEYS.WEATHER_CONFIG,
        weatherConfig,
      ),
    ]);

    if (statusClearTimer) clearTimeout(statusClearTimer);

    if (locationResult.success && configResult.success) {
      showStatus("Saved", "success");
      statusClearTimer = setTimeout(() => {
        statusClearTimer = null;
        clearStatus();
      }, 2000);
    } else {
      // Saying nothing here is what previously made a failed sync look like
      // a successful one.
      showStatus("Saved on phone, but not synced to glasses.", "error");
    }
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "weather-config-container";

    // Back button
    if (onBack) {
      const backBtn = document.createElement("button");
      backBtn.className = "app-config-back-btn";
      backBtn.textContent = "← Apps";
      backBtn.addEventListener("click", onBack);
      wrapper.appendChild(backBtn);
    }

    // Toggle row
    const toggleRow = document.createElement("div");
    toggleRow.className = "weather-config-toggle-row";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "weather-config-toggle-label";
    toggleLabel.textContent = "Use Current Location";

    toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.className = "weather-config-toggle";
    toggleInput.checked = config.useCurrentLocation;
    toggleInput.addEventListener("change", handleToggleChange);

    toggleLabel.prepend(toggleInput);
    toggleRow.appendChild(toggleLabel);
    wrapper.appendChild(toggleRow);

    // Error message area
    errorEl = document.createElement("div");
    errorEl.className = "weather-config-error";
    wrapper.appendChild(errorEl);

    // Manual location input
    const inputGroup = document.createElement("div");
    inputGroup.className = "weather-config-input-group";

    const inputLabel = document.createElement("label");
    inputLabel.className = "weather-config-input-label";
    inputLabel.textContent = "Location";

    locationInput = document.createElement("input");
    locationInput.type = "text";
    locationInput.className = "weather-config-input";
    locationInput.maxLength = 50;
    locationInput.placeholder = "City, Region, Postal Code";
    locationInput.value = config.manualLocation;
    locationInput.disabled = config.useCurrentLocation;
    locationInput.addEventListener("input", handleLocationInputWithSave);

    inputLabel.appendChild(locationInput);
    inputGroup.appendChild(inputLabel);
    wrapper.appendChild(inputGroup);

    // ── Display Settings ──
    const displaySection = document.createElement("div");
    displaySection.className = "weather-config-section";
    displaySection.style.marginTop = "20px";
    displaySection.style.paddingTop = "16px";
    displaySection.style.borderTop = "1px solid var(--border)";

    const displayTitle = document.createElement("h3");
    displayTitle.style.cssText =
      "font-size:11px;font-weight:500;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;";
    displayTitle.textContent = "# Widget Display";
    displaySection.appendChild(displayTitle);

    // Unit selector
    const unitRow = document.createElement("div");
    unitRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:8px 0;";
    const unitLabel = document.createElement("span");
    unitLabel.style.cssText = "font-size:12px;color:var(--text);";
    unitLabel.textContent = "Temperature Unit";
    unitSelect = document.createElement("select");
    unitSelect.style.cssText =
      "padding:8px 12px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-family:var(--font);text-transform:uppercase;letter-spacing:1px;cursor:pointer;appearance:none;";
    const optF = document.createElement("option");
    optF.value = "fahrenheit";
    optF.textContent = "°F";
    optF.style.cssText = "background:#0a0a0a;color:#e0e0e0;";
    const optC = document.createElement("option");
    optC.value = "celsius";
    optC.textContent = "°C";
    optC.style.cssText = "background:#0a0a0a;color:#e0e0e0;";
    unitSelect.appendChild(optF);
    unitSelect.appendChild(optC);
    unitSelect.value = weatherConfig.unit;
    unitSelect.addEventListener("change", () => {
      weatherConfig.unit = unitSelect!.value as "fahrenheit" | "celsius";
      void autoSave();
    });
    unitRow.appendChild(unitLabel);
    unitRow.appendChild(unitSelect);
    displaySection.appendChild(unitRow);

    // Checkboxes for display options
    const checkboxes = [
      { key: "showTemperature", label: "Show Temperature" },
      { key: "showCondition", label: "Show Condition" },
      { key: "showHumidity", label: "Show Humidity" },
    ] as const;

    displayCheckboxes.clear();
    for (const { key, label } of checkboxes) {
      const row = document.createElement("label");
      row.style.cssText =
        "display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;color:var(--text);";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = weatherConfig[key] !== false;
      cb.addEventListener("change", () => {
        weatherConfig[key] = cb.checked;
        void autoSave();
      });
      const span = document.createElement("span");
      span.textContent = label;
      row.appendChild(cb);
      row.appendChild(span);
      displaySection.appendChild(row);
      displayCheckboxes.set(key, cb);
    }

    wrapper.appendChild(displaySection);

    // Status message area
    statusEl = document.createElement("div");
    statusEl.className = "weather-config-status";
    wrapper.appendChild(statusEl);

    return wrapper;
  }

  return {
    id: "weather-config",
    label: "Weather",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
      loadState();
    },

    unmount(): void {
      if (locationSaveTimer) clearTimeout(locationSaveTimer);
      if (statusClearTimer) clearTimeout(statusClearTimer);
      locationSaveTimer = null;
      statusClearTimer = null;

      rootEl?.remove();
      rootEl = null;
      container = null;
      toggleInput = null;
      locationInput = null;
      errorEl = null;
      statusEl = null;
      unitSelect = null;
      displayCheckboxes.clear();
    },
  };
}
