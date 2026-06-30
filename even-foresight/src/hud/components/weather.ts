import type { HudComponent } from "../types";
import type {
  WeatherConfig,
  WeatherCache,
  WeatherCondition,
} from "../../storage/schemas";
import { DEFAULT_WEATHER_CONFIG, STORAGE_KEYS } from "../../storage/schemas";
import type { StorageManager } from "../../storage/storage-manager";
import {
  WEATHER_CACHE_MAX_AGE_MS,
  WEATHER_MIN_INTERVAL_MIN,
  WEATHER_MAX_INTERVAL_MIN,
} from "../../constants";

// === Condition Icon Mapping ===

const CONDITION_ICONS: Record<WeatherCondition, string> = {
  sunny: "☀",
  "partly-cloudy": "⛅",
  cloudy: "☁",
  rainy: "🌧",
  stormy: "⛈",
  snowy: "❄",
  foggy: "🌫",
};

// === Pure Helper Functions (exported for testing) ===

/**
 * Returns the text icon for a weather condition.
 */
export function getConditionIcon(condition: WeatherCondition): string {
  return CONDITION_ICONS[condition];
}

/**
 * Determines whether cached weather data is still valid.
 * Cache is valid iff (currentTime - fetchedAt) < WEATHER_CACHE_MAX_AGE_MS (24 hours).
 */
export function isCacheValid(fetchedAt: number, currentTime: number): boolean {
  return currentTime - fetchedAt < WEATHER_CACHE_MAX_AGE_MS;
}

/**
 * Renders weather display content based on current state.
 *
 * - If no location configured: "Set location"
 * - If data is null (no cache or expired): "-- °F" or "-- °C"
 * - If data exists and isStale: shows data with "~" appended
 * - If data exists and fresh: shows "temp°unit icon"
 */
export function renderWeatherContent(
  data: WeatherCache | null,
  isStale: boolean,
  config: WeatherConfig,
): string {
  // No location configured
  if (config.location === null) {
    return "Set location";
  }

  // No data available
  if (data === null) {
    const unitLabel = config.unit === "celsius" ? "°C" : "°F";
    return `-- ${unitLabel}`;
  }

  // Render weather data
  const temp = Math.round(data.temperature);
  const unitLabel = data.unit === "celsius" ? "°C" : "°F";
  const icon = getConditionIcon(data.condition);
  const staleIndicator = isStale ? "~" : "";

  return `${temp}${unitLabel} ${icon}${staleIndicator}`;
}

// === Weather API Fetch (stub/placeholder) ===

export interface WeatherFetchResult {
  temperature: number;
  condition: WeatherCondition;
  unit: "fahrenheit" | "celsius";
}

/**
 * Fetches weather data from an external API.
 * This is a placeholder that can be replaced with a real implementation.
 * In production, this would call an actual weather API.
 */
export async function fetchWeatherData(
  location: string,
  _unit: "fahrenheit" | "celsius",
): Promise<WeatherFetchResult> {
  // Placeholder implementation - always throws to simulate no API configured
  throw new Error(`Weather API not configured for location: ${location}`);
}

// === Weather HUD Component ===

export interface WeatherComponentDeps {
  storage: StorageManager;
  fetchFn?: typeof fetchWeatherData;
  nowFn?: () => number;
}

/**
 * Creates a Weather HUD component that displays current weather conditions.
 *
 * Behavior:
 * - Shows temperature (rounded integer) + unit + condition icon
 * - Fetches at configurable interval (15–120 min, default 30)
 * - Uses cached data if < 24h old on API failure (with stale "~" indicator)
 * - Shows "-- °F/°C" if no cache or cache ≥ 24h old
 * - Shows "Set location" if no location configured
 * - Default unit is Fahrenheit
 */
export function createWeatherComponent(
  deps: WeatherComponentDeps,
): HudComponent {
  const { storage } = deps;
  const fetchFn = deps.fetchFn ?? fetchWeatherData;
  const nowFn = deps.nowFn ?? (() => Date.now());

  let config: WeatherConfig = getConfig();
  let cache: WeatherCache | null = getCache();
  let isStale = false;
  let lastFetchAttempt = 0;

  function getConfig(): WeatherConfig {
    return (
      storage.get<WeatherConfig>(STORAGE_KEYS.WEATHER_CONFIG) ??
      DEFAULT_WEATHER_CONFIG
    );
  }

  function getCache(): WeatherCache | null {
    return storage.get<WeatherCache>(STORAGE_KEYS.WEATHER_CACHE);
  }

  function getRefreshIntervalMs(): number {
    const minutes = Math.max(
      WEATHER_MIN_INTERVAL_MIN,
      Math.min(WEATHER_MAX_INTERVAL_MIN, config.refreshIntervalMinutes),
    );
    return minutes * 60 * 1000;
  }

  function needsFetch(): boolean {
    if (config.location === null) return false;

    const now = nowFn();
    const intervalMs = getRefreshIntervalMs();

    // If we've never fetched, always try
    if (lastFetchAttempt === 0) return true;

    // Check if enough time has passed since last fetch attempt
    if (now - lastFetchAttempt < intervalMs) return false;

    return true;
  }

  const component: HudComponent = {
    type: "weather" as const,

    render(): string {
      return renderWeatherContent(cache, isStale, config);
    },

    async refresh(): Promise<void> {
      // Reload config in case it changed
      config = getConfig();

      if (!needsFetch()) return;

      const now = nowFn();
      lastFetchAttempt = now;

      try {
        const result = await fetchFn(config.location!, config.unit);

        // Update cache
        cache = {
          temperature: Math.round(result.temperature),
          condition: result.condition,
          unit: result.unit,
          fetchedAt: now,
        };
        isStale = false;

        // Persist cache
        await storage.set(STORAGE_KEYS.WEATHER_CACHE, cache);
      } catch {
        // API failure - check if we have valid cached data
        const storedCache = getCache();

        if (storedCache && isCacheValid(storedCache.fetchedAt, now)) {
          // Use cached data with stale indicator
          cache = storedCache;
          isStale = true;
        } else {
          // No valid cache available
          cache = null;
          isStale = false;
        }
      }
    },

    dispose(): void {
      // No timers or subscriptions to clean up in this component
      // The HudManager handles the refresh cycle
    },
  };

  return component;
}
