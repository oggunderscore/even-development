import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isCacheValid, renderWeatherContent } from "./weather";
import type { WeatherConfig, WeatherCondition } from "../../storage/schemas";

/**
 * Feature: even-hub, Property 4: Weather Render Content Completeness
 *
 * For any valid weather data (integer temperature, unit ∈ {'°F', '°C'},
 * condition ∈ {sunny, partly-cloudy, cloudy, rainy, stormy, snowy, foggy}),
 * the rendered output string SHALL contain the temperature as a numeric value
 * and the unit label.
 *
 * Validates: Requirements 4.1
 */

/**
 * Feature: even-hub, Property 5: Weather Cache Validity Decision
 *
 * For any cache entry with a `fetchedAt` timestamp and any current time value,
 * the cache validity function SHALL return `true` (cache is usable) if and only
 * if (currentTime - fetchedAt) < 24 hours (86,400,000 ms).
 *
 * Validates: Requirements 4.6
 */

// --- Arbitraries ---

const ALL_CONDITIONS: WeatherCondition[] = [
  "sunny",
  "partly-cloudy",
  "cloudy",
  "rainy",
  "stormy",
  "snowy",
  "foggy",
];

const arbCondition = fc.constantFrom(...ALL_CONDITIONS);
const arbUnit = fc.constantFrom("fahrenheit" as const, "celsius" as const);
const arbTemperature = fc.integer({ min: -100, max: 150 });

const arbWeatherCache = fc.record({
  temperature: arbTemperature,
  condition: arbCondition,
  unit: arbUnit,
  fetchedAt: fc.nat(),
});

const arbWeatherConfigWithLocation: fc.Arbitrary<WeatherConfig> = fc.record({
  location: fc.string({ minLength: 1, maxLength: 50 }),
  unit: arbUnit,
  refreshIntervalMinutes: fc.integer({ min: 15, max: 120 }),
});

// --- Property 4: Weather Render Content Completeness ---

describe("Feature: even-hub, Property 4: Weather Render Content Completeness", () => {
  it("rendered output contains the temperature numeric value and unit label for all valid weather data", () => {
    fc.assert(
      fc.property(
        arbWeatherCache,
        arbWeatherConfigWithLocation,
        (cache, config) => {
          const rendered = renderWeatherContent(cache, false, config);

          // Temperature should appear as rounded integer string
          const roundedTemp = Math.round(cache.temperature);
          expect(rendered).toContain(String(roundedTemp));

          // Unit label should be present
          const expectedUnitLabel = cache.unit === "celsius" ? "°C" : "°F";
          expect(rendered).toContain(expectedUnitLabel);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 5: Weather Cache Validity Decision ---

describe("Feature: even-hub, Property 5: Weather Cache Validity Decision", () => {
  const CACHE_MAX_AGE_MS = 86_400_000; // 24 hours

  it("cache is valid iff (currentTime - fetchedAt) < 86,400,000 ms when currentTime >= fetchedAt", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 2_000_000_000 }),
        fc.nat({ max: 2_000_000_000 }),
        (fetchedAt, offset) => {
          // currentTime >= fetchedAt
          const currentTime = fetchedAt + offset;

          const result = isCacheValid(fetchedAt, currentTime);
          const diff = currentTime - fetchedAt;

          if (diff < CACHE_MAX_AGE_MS) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("cache is valid when currentTime < fetchedAt (negative diff is always < threshold)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.integer({ min: 1, max: 2_000_000_000 }),
        (fetchedAt, offset) => {
          // Ensure currentTime < fetchedAt
          const currentTime = fetchedAt - offset;

          const result = isCacheValid(fetchedAt, currentTime);

          // When currentTime < fetchedAt, diff is negative, which is < 86,400,000
          // So cache should be valid
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
