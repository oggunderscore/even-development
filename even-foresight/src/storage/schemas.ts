import type { HudComponentType } from "../hud/types";

/**
 * Every localStorage key Foresight uses, in one place.
 *
 * The phone webapp and the glasses runtime share a single localStorage via
 * the SDK bridge, so a key written by one side is read by the other. Adding a
 * key here is not enough — the glasses runtime only sees keys it explicitly
 * hydrates in `main.ts` (`storage.loadKeys([...])`), because bridge reads are
 * async while `StorageManager.get()` is synchronous.
 */
export const STORAGE_KEYS = {
  USER_PROFILE: "foresight-user-profile-v1",
  HUD_LAYOUT: "foresight-hud-layout-v1",
  CLOCK_CONFIG: "foresight-clock-config-v1",
  WEATHER_CONFIG: "foresight-weather-config-v1",
  WEATHER_CACHE: "foresight-weather-cache-v1",
  WEATHER_LOCATION: "foresight-weather-location-v1",
  REMINDERS: "foresight-reminders-v1",
  MENU_ORDER: "foresight-menu-order-v1",
  BANNER_CONFIG: "foresight-banner-config-v1",
  ASSISTANT_CONFIG: "foresight-assistant-config-v1",
  HUD_SLEEP: "foresight-hud-mode-v1",
  HUD_SLEEP_DELAY: "foresight-hud-duration-v1",
  DOUBLE_TAP_DELAY: "foresight-doubletap-delay-v1",
  DEBUG_LOG: "foresight-debug-log-v1",
  INSTALLED_APPS: "foresight-installed-apps-v1",
  SMARTER_EVERYDAY_TOPICS: "foresight-smarter-everyday-topics-v1",
  SMARTER_EVERYDAY_LOGS: "foresight-smarter-everyday-logs-v1",
  SMARTER_EVERYDAY_SETTINGS: "foresight-smarter-everyday-settings-v1",
  NOTIFICATION_HISTORY: "foresight-notification-history-v1",
} as const;

// === HUD Layout ===

export interface HudLayoutConfig {
  slots: Array<{
    row: 0 | 1;
    col: 0 | 1 | 2 | 3 | 4;
    componentType: HudComponentType | null;
  }>;
}

export const DEFAULT_HUD_LAYOUT: HudLayoutConfig = {
  slots: Array.from({ length: 10 }, (_, i) => ({
    row: Math.floor(i / 5) as 0 | 1,
    col: (i % 5) as 0 | 1 | 2 | 3 | 4,
    componentType: null,
  })),
};

// === Clock Config ===

export interface ClockConfig {
  format: "12h" | "24h";
}

export const DEFAULT_CLOCK_CONFIG: ClockConfig = {
  format: "12h",
};

// === Weather Config ===

export interface WeatherConfig {
  location: string | null;
  unit: "fahrenheit" | "celsius";
  refreshIntervalMinutes: number;
  showTemperature?: boolean;
  showCondition?: boolean;
  showHumidity?: boolean;
}

export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  location: null,
  unit: "fahrenheit",
  refreshIntervalMinutes: 30,
  showTemperature: true,
  showCondition: true,
  showHumidity: false,
};

export type WeatherCondition =
  | "sunny"
  | "partly-cloudy"
  | "cloudy"
  | "rainy"
  | "stormy"
  | "snowy"
  | "foggy";

export interface WeatherCache {
  temperature: number;
  condition: WeatherCondition;
  /** Unit the temperature is expressed in — not necessarily the display unit. */
  unit: "fahrenheit" | "celsius";
  fetchedAt: number;
  /** Relative humidity percentage, when the provider returned one. */
  humidity?: number;
}

// === Reminders ===

export interface Reminder {
  id: string;
  title: string;
  targetTime: number;
  completed: boolean;
  /**
   * When `completed` was set to `true` (either by the wearer tapping it in
   * the Reminders list, or by the HUD's own due-time check). Undefined while
   * not completed. Drives the 5s undo window in `src/reminders/`: a reminder
   * is deleted once `Date.now() - completedAt` exceeds
   * `REMINDER_UNDO_WINDOW_MS`.
   */
  completedAt?: number;
}

