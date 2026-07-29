import { describe, it, expect, vi } from "vitest";
import {
  getConditionIcon,
  isCacheValid,
  renderWeatherContent,
  createWeatherComponent,
  parseCoordinates,
} from "./weather";
import type {
  WeatherCache,
  WeatherConfig,
  WeatherCondition,
} from "../../storage/schemas";
import { STORAGE_KEYS, DEFAULT_WEATHER_CONFIG } from "../../storage/schemas";
import type { StorageManager } from "../../storage/storage-manager";
import { WEATHER_CACHE_MAX_AGE_MS } from "../../constants";

// === Helper: Mock StorageManager ===

function createMockStorage(
  initial: Record<string, unknown> = {},
): StorageManager & { _store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string): T | null {
      const val = store.get(key);
      return val === undefined ? null : (val as T);
    },
    set: vi.fn(async <T>(key: string, value: T): Promise<void> => {
      store.set(key, value);
    }),
    setCached: vi.fn(<T>(key: string, value: T): void => {
      store.set(key, value);
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      store.delete(key);
    }),
    onChange: vi.fn(() => () => {}),
    loadKey: vi.fn(async (_key: string): Promise<void> => {}),
    loadKeys: vi.fn(async (_keys: string[]): Promise<void> => {}),
    _store: store,
  };
}

// === getConditionIcon ===

describe("getConditionIcon", () => {
  it("returns Clear for sunny", () => {
    expect(getConditionIcon("sunny")).toBe("Clear");
  });

  it("returns PtCldy for partly-cloudy", () => {
    expect(getConditionIcon("partly-cloudy")).toBe("PtCldy");
  });

  it("returns Cloudy for cloudy", () => {
    expect(getConditionIcon("cloudy")).toBe("Cloudy");
  });

  it("returns Rain for rainy", () => {
    expect(getConditionIcon("rainy")).toBe("Rain");
  });

  it("returns Storm for stormy", () => {
    expect(getConditionIcon("stormy")).toBe("Storm");
  });

  it("returns Snow for snowy", () => {
    expect(getConditionIcon("snowy")).toBe("Snow");
  });

  it("returns Fog for foggy", () => {
    expect(getConditionIcon("foggy")).toBe("Fog");
  });

  it("maps all 7 conditions to unique labels", () => {
    const conditions: WeatherCondition[] = [
      "sunny",
      "partly-cloudy",
      "cloudy",
      "rainy",
      "stormy",
      "snowy",
      "foggy",
    ];
    const icons = conditions.map(getConditionIcon);
    const uniqueIcons = new Set(icons);
    expect(uniqueIcons.size).toBe(7);
  });
});

// === isCacheValid ===

describe("isCacheValid", () => {
  it("returns true when cache is fresh (0ms old)", () => {
    const now = 1000000;
    expect(isCacheValid(now, now)).toBe(true);
  });

  it("returns true when cache is 23 hours old", () => {
    const fetchedAt = 1000000;
    const now = fetchedAt + 23 * 60 * 60 * 1000;
    expect(isCacheValid(fetchedAt, now)).toBe(true);
  });

  it("returns false when cache is exactly 24 hours old", () => {
    const fetchedAt = 1000000;
    const now = fetchedAt + WEATHER_CACHE_MAX_AGE_MS;
    expect(isCacheValid(fetchedAt, now)).toBe(false);
  });

  it("returns false when cache is older than 24 hours", () => {
    const fetchedAt = 1000000;
    const now = fetchedAt + WEATHER_CACHE_MAX_AGE_MS + 1;
    expect(isCacheValid(fetchedAt, now)).toBe(false);
  });

  it("returns true when cache is 1ms less than 24 hours old", () => {
    const fetchedAt = 1000000;
    const now = fetchedAt + WEATHER_CACHE_MAX_AGE_MS - 1;
    expect(isCacheValid(fetchedAt, now)).toBe(true);
  });
});

// === renderWeatherContent ===

describe("renderWeatherContent", () => {
  const baseConfig: WeatherConfig = {
    location: "Seattle",
    unit: "fahrenheit",
    refreshIntervalMinutes: 30,
  };

  it('shows "Set location" when no location configured', () => {
    const config: WeatherConfig = { ...baseConfig, location: null };
    expect(renderWeatherContent(null, false, config)).toBe("Set location");
  });

  it('shows "-- °F" when no data and unit is fahrenheit', () => {
    expect(renderWeatherContent(null, false, baseConfig)).toBe("-- °F");
  });

  it('shows "-- °C" when no data and unit is celsius', () => {
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    expect(renderWeatherContent(null, false, config)).toBe("-- °C");
  });

  it("shows temperature + unit + icon for fresh data", () => {
    const data: WeatherCache = {
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, false, baseConfig)).toBe("72°F Clear");
  });

  it("shows stale indicator when data is stale", () => {
    const data: WeatherCache = {
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, true, baseConfig)).toBe("72°F Clear~");
  });

  it("rounds temperature to integer", () => {
    const data: WeatherCache = {
      temperature: 72.7,
      condition: "cloudy",
      unit: "fahrenheit",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, false, baseConfig)).toBe("73°F Cloudy");
  });

  it("renders celsius correctly", () => {
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    const data: WeatherCache = {
      temperature: 22,
      condition: "rainy",
      unit: "celsius",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, false, config)).toBe("22°C Rain");
  });

  it("renders negative temperatures", () => {
    const data: WeatherCache = {
      temperature: -5,
      condition: "snowy",
      unit: "celsius",
      fetchedAt: Date.now(),
    };
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    expect(renderWeatherContent(data, false, config)).toBe("-5°C Snow");
  });

  it("renders zero temperature", () => {
    const data: WeatherCache = {
      temperature: 0,
      condition: "foggy",
      unit: "celsius",
      fetchedAt: Date.now(),
    };
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    expect(renderWeatherContent(data, false, config)).toBe("0°C Fog");
  });
});

