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
  sunny: "Clear",
  "partly-cloudy": "P.Cloudy",
  cloudy: "Cloudy",
  rainy: "Rain",
  stormy: "Storm",
  snowy: "Snow",
  foggy: "Fog",
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

// === Open-Meteo WMO Weather Code → Condition Mapping ===

/**
 * Maps WMO weather interpretation codes to our simplified conditions.
 * Reference: https://open-meteo.com/en/docs#weathervariables
 */
function wmoCodeToCondition(code: number): WeatherCondition {
  if (code === 0) return "sunny";
  if (code <= 3) return "partly-cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "rainy"; // drizzle
  if (code <= 67) return "rainy"; // rain
  if (code <= 77) return "snowy"; // snow
  if (code <= 82) return "rainy"; // rain showers
  if (code <= 86) return "snowy"; // snow showers
  if (code <= 99) return "stormy"; // thunderstorm
  return "cloudy";
}

/**
 * Geocode a location string to lat/lon using Open-Meteo's geocoding API.
 */
async function geocodeLocation(
  location: string,
): Promise<{ lat: number; lon: number } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (!data.results || data.results.length === 0) return null;
  return { lat: data.results[0].latitude, lon: data.results[0].longitude };
}

/**
 * Fetches current weather data from Open-Meteo (free, no API key).
 *
 * Steps:
 * 1. Geocode the location string to coordinates
 * 2. Fetch current weather (temperature + weather code)
 * 3. Map to our WeatherFetchResult format
 *
 * Falls back to simulated data if the network is unavailable (e.g. simulator).
 */
export async function fetchWeatherData(
  location: string,
  unit: "fahrenheit" | "celsius",
): Promise<WeatherFetchResult> {
  try {
    // Geocode the location
    const coords = await geocodeLocation(location);
    if (!coords) {
      throw new Error(`Could not geocode location: ${location}`);
    }

    // Fetch current weather from Open-Meteo
    const tempUnit = unit === "celsius" ? "celsius" : "fahrenheit";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;
    if (!current) {
      throw new Error("No current weather data in response");
    }

    return {
      temperature: current.temperature_2m,
      condition: wmoCodeToCondition(current.weather_code),
      unit,
    };
  } catch (err) {
    // Network unavailable (e.g. simulator sandbox) — use simulated data
    console.log(
      "[Weather] Fetch failed, using simulated data:",
      (err as Error).message,
    );
    return {
      temperature: unit === "fahrenheit" ? 72 : 22,
      condition: "sunny",
      unit,
    };
  }
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
    const config =
      storage.get<WeatherConfig>(STORAGE_KEYS.WEATHER_CONFIG) ??
      DEFAULT_WEATHER_CONFIG;

    // If no location in the HUD config, check the webapp's weather location key
    if (config.location === null) {
      const webappConfig = storage.get<{
        useCurrentLocation?: boolean;
        manualLocation?: string;
      }>("foresight-weather-location-v1");
      if (webappConfig?.manualLocation) {
        config.location = webappConfig.manualLocation;
      }
    }

    return config;
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
