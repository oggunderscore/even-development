// Feature: foresight-webapp-ui
// Shared interfaces, types, constants, and defaults for the Foresight webapp UI.

import { STORAGE_KEYS as SCHEMA_KEYS } from "../storage/schemas";

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

// --- HUD Sleep (inactivity timer) ---

/**
 * `always-on` keeps the HUD lit indefinitely. `inactivity-timer` blanks it
 * after `displayDurationSeconds` without input, so the HUD is not sitting in
 * the wearer's field of view all day; any gesture wakes it again.
 *
 * `"hidden"` is the pre-rename value and is still accepted when reading
 * stored configs so existing installs keep their setting.
 */
export type HudMode = "always-on" | "inactivity-timer";

export interface HudModeConfig {
  mode: HudMode;
}

export interface HudDurationConfig {
  /** Seconds of inactivity before the HUD sleeps. */
  displayDurationSeconds: number;
}

/**
 * Normalises a stored mode, mapping the legacy `"hidden"` value forward.
 */
export function normalizeHudMode(mode: unknown): HudMode {
  return mode === "inactivity-timer" || mode === "hidden"
    ? "inactivity-timer"
    : "always-on";
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

/**
 * Webapp-facing view of the shared key list.
 *
 * Derived from `storage/schemas` rather than redeclared: the two used to be
 * independent literals, which is how the phone and the glasses ended up able
 * to disagree about which key held what.
 */
export const STORAGE_KEYS = {
  ASSISTANT_CONFIG: SCHEMA_KEYS.ASSISTANT_CONFIG,
  WEATHER_LOCATION: SCHEMA_KEYS.WEATHER_LOCATION,
  WEATHER_CONFIG: SCHEMA_KEYS.WEATHER_CONFIG,
  CLOCK_CONFIG: SCHEMA_KEYS.CLOCK_CONFIG,
  REMINDERS: SCHEMA_KEYS.REMINDERS,
  HUD_DURATION: SCHEMA_KEYS.HUD_SLEEP_DELAY,
  HUD_MODE: SCHEMA_KEYS.HUD_SLEEP,
  HUD_LAYOUT: SCHEMA_KEYS.HUD_LAYOUT,
  DOUBLE_TAP_DELAY: SCHEMA_KEYS.DOUBLE_TAP_DELAY,
  DEBUG_LOG: SCHEMA_KEYS.DEBUG_LOG,
  INSTALLED_APPS: SCHEMA_KEYS.INSTALLED_APPS,
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
  displayDurationSeconds: 15,
};

export const DEFAULT_HUD_MODE: HudModeConfig = {
  mode: "always-on",
};

export const DEFAULT_HUD_LAYOUT: HudGrid = [];

/**
 * Selectable inactivity delays, in seconds. Longer than the old banner-style
 * 3-15s range because this now governs how long the HUD stays lit between
 * glances, not how long a notification is shown.
 */
export const DURATION_OPTIONS = [5, 10, 15, 30, 60] as const;

export const DEFAULT_DEBUG_LOG: DebugMessage[] = [];
