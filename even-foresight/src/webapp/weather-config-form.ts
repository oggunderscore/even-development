// Feature: foresight-webapp-ui
// WeatherConfigForm — renders weather location configuration with geolocation
// toggle, manual location input, validation, and bridge persistence.

import type { ViewRoute, WeatherLocationConfig } from "./types";
import { STORAGE_KEYS, DEFAULT_WEATHER_LOCATION } from "./types";
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

  // DOM references
  let toggleInput: HTMLInputElement | null = null;
  let locationInput: HTMLInputElement | null = null;
  let errorEl: HTMLElement | null = null;
  let saveBtn: HTMLButtonElement | null = null;
  let statusEl: HTMLElement | null = null;

  async function loadState(): Promise<void> {
    config = await loadConfig<WeatherLocationConfig>(
      bridge,
      STORAGE_KEYS.WEATHER_LOCATION,
      { ...DEFAULT_WEATHER_LOCATION },
    );
    updateUI();
  }

  function updateUI(): void {
    if (!toggleInput || !locationInput) return;

    toggleInput.checked = config.useCurrentLocation;
    locationInput.value = config.manualLocation;
    locationInput.disabled = config.useCurrentLocation;

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

  async function handleSave(): Promise<void> {
    clearError();
    clearStatus();

    // Validate manual location when not using current location
    if (!config.useCurrentLocation) {
      const location = locationInput?.value ?? config.manualLocation;
      if (!validateLocation(location)) {
        showError("Location must be between 1 and 50 characters");
        return;
      }
      config.manualLocation = location;
    }

    const result = await saveConfig<WeatherLocationConfig>(
      bridge,
      STORAGE_KEYS.WEATHER_LOCATION,
      config,
    );

    if (result.success) {
      showStatus("Location saved", "success");
    } else {
      showStatus(
        "Location could not be synced. Please check your connection.",
        "error",
      );
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
    locationInput.addEventListener("input", handleLocationInput);

    inputLabel.appendChild(locationInput);
    inputGroup.appendChild(inputLabel);
    wrapper.appendChild(inputGroup);

    // Save button
    saveBtn = document.createElement("button");
    saveBtn.className = "weather-config-save-btn";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", handleSave);
    wrapper.appendChild(saveBtn);

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
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
      toggleInput = null;
      locationInput = null;
      errorEl = null;
      saveBtn = null;
      statusEl = null;
    },
  };
}
