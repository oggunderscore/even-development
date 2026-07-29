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
  BANNER_CONFIG: "foresight-banner-config-v1",
  ASSISTANT_CONFIG: "foresight-assistant-config-v1",
  HUD_SLEEP: "foresight-hud-mode-v1",
  HUD_SLEEP_DELAY: "foresight-hud-duration-v1",
  DOUBLE_TAP_DELAY: "foresight-doubletap-delay-v1",
  DEBUG_LOG: "foresight-debug-log-v1",
  INSTALLED_APPS: "foresight-installed-apps-v1",
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