// === createWeatherComponent ===

describe("createWeatherComponent", () => {
  it("has type 'weather'", () => {
    const storage = createMockStorage();
    const component = createWeatherComponent({ storage });
    expect(component.type).toBe("weather");
  });

  it('renders "Set location" when no location configured', () => {
    const storage = createMockStorage();
    const component = createWeatherComponent({ storage });
    expect(component.render()).toBe("Set location");
  });

  it('renders "-- °F" when location set but no cache', () => {
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const component = createWeatherComponent({ storage });
    expect(component.render()).toBe("-- °F");
  });

  it("renders cached data on successful fetch", async () => {
    const now = 1000000;
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const fetchFn = vi.fn().mockResolvedValue({
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
    });

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    await component.refresh();
    expect(component.render()).toBe("72°F Clear");
  });

  it("persists cache after successful fetch", async () => {
    const now = 1000000;
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const fetchFn = vi.fn().mockResolvedValue({
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
    });

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    await component.refresh();
    expect(storage.set).toHaveBeenCalledWith(STORAGE_KEYS.WEATHER_CACHE, {
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
      fetchedAt: now,
    });
  });

  it("uses cached data with stale indicator on API failure", async () => {
    const now = 1000000;
    const cachedData: WeatherCache = {
      temperature: 65,
      condition: "cloudy",
      unit: "fahrenheit",
      fetchedAt: now - 60 * 60 * 1000, // 1 hour ago (valid)
    };
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
      [STORAGE_KEYS.WEATHER_CACHE]: cachedData,
    });
    const fetchFn = vi.fn().mockRejectedValue(new Error("API Error"));

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    await component.refresh();
    expect(component.render()).toBe("65°F Cloudy~");
  });

  it("shows no-data indicator when API fails and cache is expired", async () => {
    const now = 1000000;
    const cachedData: WeatherCache = {
      temperature: 65,
      condition: "cloudy",
      unit: "fahrenheit",
      fetchedAt: now - WEATHER_CACHE_MAX_AGE_MS - 1, // expired
    };
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
      [STORAGE_KEYS.WEATHER_CACHE]: cachedData,
    });
    const fetchFn = vi.fn().mockRejectedValue(new Error("API Error"));

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    await component.refresh();
    expect(component.render()).toBe("-- °F");
  });

  it("does not fetch when no location is configured", async () => {
    const storage = createMockStorage();
    const fetchFn = vi.fn();

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => Date.now(),
    });

    await component.refresh();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not fetch again before interval has elapsed", async () => {
    let now = 1000000;
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const fetchFn = vi.fn().mockResolvedValue({
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
    });

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    // First refresh triggers fetch
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance 10 minutes (less than 30 min interval)
    now += 10 * 60 * 1000;
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(1); // Not called again
  });

  it("fetches again after interval has elapsed", async () => {
    let now = 1000000;
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const fetchFn = vi.fn().mockResolvedValue({
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
    });

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    // First refresh
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance past 30 min interval
    now += 31 * 60 * 1000;
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses default fahrenheit unit", () => {
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 30,
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const component = createWeatherComponent({ storage });
    // No cache, so shows "-- °F" (default unit)
    expect(component.render()).toBe("-- °F");
  });

  it("clamps refresh interval to min 15 minutes", async () => {
    let now = 1000000;
    const config: WeatherConfig = {
      location: "Seattle",
      unit: "fahrenheit",
      refreshIntervalMinutes: 5, // below minimum
    };
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: config,
    });
    const fetchFn = vi.fn().mockResolvedValue({
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
    });

    const component = createWeatherComponent({
      storage,
      fetchFn,
      nowFn: () => now,
    });

    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance 10 minutes (between 5 min config and 15 min minimum)
    now += 10 * 60 * 1000;
    await component.refresh();
    // Should NOT fetch again because effective interval is clamped to 15 min
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance to 16 minutes total
    now += 6 * 60 * 1000;
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("dispose does not throw", () => {
    const storage = createMockStorage();
    const component = createWeatherComponent({ storage });
    expect(() => component.dispose()).not.toThrow();
  });
});

// === Regression coverage for behaviour that used to be wrong ===

