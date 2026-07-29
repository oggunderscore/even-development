import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isCacheValid,
  renderWeatherContent,
  convertTemperature,
} from "./weather";
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

          // The temperature is converted into the configured unit, so the
          // number and the label always describe the same reading even when
          // the cache was fetched in the other unit.
          const expected = Math.round(
            convertTemperature(cache.temperature, cache.unit, config.unit),
          );
          expect(rendered).toContain(String(expected));

          const expectedUnitLabel = config.unit === "celsius" ? "°C" : "°F";
          expect(rendered).toContain(expectedUnitLabel);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never labels a rendered reading with the unit it was not converted to", () => {
    fc.assert(
      fc.property(
        arbWeatherCache,
        arbWeatherConfigWithLocation,
        (cache, config) => {
          const rendered = renderWeatherContent(cache, false, config);
          const wrongLabel = config.unit === "celsius" ? "°F" : "°C";
          expect(rendered).not.toContain(wrongLabel);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("convertTemperature", () => {
  it("is the identity when the units match", () => {
    fc.assert(
      fc.property(arbTemperature, arbUnit, (value, unit) => {
        expect(convertTemperature(value, unit, unit)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it("round-trips back to the original value", () => {
    fc.assert(
      fc.property(arbTemperature, arbUnit, arbUnit, (value, from, to) => {
        const there = convertTemperature(value, from, to);
        const back = convertTemperature(there, to, from);
        expect(back).toBeCloseTo(value, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("matches the known anchor points", () => {
    expect(convertTemperature(32, "fahrenheit", "celsius")).toBeCloseTo(0, 6);
    expect(convertTemperature(212, "fahrenheit", "celsius")).toBeCloseTo(
      100,
      6,
    );
    expect(convertTemperature(-40, "fahrenheit", "celsius")).toBeCloseTo(
      -40,
      6,
    );
    expect(convertTemperature(100, "celsius", "fahrenheit")).toBeCloseTo(
      212,
      6,
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
