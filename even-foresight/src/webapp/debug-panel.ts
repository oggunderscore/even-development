// Feature: foresight-webapp-ui
// DebugPanel — renders input controls for sending test notifications, newslines,
// and weather updates to the glasses overlay via bridge. Maintains a message log
// (max 50 entries, FIFO eviction) and shows bridge offline state.

import type {
  ViewRoute,
  DebugMessage,
  NotificationPayload,
  NewslinePayload,
  WeatherPayload,
} from "./types";
import { STORAGE_KEYS, DEFAULT_DEBUG_LOG } from "./types";
import type { WeatherCache, WeatherCondition } from "../storage/schemas";
import { loadConfig, saveConfig } from "./storage-helpers";

// --- Pure functions exported for property testing ---

/**
 * Creates a notification payload with the given text and an ISO 8601 timestamp.
 * Exported for property tests (Property 13).
 */
export function createNotificationPayload(text: string): NotificationPayload {
  return {
    type: "notification",
    text: text.slice(0, 50),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a newsline payload with the given text and an ISO 8601 timestamp.
 * Exported for property tests (Property 13).
 */
export function createNewslinePayload(text: string): NewslinePayload {
  return {
    type: "newsline",
    text: text.slice(0, 100),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a weather payload with the given temperature, condition, and unit,
 * plus an ISO 8601 timestamp.
 * Exported for property tests (Property 14).
 */
export function createWeatherPayload(
  temperature: number,
  condition: WeatherPayload["condition"],
  unit: WeatherPayload["unit"],
): WeatherPayload {
  return {
    type: "weather",
    temperature,
    condition,
    unit,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Maps the Debug tab's weather condition vocabulary to the app's own
 * `WeatherCondition` (`src/storage/schemas.ts`) — the two were never the
 * same set of strings, which is part of why a debug weather push silently
 * did nothing: nothing in the app understands `"partly cloudy"`. Exported
 * for testing.
 */
export function mapDebugConditionToWeatherCondition(
  condition: WeatherPayload["condition"],
): WeatherCondition {
  const map: Record<WeatherPayload["condition"], WeatherCondition> = {
    clear: "sunny",
    cloudy: "cloudy",
    "partly cloudy": "partly-cloudy",
    rain: "rainy",
    thunderstorm: "stormy",
    snow: "snowy",
    fog: "foggy",
  };
  return map[condition];
}

/**
 * Appends an entry to the log, enforcing a maximum size via FIFO eviction.
 * When the log is full, the oldest entry is removed before appending.
 * Returns a new array (does not mutate input).
 * Exported for property tests (Property 15).
 */
export function appendToLog(
  log: DebugMessage[],
  entry: DebugMessage,
  maxSize: number = 50,
): DebugMessage[] {
  const result = [...log, entry];
  if (result.length > maxSize) {
    return result.slice(result.length - maxSize);
  }
  return result;
}

// --- Debug Panel ViewRoute factory ---

export interface DebugPanelOptions {
  bridge: any | null;
}

/**
 * Creates the Debug Panel view route.
 *
 * Provides:
 * - Notification input (max 50 chars) + Send button
 * - Newsline input (max 100 chars) + Send button
 * - Weather inputs: temperature (-100 to 150), condition dropdown (7 options), unit selector
 * - Message log (max 50 entries, FIFO)
 * - "Bridge Offline" indicator when bridge is null
 * - Disabled send buttons when fields are empty or bridge offline
 */
export function createDebugPanel(options: DebugPanelOptions): ViewRoute & {
  getLog(): DebugMessage[];
} {
  const { bridge } = options;

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let messageLog: DebugMessage[] = [];

  // DOM element references for state updates
  let notificationInput: HTMLInputElement | null = null;
  let notificationSendBtn: HTMLButtonElement | null = null;
  let newslineInput: HTMLInputElement | null = null;
  let newslineSendBtn: HTMLButtonElement | null = null;
  let temperatureInput: HTMLInputElement | null = null;
  let conditionSelect: HTMLSelectElement | null = null;
  let unitSelect: HTMLSelectElement | null = null;
  let weatherSendBtn: HTMLButtonElement | null = null;
  let logContainer: HTMLElement | null = null;
  let offlineIndicator: HTMLElement | null = null;

  const isBridgeAvailable = bridge != null;

  function generateId(): string {
    return `debug-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function updateNotificationSendState(): void {
    if (notificationSendBtn && notificationInput) {
      notificationSendBtn.disabled =
        !isBridgeAvailable || notificationInput.value.trim().length === 0;
    }
  }

  function updateNewslineSendState(): void {
    if (newslineSendBtn && newslineInput) {
      newslineSendBtn.disabled =
        !isBridgeAvailable || newslineInput.value.trim().length === 0;
    }
  }

  function renderLogEntry(entry: DebugMessage): HTMLElement {
    const el = document.createElement("div");
    el.className = "debug-panel-log-entry";

    const typeBadge = document.createElement("span");
    typeBadge.className = `debug-panel-log-type debug-panel-log-type--${entry.type}`;
    typeBadge.textContent = entry.type;

    const content = document.createElement("span");
    content.className = "debug-panel-log-content";
    content.textContent = entry.content;

    const timestamp = document.createElement("span");
    timestamp.className = "debug-panel-log-timestamp";
    timestamp.textContent = entry.timestamp;

    el.appendChild(typeBadge);
    el.appendChild(content);
    el.appendChild(timestamp);

    return el;
  }

  function refreshLogDisplay(): void {
    if (!logContainer) return;
    logContainer.innerHTML = "";

    if (messageLog.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debug-panel-log-empty";
      empty.textContent = "No messages sent yet.";
      logContainer.appendChild(empty);
      return;
    }

    // Display newest first
    for (let i = messageLog.length - 1; i >= 0; i--) {
      logContainer.appendChild(renderLogEntry(messageLog[i]));
    }
  }

  function addLogEntry(
    type: DebugMessage["type"],
    content: string,
    timestamp: string,
  ): void {
    const entry: DebugMessage = {
      id: generateId(),
      type,
      content,
      timestamp,
    };
    messageLog = appendToLog(messageLog, entry, 50);
    refreshLogDisplay();

    // Persist log to storage
    void saveConfig(bridge, STORAGE_KEYS.DEBUG_LOG, messageLog);
  }

  async function handleNotificationSend(): Promise<void> {
    if (!bridge || !notificationInput) return;
    const text = notificationInput.value.trim();
    if (text.length === 0) return;

    const payload = createNotificationPayload(text);
    // A pushed notification isn't a stored setting — it's a one-off action —
    // so it goes out as its own same-document custom event (the glasses
    // runtime is listening in `runtime.ts`) rather than through a storage
    // key. `foresight-config-changed` isn't the right fit here for the same
    // reason: there is no config value to read back later.
    window.dispatchEvent(
      new CustomEvent("foresight-debug-notification", {
        detail: { text: payload.text },
      }),
    );
    addLogEntry("notification", text, payload.timestamp);
    notificationInput.value = "";
    updateNotificationSendState();
  }

  async function handleNewslineSend(): Promise<void> {
    if (!bridge || !newslineInput) return;
    const text = newslineInput.value.trim();
    if (text.length === 0) return;

    const payload = createNewslinePayload(text);
    try {
      await bridge.setLocalStorage(
        "foresight-debug-newsline",
        JSON.stringify(payload),
      );
      addLogEntry("newsline", text, payload.timestamp);
      newslineInput.value = "";
      updateNewslineSendState();
    } catch {
      // Bridge call failed
    }
  }

  async function handleWeatherSend(): Promise<void> {
    if (!bridge || !temperatureInput || !conditionSelect || !unitSelect) return;

    const temperature = Number(temperatureInput.value);
    const condition = conditionSelect.value as WeatherPayload["condition"];
    const unit = unitSelect.value as WeatherPayload["unit"];

    const payload = createWeatherPayload(temperature, condition, unit);

    // Written to the real WEATHER_CACHE key the weather HUD component
    // actually reads (`hud/components/weather.ts`), not a standalone
    // "foresight-debug-weather" key nothing consumed. `saveConfig` fires
    // `foresight-config-changed`, which `home-screen.ts#applyConfigChange`
    // handles for WEATHER_CACHE by refreshing the HUD.
    const cache: WeatherCache = {
      temperature,
      condition: mapDebugConditionToWeatherCondition(condition),
      unit,
      fetchedAt: Date.now(),
    };
    const result = await saveConfig(bridge, STORAGE_KEYS.WEATHER_CACHE, cache);
    if (result.success) {
      const summary = `${temperature}° ${unit === "fahrenheit" ? "F" : "C"}, ${condition}`;
      addLogEntry("weather", summary, payload.timestamp);
    }
  }

  function renderNotificationSection(parent: HTMLElement): void {
    const section = document.createElement("div");
    section.className = "debug-panel-section";

    const label = document.createElement("label");
    label.className = "debug-panel-label";
    label.textContent = "Notification";
    section.appendChild(label);

    const row = document.createElement("div");
    row.className = "debug-panel-input-row";

    notificationInput = document.createElement("input");
    notificationInput.type = "text";
    notificationInput.className = "debug-panel-input";
    notificationInput.placeholder = "Notification text (max 50 chars)";
    notificationInput.maxLength = 50;
    notificationInput.setAttribute("aria-label", "Notification text");
    notificationInput.addEventListener("input", updateNotificationSendState);

    notificationSendBtn = document.createElement("button");
    notificationSendBtn.type = "button";
    notificationSendBtn.className = "debug-panel-send-btn";
    notificationSendBtn.textContent = "Send";
    notificationSendBtn.disabled = true;
    notificationSendBtn.setAttribute("aria-label", "Send notification");
    notificationSendBtn.addEventListener("click", () => {
      void handleNotificationSend();
    });

    row.appendChild(notificationInput);
    row.appendChild(notificationSendBtn);
    section.appendChild(row);
    parent.appendChild(section);
  }

  function renderNewslineSection(parent: HTMLElement): void {
    const section = document.createElement("div");
    section.className = "debug-panel-section";

    const label = document.createElement("label");
    label.className = "debug-panel-label";
    label.textContent = "Newsline";
    section.appendChild(label);

    const row = document.createElement("div");
    row.className = "debug-panel-input-row";

    newslineInput = document.createElement("input");
    newslineInput.type = "text";
    newslineInput.className = "debug-panel-input";
    newslineInput.placeholder = "Newsline text (max 100 chars)";
    newslineInput.maxLength = 100;
    newslineInput.setAttribute("aria-label", "Newsline text");
    newslineInput.addEventListener("input", updateNewslineSendState);

    newslineSendBtn = document.createElement("button");
    newslineSendBtn.type = "button";
    newslineSendBtn.className = "debug-panel-send-btn";
    newslineSendBtn.textContent = "Send";
    newslineSendBtn.disabled = true;
    newslineSendBtn.setAttribute("aria-label", "Send newsline");
    newslineSendBtn.addEventListener("click", () => {
      void handleNewslineSend();
    });

    row.appendChild(newslineInput);
    row.appendChild(newslineSendBtn);
    section.appendChild(row);
    parent.appendChild(section);
  }

  function renderWeatherSection(parent: HTMLElement): void {
    const section = document.createElement("div");
    section.className = "debug-panel-section";

    const label = document.createElement("label");
    label.className = "debug-panel-label";
    label.textContent = "Weather";
    section.appendChild(label);

    const row = document.createElement("div");
    row.className = "debug-panel-input-row debug-panel-input-row--weather";

    // Temperature input
    temperatureInput = document.createElement("input");
    temperatureInput.type = "number";
    temperatureInput.className =
      "debug-panel-input debug-panel-input--temperature";
    temperatureInput.placeholder = "Temp";
    temperatureInput.min = "-100";
    temperatureInput.max = "150";
    temperatureInput.value = "72";
    temperatureInput.setAttribute("aria-label", "Temperature");

    // Condition dropdown
    conditionSelect = document.createElement("select");
    conditionSelect.className =
      "debug-panel-select debug-panel-select--condition";
    conditionSelect.setAttribute("aria-label", "Weather condition");

    const conditions: WeatherPayload["condition"][] = [
      "clear",
      "cloudy",
      "partly cloudy",
      "rain",
      "thunderstorm",
      "snow",
      "fog",
    ];

    for (const cond of conditions) {
      const opt = document.createElement("option");
      opt.value = cond;
      opt.textContent = cond.charAt(0).toUpperCase() + cond.slice(1);
      conditionSelect.appendChild(opt);
    }

    // Unit selector
    unitSelect = document.createElement("select");
    unitSelect.className = "debug-panel-select debug-panel-select--unit";
    unitSelect.setAttribute("aria-label", "Temperature unit");

    const units: { value: WeatherPayload["unit"]; label: string }[] = [
      { value: "fahrenheit", label: "°F" },
      { value: "celsius", label: "°C" },
    ];

    for (const u of units) {
      const opt = document.createElement("option");
      opt.value = u.value;
      opt.textContent = u.label;
      unitSelect.appendChild(opt);
    }

    // Weather send button
    weatherSendBtn = document.createElement("button");
    weatherSendBtn.type = "button";
    weatherSendBtn.className = "debug-panel-send-btn";
    weatherSendBtn.textContent = "Send";
    weatherSendBtn.disabled = !isBridgeAvailable;
    weatherSendBtn.setAttribute("aria-label", "Send weather update");
    weatherSendBtn.addEventListener("click", () => {
      void handleWeatherSend();
    });

    row.appendChild(temperatureInput);
    row.appendChild(conditionSelect);
    row.appendChild(unitSelect);
    row.appendChild(weatherSendBtn);
    section.appendChild(row);
    parent.appendChild(section);
  }

  function renderLogSection(parent: HTMLElement): void {
    const section = document.createElement("div");
    section.className = "debug-panel-section debug-panel-section--log";

    const label = document.createElement("h3");
    label.className = "debug-panel-label";
    label.textContent = "Message Log";
    section.appendChild(label);

    logContainer = document.createElement("div");
    logContainer.className = "debug-panel-log";
    logContainer.setAttribute("role", "log");
    logContainer.setAttribute("aria-label", "Debug message log");
    section.appendChild(logContainer);

    parent.appendChild(section);
  }

  function renderResetSection(parent: HTMLElement): void {
    const section = document.createElement("div");
    section.className = "debug-panel-section";

    const label = document.createElement("label");
    label.className = "debug-panel-label";
    label.textContent = "Reset";
    section.appendChild(label);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "debug-panel-send-btn";
    resetBtn.style.cssText =
      "border-color: #ff3333; color: #ff3333; width: 100%; margin-top: 8px;";
    resetBtn.textContent = "Reset Onboarding";
    resetBtn.disabled = !isBridgeAvailable;
    resetBtn.setAttribute("aria-label", "Reset onboarding state");
    resetBtn.addEventListener("click", async () => {
      if (!bridge) return;
      resetBtn.disabled = true;
      resetBtn.textContent = "Resetting...";
      try {
        await bridge.setLocalStorage("foresight-user-profile-v1", "");
        localStorage.removeItem("foresight-user-profile-v1");
        addLogEntry(
          "notification",
          "Onboarding reset — reload app on glasses",
          new Date().toISOString(),
        );
      } catch {
        // ignore
      }
      resetBtn.disabled = false;
      resetBtn.textContent = "Reset Onboarding";
    });

    section.appendChild(resetBtn);
    parent.appendChild(section);
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "debug-panel-container";

    // Bridge offline indicator
    offlineIndicator = document.createElement("div");
    offlineIndicator.className = "debug-panel-offline";
    offlineIndicator.textContent = "Bridge Offline";
    offlineIndicator.setAttribute("role", "status");
    offlineIndicator.style.display = isBridgeAvailable ? "none" : "block";
    wrapper.appendChild(offlineIndicator);

    // Input sections
    renderNotificationSection(wrapper);
    renderNewslineSection(wrapper);
    renderWeatherSection(wrapper);

    // Reset section
    renderResetSection(wrapper);

    // Log section
    renderLogSection(wrapper);

    return wrapper;
  }

  async function loadLog(): Promise<void> {
    const loaded = await loadConfig<DebugMessage[]>(
      bridge,
      STORAGE_KEYS.DEBUG_LOG,
      DEFAULT_DEBUG_LOG,
    );
    messageLog = loaded;
    refreshLogDisplay();
  }

  return {
    id: "debug",
    label: "Debug",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);

      // Load saved log entries
      void loadLog();
    },

    unmount(): void {
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
      notificationInput = null;
      notificationSendBtn = null;
      newslineInput = null;
      newslineSendBtn = null;
      temperatureInput = null;
      conditionSelect = null;
      unitSelect = null;
      weatherSendBtn = null;
      logContainer = null;
      offlineIndicator = null;
    },

    getLog(): DebugMessage[] {
      return [...messageLog];
    },
  };
}