describe("weather config resolution", () => {
  it("does not mutate DEFAULT_WEATHER_CONFIG when patching in a location", () => {
    const storage = createMockStorage({
      "foresight-weather-location-v1": { manualLocation: "Tokyo" },
    });

    const component = createWeatherComponent({ storage });
    // Rendering proves the location was picked up...
    expect(component.render()).not.toBe("Set location");
    component.dispose();

    // ...without the shared default having been written through, which would
    // leak this user's location into every other component instance.
    expect(DEFAULT_WEATHER_CONFIG.location).toBeNull();

    const fresh = createWeatherComponent({ storage: createMockStorage() });
    expect(fresh.render()).toBe("Set location");
    fresh.dispose();
  });

  it("prefers device coordinates when 'use current location' is on", async () => {
    const storage = createMockStorage({
      "foresight-weather-location-v1": {
        useCurrentLocation: true,
        manualLocation: "Irvine, California",
        lastKnownCoords: { lat: 35.68, lng: 139.69 },
      },
    });

    const fetchFn = vi.fn(async () => ({
      temperature: 20,
      condition: "sunny" as const,
      unit: "fahrenheit" as const,
    }));

    const component = createWeatherComponent({ storage, fetchFn });
    await component.refresh();

    expect(fetchFn).toHaveBeenCalledWith("35.68,139.69", "fahrenheit");
    component.dispose();
  });

  it("falls back to the typed location when the toggle is off", async () => {
    const storage = createMockStorage({
      "foresight-weather-location-v1": {
        useCurrentLocation: false,
        manualLocation: "Irvine, California",
        lastKnownCoords: { lat: 35.68, lng: 139.69 },
      },
    });

    const fetchFn = vi.fn(async () => ({
      temperature: 20,
      condition: "sunny" as const,
      unit: "fahrenheit" as const,
    }));

    const component = createWeatherComponent({ storage, fetchFn });
    await component.refresh();

    expect(fetchFn).toHaveBeenCalledWith("Irvine, California", "fahrenheit");
    component.dispose();
  });

  it("refetches immediately when the location changes, ignoring the interval", async () => {
    const storage = createMockStorage({
      [STORAGE_KEYS.WEATHER_CONFIG]: {
        location: "Irvine",
        unit: "fahrenheit",
        refreshIntervalMinutes: 120,
      },
    });

    const fetchFn = vi.fn(async () => ({
      temperature: 70,
      condition: "sunny" as const,
      unit: "fahrenheit" as const,
    }));

    const component = createWeatherComponent({ storage, fetchFn });
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Same location, well inside the 120-minute interval: no refetch.
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // New location: the cached reading is for somewhere else, so refetch.
    storage._store.set(STORAGE_KEYS.WEATHER_CONFIG, {
      location: "Tokyo",
      unit: "fahrenheit",
      refreshIntervalMinutes: 120,
    });
    await component.refresh();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenLastCalledWith("Tokyo", "fahrenheit");

    component.dispose();
  });
});

describe("parseCoordinates", () => {
  it("parses well-formed coordinate pairs", () => {
    expect(parseCoordinates("35.68,139.69")).toEqual({
      lat: 35.68,
      lon: 139.69,
    });
    expect(parseCoordinates(" -33.86 , 151.21 ")).toEqual({
      lat: -33.86,
      lon: 151.21,
    });
    expect(parseCoordinates("0,0")).toEqual({ lat: 0, lon: 0 });
  });

  it("rejects place names and out-of-range values", () => {
    expect(parseCoordinates("Irvine, California")).toBeNull();
    expect(parseCoordinates("91,0")).toBeNull();
    expect(parseCoordinates("0,181")).toBeNull();
    expect(parseCoordinates("")).toBeNull();
  });
});

describe("weather display toggles", () => {
  const cache = {
    temperature: 72,
    condition: "rainy" as const,
    unit: "fahrenheit" as const,
    fetchedAt: Date.now(),
    humidity: 64,
  };
  const base = {
    location: "Irvine",
    unit: "fahrenheit" as const,
    refreshIntervalMinutes: 30,
  };

  it("shows temperature and condition by default", () => {
    expect(renderWeatherContent(cache, false, base)).toBe("72°F Rain");
  });

  it("hides the condition when switched off", () => {
    expect(
      renderWeatherContent(cache, false, { ...base, showCondition: false }),
    ).toBe("72°F");
  });

  it("appends humidity when switched on", () => {
    expect(
      renderWeatherContent(cache, false, { ...base, showHumidity: true }),
    ).toBe("72°F Rain 64%");
  });

  it("omits humidity when the provider gave none", () => {
    const noHumidity = { ...cache, humidity: undefined };
    expect(
      renderWeatherContent(noHumidity, false, { ...base, showHumidity: true }),
    ).toBe("72°F Rain");
  });

  it("still renders temperature when every field is switched off", () => {
    // An empty HUD cell reads as a broken widget, so temperature is forced.
    expect(
      renderWeatherContent(cache, false, {
        ...base,
        showTemperature: false,
        showCondition: false,
        showHumidity: false,
      }),
    ).toBe("72°F");
  });

  it("keeps the stale marker at the end regardless of which fields show", () => {
    expect(
      renderWeatherContent(cache, true, { ...base, showCondition: false }),
    ).toBe("72°F~");
  });
});
