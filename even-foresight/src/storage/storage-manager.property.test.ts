import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createStorageManager } from "./storage-manager";
import type {
  HudLayoutConfig,
  ClockConfig,
  WeatherConfig,
  BannerConfig,
  RemindersStore,
} from "./schemas";

/**
 * Feature: even-hub, Property 2: Configuration Persistence Round-Trip
 *
 * For any valid configuration object (HudLayoutConfig, ClockConfig, WeatherConfig,
 * BannerConfig, or RemindersStore), serializing it to a JSON string and deserializing
 * it back SHALL produce an object deeply equal to the original.
 *
 * Validates: Requirements 2.6, 3.3, 4.5, 8.7
 */

// --- Mock Bridge (same pattern as unit tests) ---

function createMockBridge() {
  const store = new Map<string, string | null>();
  return {
    store,
    getLocalStorage: (key: string) => store.get(key) ?? null,
    setLocalStorage: async (key: string, value: string | null) => {
      if (value === null) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

// --- Arbitraries ---

const arbRow = fc.constantFrom(0 as const, 1 as const);
const arbCol = fc.constantFrom(
  0 as const,
  1 as const,
  2 as const,
  3 as const,
  4 as const,
);
const arbComponentType = fc.constantFrom(
  null,
  "clock" as const,
  "weather" as const,
  "reminders" as const,
);

const arbHudSlotConfig = fc.record({
  row: arbRow,
  col: arbCol,
  componentType: arbComponentType,
});

const arbHudLayoutConfig: fc.Arbitrary<HudLayoutConfig> = fc.record({
  slots: fc.array(arbHudSlotConfig, { minLength: 0, maxLength: 10 }),
});

const arbClockConfig: fc.Arbitrary<ClockConfig> = fc.record({
  format: fc.constantFrom("12h" as const, "24h" as const),
});

const arbWeatherConfig: fc.Arbitrary<WeatherConfig> = fc.record({
  location: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 1, maxLength: 50 }),
  ),
  unit: fc.constantFrom("fahrenheit" as const, "celsius" as const),
  refreshIntervalMinutes: fc.integer({ min: 15, max: 120 }),
});

const arbBannerConfig: fc.Arbitrary<BannerConfig> = fc.record({
  displayDurationSeconds: fc.integer({ min: 3, max: 15 }),
});

const arbReminder = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  targetTime: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  completed: fc.boolean(),
});

const arbRemindersStore: fc.Arbitrary<RemindersStore> = fc.record({
  reminders: fc.array(arbReminder, { minLength: 0, maxLength: 20 }),
});

// --- Property Tests ---

describe("Feature: even-hub, Property 2: Configuration Persistence Round-Trip", () => {
  it("HudLayoutConfig: set → get produces deeply equal object", async () => {
    await fc.assert(
      fc.asyncProperty(arbHudLayoutConfig, async (config) => {
        const bridge = createMockBridge();
        const sm = createStorageManager(bridge);
        const key = "foresight-hud-layout-v1";

        await sm.set(key, config);
        const retrieved = sm.get<HudLayoutConfig>(key);

        expect(retrieved).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it("ClockConfig: set → get produces deeply equal object", async () => {
    await fc.assert(
      fc.asyncProperty(arbClockConfig, async (config) => {
        const bridge = createMockBridge();
        const sm = createStorageManager(bridge);
        const key = "foresight-clock-config-v1";

        await sm.set(key, config);
        const retrieved = sm.get<ClockConfig>(key);

        expect(retrieved).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it("WeatherConfig: set → get produces deeply equal object", async () => {
    await fc.assert(
      fc.asyncProperty(arbWeatherConfig, async (config) => {
        const bridge = createMockBridge();
        const sm = createStorageManager(bridge);
        const key = "foresight-weather-config-v1";

        await sm.set(key, config);
        const retrieved = sm.get<WeatherConfig>(key);

        expect(retrieved).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it("BannerConfig: set → get produces deeply equal object", async () => {
    await fc.assert(
      fc.asyncProperty(arbBannerConfig, async (config) => {
        const bridge = createMockBridge();
        const sm = createStorageManager(bridge);
        const key = "foresight-banner-config-v1";

        await sm.set(key, config);
        const retrieved = sm.get<BannerConfig>(key);

        expect(retrieved).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it("RemindersStore: set → get produces deeply equal object", async () => {
    await fc.assert(
      fc.asyncProperty(arbRemindersStore, async (config) => {
        const bridge = createMockBridge();
        const sm = createStorageManager(bridge);
        const key = "foresight-reminders-v1";

        await sm.set(key, config);
        const retrieved = sm.get<RemindersStore>(key);

        expect(retrieved).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });
});