export interface RemindersStore {
  reminders: Reminder[];
}

/**
 * Returns a fresh empty store. A shared constant would be mutated in place by
 * the reminders component when it marks a due reminder completed.
 */
export function emptyRemindersStore(): RemindersStore {
  return { reminders: [] };
}

// === Menu Order ===

/**
 * Wearer-chosen ordering for the glasses app-launcher menu, stored as a list
 * of menu-entry ids (e.g. `"reminders"`, `"smarter-everyday"`, `"exit"`) in
 * the order they should appear. An empty array (the default) means
 * registration order — the order sub-apps were registered in, then `Exit`.
 * Unknown/stale ids are ignored; entries not mentioned are appended after the
 * ones that are, in their natural order. See `src/menu/menu-order.ts`.
 */
export type MenuOrder = string[];

export const DEFAULT_MENU_ORDER: MenuOrder = [];

// === Banner Config ===

export interface BannerConfig {
  displayDurationSeconds: number;
}

export const DEFAULT_BANNER_CONFIG: BannerConfig = {
  displayDurationSeconds: 5,
};

// === Sub-App Registry ===

export interface SubAppRegistryEntry {
  id: string;
  name: string;
  order: number;
}

export interface SubAppRegistry {
  apps: SubAppRegistryEntry[];
}

export const DEFAULT_SUB_APP_REGISTRY: SubAppRegistry = {
  apps: [],
};

// === SmarterEveryday: Topic ===

export interface QuietHoursConfig {
  enabled: boolean;
  startMinuteOfDay: number; // 0–1439
  endMinuteOfDay: number; // 0–1439 (may be < start, meaning the window crosses midnight)
}

export interface Topic {
  id: string;
  description: string; // 1–200 non-whitespace-trimmed chars
  notificationIntervalMinutes: number; // 10–360
  quietHours: QuietHoursConfig;
  createdAt: number;
  paused: boolean;
  consecutiveFailures: number;
  lastDeliveryAt: number | null;
  suppressedDuringQuietHours: boolean;
}

export interface SmarterEverydayTopicsStore {
  topics: Topic[]; // max 5
}

export const DEFAULT_SMARTER_EVERYDAY_TOPICS: SmarterEverydayTopicsStore = {
  topics: [],
};

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  enabled: false,
  startMinuteOfDay: 22 * 60, // 22:00
  endMinuteOfDay: 7 * 60, // 07:00
};

// === SmarterEveryday: Shown Content Log ===

export interface ShownContentEntry {
  content: string;
  deliveredAt: number;
}

/** Keyed by Topic.id. No per-topic entry limit (Requirement 6.2). */
export type ShownContentLogStore = Record<string, ShownContentEntry[]>;

export const DEFAULT_SHOWN_CONTENT_LOG: ShownContentLogStore = {};

// === SmarterEveryday: Settings ===

export interface SmarterEverydaySettings {
  notificationHistoryMax: number; // 1–20, default 10 (Requirement 9.3)
  popupDisplayDurationSeconds: number; // 10–120, default 60 (Requirement 7.2, 7.3)
}

export const DEFAULT_SMARTER_EVERYDAY_SETTINGS: SmarterEverydaySettings = {
  notificationHistoryMax: 10,
  popupDisplayDurationSeconds: 60,
};

// === Notification System (evolves Banner) ===

export interface NotificationEntry {
  id: string;
  sourceAppId: string;
  sourceAppName: string;
  text: string; // full, untruncated content (Expanded_Notification_View)
  duration?: number; // seconds; per-notification override, same field banner already has
  timestamp: number;
}

export interface NotificationHistoryStore {
  entries: NotificationEntry[]; // stored oldest-first; UI reverses for most-recent-first display
}

export const DEFAULT_NOTIFICATION_HISTORY: NotificationHistoryStore = {
  entries: [],
};
