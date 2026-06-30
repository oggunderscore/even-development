import type { HudComponentType } from "../hud/types";

// Storage keys
export const STORAGE_KEYS = {
  HUD_LAYOUT: "foresight-hud-layout-v1",
  CLOCK_CONFIG: "foresight-clock-config-v1",
  WEATHER_CONFIG: "foresight-weather-config-v1",
  WEATHER_CACHE: "foresight-weather-cache-v1",
  REMINDERS: "foresight-reminders-v1",
  BANNER_CONFIG: "foresight-banner-config-v1",
  SUB_APP_REGISTRY: "foresight-subapps-v1",
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
}

export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  location: null,
  unit: "fahrenheit",
  refreshIntervalMinutes: 30,
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
  unit: "fahrenheit" | "celsius";
  fetchedAt: number;
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

export const DEFAULT_REMINDERS_STORE: RemindersStore = {
  reminders: [],
};

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
