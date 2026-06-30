import { describe, it, expect, vi } from "vitest";
import {
  getConditionIcon,
  isCacheValid,
  renderWeatherContent,
  createWeatherComponent,
} from "./weather";
import type {
  WeatherCache,
  WeatherConfig,
  WeatherCondition,
} from "../../storage/schemas";
import { STORAGE_KEYS } from "../../storage/schemas";
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
  it("returns ☀ for sunny", () => {
    expect(getConditionIcon("sunny")).toBe("☀");
  });

  it("returns ⛅ for partly-cloudy", () => {
    expect(getConditionIcon("partly-cloudy")).toBe("⛅");
  });

  it("returns ☁ for cloudy", () => {
    expect(getConditionIcon("cloudy")).toBe("☁");
  });

  it("returns 🌧 for rainy", () => {
    expect(getConditionIcon("rainy")).toBe("🌧");
  });

  it("returns ⛈ for stormy", () => {
    expect(getConditionIcon("stormy")).toBe("⛈");
  });

  it("returns ❄ for snowy", () => {
    expect(getConditionIcon("snowy")).toBe("❄");
  });

  it("returns 🌫 for foggy", () => {
    expect(getConditionIcon("foggy")).toBe("🌫");
  });

  it("maps all 7 conditions to unique icons", () => {
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
    expect(renderWeatherContent(data, false, baseConfig)).toBe("72°F ☀");
  });

  it("shows stale indicator when data is stale", () => {
    const data: WeatherCache = {
      temperature: 72,
      condition: "sunny",
      unit: "fahrenheit",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, true, baseConfig)).toBe("72°F ☀~");
  });

  it("rounds temperature to integer", () => {
    const data: WeatherCache = {
      temperature: 72.7,
      condition: "cloudy",
      unit: "fahrenheit",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, false, baseConfig)).toBe("73°F ☁");
  });

  it("renders celsius correctly", () => {
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    const data: WeatherCache = {
      temperature: 22,
      condition: "rainy",
      unit: "celsius",
      fetchedAt: Date.now(),
    };
    expect(renderWeatherContent(data, false, config)).toBe("22°C 🌧");
  });

  it("renders negative temperatures", () => {
    const data: WeatherCache = {
      temperature: -5,
      condition: "snowy",
      unit: "celsius",
      fetchedAt: Date.now(),
    };
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    expect(renderWeatherContent(data, false, config)).toBe("-5°C ❄");
  });

  it("renders zero temperature", () => {
    const data: WeatherCache = {
      temperature: 0,
      condition: "foggy",
      unit: "celsius",
      fetchedAt: Date.now(),
    };
    const config: WeatherConfig = { ...baseConfig, unit: "celsius" };
    expect(renderWeatherContent(data, false, config)).toBe("0°C 🌫");
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
    expect(component.render()).toBe("72°F ☀");
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
    expect(component.render()).toBe("65°F ☁~");
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
