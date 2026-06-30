import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateWeatherRefreshInterval,
  validateReminderTitle,
  validateWeatherLocation,
  clampBannerDuration,
} from "./config-forms";

/**
 * Feature: even-hub, Property 18: Configuration Input Validation
 *
 * For all input values:
 * - Weather refresh interval accepted iff value ∈ [15, 120]
 * - Reminder title accepted iff length ∈ [1, 30]
 * - Weather location accepted iff length ∈ [1, 50]
 * - Banner duration clamped to [3, 15]
 *
 * Validates: Requirements 9.5, 9.6, 8.1
 */

describe("Feature: even-hub, Property 18: Configuration Input Validation", () => {
  it("weather refresh interval accepted iff value ∈ [15, 120]", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 200 }), (value) => {
        const result = validateWeatherRefreshInterval(value);
        const expected = value >= 15 && value <= 120;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("weather refresh interval validation works for non-integer doubles", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 200, noNaN: true }), (value) => {
        const result = validateWeatherRefreshInterval(value);
        const expected = value >= 15 && value <= 120;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("reminder title accepted iff length ∈ [1, 30]", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 60 }), (title) => {
        const result = validateReminderTitle(title);
        const expected = title.length >= 1 && title.length <= 30;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("weather location accepted iff length ∈ [1, 50]", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (location) => {
        const result = validateWeatherLocation(location);
        const expected = location.length >= 1 && location.length <= 50;
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("banner duration clamped to [3, 15]", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 200 }), (value) => {
        const result = clampBannerDuration(value);
        const expected = Math.min(15, Math.max(3, value));
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("banner duration result is always within [3, 15]", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 200 }), (value) => {
        const result = clampBannerDuration(value);
        expect(result).toBeGreaterThanOrEqual(3);
        expect(result).toBeLessThanOrEqual(15);
      }),
      { numRuns: 100 },
    );
  });
});
