import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { clampNotificationDuration } from "./general-settings-form";

/**
 * Feature: foresight-webapp-ui, Property 12: Notification duration clamping
 *
 * Clamp returns an integer in [3, 15]; values below 3 map to 3, values above
 * 15 map to 15, and in-range integer values are returned unchanged. Fractional
 * values are rounded to the nearest integer before clamping.
 *
 * Validates: Requirements 9.2
 */

// --- Property Tests ---

describe("Feature: foresight-webapp-ui, Property 12: Notification duration clamping", () => {
  it("result is always an integer in [3, 15] for any number", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (value) => {
        const result = clampNotificationDuration(value);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(3);
        expect(result).toBeLessThanOrEqual(15);
      }),
      { numRuns: 100 },
    );
  });

  it("values below 3 clamp to 3", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 2.4, noNaN: true }), (value) => {
        const result = clampNotificationDuration(value);
        expect(result).toBe(3);
      }),
      { numRuns: 100 },
    );
  });

  it("values above 15 clamp to 15", () => {
    fc.assert(
      fc.property(fc.double({ min: 15.6, max: 1e6, noNaN: true }), (value) => {
        const result = clampNotificationDuration(value);
        expect(result).toBe(15);
      }),
      { numRuns: 100 },
    );
  });

  it("integer values in [3, 15] are returned unchanged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 15 }), (value) => {
        const result = clampNotificationDuration(value);
        expect(result).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it("fractional values are rounded before clamping", () => {
    fc.assert(
      fc.property(fc.double({ min: 3.0, max: 15.0, noNaN: true }), (value) => {
        const result = clampNotificationDuration(value);
        expect(result).toBe(Math.min(15, Math.max(3, Math.round(value))));
      }),
      { numRuns: 100 },
    );
  });
});
