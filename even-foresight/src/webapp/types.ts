// Feature: foresight-webapp-ui
// Shared interfaces, types, constants, and defaults for the Foresight webapp UI.

// --- Core View/Navigation Interfaces ---

export interface ViewRoute {
  id: string;
  label: string;
  mount(container: HTMLElement): void;
  unmount(): void;
}

export interface NavTab {
  id: string;
  label: string;
}

// --- App List & Marketplace ---

export interface AppEntry {
  id: string;
  name: string;
  description: string; // max 80 chars
  source: "pre-installed" | "marketplace";
  hasConfig: boolean;
}

export interface MarketplaceApp {
  id: string;
  name: string;
  description: string;
  category: MarketplaceCategory;
  author: string;
}

export type MarketplaceCategory =
  | "productivity"
  | "social"
  | "health"
  | "entertainment"
  | "utilities";

// --- Assistant Config ---

export interface AssistantConfig {
  sttProvider: string;
  llmProvider: "anthropic" | "openai" | null;
  conversationMemory: boolean;
  contextAwareness: boolean;
  aboutMe: string; // 1–500 chars
  objectives: string; // 1–500 chars
}

// --- Weather Config ---

export interface WeatherLocationConfig {
  useCurrentLocation: boolean;
  manualLocation: string; // max 50 chars
  lastKnownCoords: { lat: number; lng: number } | null;
}

// --- Widget Size Map ---

export interface WidgetSize {
  cols: number; // column span (1–5)
  rows: number; // row span (1–2)
}

/** Fixed size definitions for each widget type. */
export const WIDGET_SIZES: Record<string, WidgetSize> = {
  clock: { cols: 1, rows: 1 },
  weather: { cols: 1, rows: 1 },
  reminders: { cols: 1, rows: 1 },
  assistant: { cols: 1, rows: 1 },
  tasks: { cols: 1, rows: 1 },
} as const;

// --- Grid Placement ---

export interface WidgetPlacement {
  widgetId: string; // e.g. "clock", "weather"
  col: number; // 0-based column of top-left anchor
  row: number; // 0-based row of top-left anchor
}

/**
 * The HUD grid state: a list of placed widgets.
 * Grid is 2 rows × 5 columns. Each placement occupies cells
 * determined by WIDGET_SIZES[widgetId].
 */
export type HudGrid = WidgetPlacement[];

// --- HUD Mode ---

export type HudMode = "always-on" | "hidden";

export interface HudModeConfig {
  mode: HudMode;
}

// --- HUD Duration ---

export interface HudDurationConfig {
  displayDurationSeconds: number; // now restricted to 3 | 5 | 8 | 10 | 15
}

// --- General Settings ---

export interface GeneralSettings {
  clockFormat: "12h" | "24h";
  temperatureUnit: "fahrenheit" | "celsius";
  notificationDurationSeconds: number; // 3–15, 1s increments
}

// --- Debug Panel ---

export interface DebugMessage {
  id: string;
  type: "notification" | "newsline" | "weather";
  content: string;
  timestamp: string; // ISO 8601
}

export interface NotificationPayload {
  type: "notification";
  text: string; // max 50 chars
  timestamp: string; // ISO 8601
}

export interface NewslinePayload {
  type: "newsline";
  text: string; // max 100 chars
  timestamp: string; // ISO 8601
}

export interface WeatherPayload {
  type: "weather";
  temperature: number; // -100 to 150
  condition:
    | "clear"
    | "cloudy"
    | "partly cloudy"
    | "rain"
    | "thunderstorm"
    | "snow"
    | "fog";
  unit: "fahrenheit" | "celsius";
  timestamp: string; // ISO 8601
}

// --- Storage Key Constants ---

export const STORAGE_KEYS = {
  ASSISTANT_CONFIG: "foresight-assistant-config-v1",
  WEATHER_LOCATION: "foresight-weather-location-v1",
  HUD_DURATION: "foresight-hud-duration-v1",
  HUD_MODE: "foresight-hud-mode-v1",
  HUD_LAYOUT: "foresight-hud-layout-v1",
  GENERAL_SETTINGS: "foresight-general-settings-v1",
  DEBUG_LOG: "foresight-debug-log-v1",
  INSTALLED_APPS: "foresight-installed-apps-v1",
} as const;

// --- Default Values ---

export const DEFAULT_APPS: AppEntry[] = [
  {
    id: "clock",
    name: "Clock",
    description: "Digital clock widget for the HUD home page",
    source: "pre-installed",
    hasConfig: true,
  },
  {
    id: "weather",
    name: "Weather",
    description: "Weather forecast and current conditions widget",
    source: "pre-installed",
    hasConfig: true,
  },
  {
    id: "assistant",
    name: "Assistant",
    description: "AI-powered voice assistant with configurable LLM",
    source: "pre-installed",
    hasConfig: true,
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Task and reminder management for quick reference",
    source: "pre-installed",
    hasConfig: true,
  },
];

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  sttProvider: "whisper",
  llmProvider: null,
  conversationMemory: false,
  contextAwareness: false,
  aboutMe: "",
  objectives: "",
};

export const DEFAULT_WEATHER_LOCATION: WeatherLocationConfig = {
  useCurrentLocation: false,
  manualLocation: "Irvine, California, USA 92618",
  lastKnownCoords: null,
};

export const DEFAULT_HUD_DURATION: HudDurationConfig = {
  displayDurationSeconds: 5,
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  clockFormat: "12h",
  temperatureUnit: "fahrenheit",
  notificationDurationSeconds: 5,
};

export const DEFAULT_HUD_MODE: HudModeConfig = {
  mode: "always-on",
};

export const DEFAULT_HUD_LAYOUT: HudGrid = [];

export const DURATION_OPTIONS = [3, 5, 8, 10, 15] as const;

export const DEFAULT_DEBUG_LOG: DebugMessage[] = [];
