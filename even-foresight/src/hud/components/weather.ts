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

/**
 * Key the phone webapp writes the user's location under. The HUD weather
 * config and the webapp location form are separate records, so the component
 * reads both and prefers whichever has a location.
 */
export const WEATHER_LOCATION_KEY = "foresight-weather-location-v1";

// === Condition Icon Mapping ===

/**
 * Condition labels, kept short enough that "temperature + condition" fits a
 * 115px HUD column on one line. "P.Cloudy" pushed the common
 * `78°F P.Cloudy` case to 121px, over the column width, so it wrapped and
 * displaced whatever the user had placed in the row below.
 */
const CONDITION_ICONS: Record<WeatherCondition, string> = {
  sunny: "Clear",
  "partly-cloudy": "PtCldy",
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
 * Converts a temperature between Fahrenheit and Celsius.
 * Returns the value unchanged when the units already match.
 */
export function convertTemperature(
  value: number,
  from: "fahrenheit" | "celsius",
  to: "fahrenheit" | "celsius",
): number {
  if (from === to) return value;
  return to === "celsius" ? ((value - 32) * 5) / 9 : (value * 9) / 5 + 32;
}

/**
 * Renders weather display content based on current state.
 *
 * - If no location configured: "Set location"
 * - If data is null (no cache or expired): "-- °F" or "-- °C"
 * - If data exists and isStale: shows data with "~" appended
 * - If data exists and fresh: shows "temp°unit icon"
 *
 * The cache records the unit it was fetched in. When the user switches units
 * the cached value is converted rather than relabelled, so the number and the
 * label never disagree in the window before the next fetch.
 *
 * `showTemperature` / `showCondition` / `showHumidity` come from the phone
 * config form. If every field is switched off, temperature is still shown —
 * an empty HUD cell would read as a broken widget.
 */
export function renderWeatherContent(
  data: WeatherCache | null,
  isStale: boolean,
  config: WeatherConfig,
): string {
  const unitLabel = config.unit === "celsius" ? "°C" : "°F";

  if (config.location === null) {
    return "Set location";
  }

  if (data === null) {
    return `-- ${unitLabel}`;
  }

  const showCondition = config.showCondition !== false;
  const showHumidity = config.showHumidity === true && data.humidity != null;
  // Default on, and forced on when nothing else would render.
  const showTemperature =
    config.showTemperature !== false || (!showCondition && !showHumidity);

  const parts: string[] = [];

  if (showTemperature) {
    const temp = Math.round(
      convertTemperature(data.temperature, data.unit, config.unit),
    );
    parts.push(`${temp}${unitLabel}`);
  }
  if (showCondition) {
    parts.push(getConditionIcon(data.condition));
  }
  if (showHumidity) {
    parts.push(`${Math.round(data.humidity!)}%`);
  }

  return `${parts.join(" ")}${isStale ? "~" : ""}`;
}

// === Weather API Fetch (stub/placeholder) ===

export interface WeatherFetchResult {
  temperature: number;
  condition: WeatherCondition;
  unit: "fahrenheit" | "celsius";
  /** Relative humidity percentage, when the provider returned one. */
  humidity?: number;
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
 * Parses a literal `"lat,lon"` location.
 *
 * The phone writes coordinates in this form when the user turns on "use
 * current location", so device GPS skips the geocoding round trip entirely.
 */
export function parseCoordinates(
  location: string,
): { lat: number; lon: number } | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(
    location,
  );
  if (!match) return null;

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Geocode a location string to lat/lon using Open-Meteo's geocoding API.
 */
async function geocodeLocation(
  location: string,
): Promise<{ lat: number; lon: number } | null> {
  const direct = parseCoordinates(location);
  if (direct) return direct;

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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code,relative_humidity_2m&temperature_unit=${tempUnit}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;
    if (!current) {
      throw new Error("No current weather data in response");
    }
    if (typeof current.temperature_2m !== "number") {
      throw new Error("Weather response has no temperature");
    }

    return {
      temperature: current.temperature_2m,
      condition: wmoCodeToCondition(current.weather_code),
      unit,
      humidity:
        typeof current.relative_humidity_2m === "number"
          ? current.relative_humidity_2m
          : undefined,
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
      humidity: 50,
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
  let lastFetchedLocation: string | null = null;

  function getConfig(): WeatherConfig {
    // Always build a fresh object. Spreading DEFAULT_WEATHER_CONFIG rather
    // than falling back to it by reference matters: the location patch below
    // used to mutate the shared module-level default, leaking one user's
    // location into every other component and test in the process.
    const stored = storage.get<Partial<WeatherConfig>>(
      STORAGE_KEYS.WEATHER_CONFIG,
    );
    const config: WeatherConfig = { ...DEFAULT_WEATHER_CONFIG, ...stored };

    // If no location in the HUD config, check the webapp's weather location
    // record. Device coordinates win when the user opted into "use current
    // location" — otherwise turning that toggle on had no effect on what the
    // widget actually fetched.
    if (!config.location) {
      const webappConfig = storage.get<{
        useCurrentLocation?: boolean;
        manualLocation?: string;
        lastKnownCoords?: { lat: number; lng: number } | null;
      }>(WEATHER_LOCATION_KEY);

      const coords = webappConfig?.lastKnownCoords;
      if (webappConfig?.useCurrentLocation && coords) {
        config.location = `${coords.lat},${coords.lng}`;
      } else if (webappConfig?.manualLocation) {
        config.location = webappConfig.manualLocation;
      } else {
        config.location = null;
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

    // Never fetched, or the user pointed the widget somewhere else — the
    // cached reading is for a different place, so it is not reusable.
    if (lastFetchAttempt === 0) return true;
    if (config.location !== lastFetchedLocation) return true;

    return nowFn() - lastFetchAttempt >= getRefreshIntervalMs();
  }

  const component: HudComponent = {
    type: "weather" as const,

    render(): string {
      return renderWeatherContent(cache, isStale, config);
    },

    async refresh(): Promise<void> {
      // Always reload config in case settings changed (e.g. unit switch)
      config = getConfig();

      if (!needsFetch()) return;

      const now = nowFn();
      lastFetchAttempt = now;
      lastFetchedLocation = config.location;

      try {
        const result = await fetchFn(config.location!, config.unit);

        // Update cache
        cache = {
          temperature: Math.round(result.temperature),
          condition: result.condition,
          unit: result.unit,
          fetchedAt: now,
          humidity: result.humidity,
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
