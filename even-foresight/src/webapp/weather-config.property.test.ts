import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateLocation } from "./weather-config-form";

/**
 * Feature: foresight-webapp-ui, Property 8: Weather location validation
 *
 * Validation accepts strings [1, 50] and rejects length 0 or > 50
 *
 * Validates: Requirements 6.4, 6.5
 */

// Feature: foresight-webapp-ui, Property 8: Weather location validation
describe("Feature: foresight-webapp-ui, Property 8: Weather location validation", () => {
  it("accepts strings with length in [1, 50]", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (location) => {
        expect(validateLocation(location)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects empty string (length 0)", () => {
    expect(validateLocation("")).toBe(false);
  });

  it("rejects strings with length > 50", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 51, maxLength: 200 }), (location) => {
        expect(validateLocation(location)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
