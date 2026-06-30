import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatTime } from "./clock";

/**
 * Feature: even-hub, Property 3: Clock Format Output Validity
 *
 * For any valid time (hours 0–23, minutes 0–59), rendering in 12-hour format
 * SHALL produce a string matching the pattern `h:mm AM` or `h:mm PM` where
 * h ∈ [1, 12] and mm is zero-padded, and rendering in 24-hour format SHALL
 * produce a string matching `HH:mm` where HH is zero-padded 00–23.
 *
 * Validates: Requirements 3.2
 */

// --- Arbitraries ---

const arbHours = fc.integer({ min: 0, max: 23 });
const arbMinutes = fc.integer({ min: 0, max: 59 });

// --- Property Tests ---

describe("Feature: even-hub, Property 3: Clock Format Output Validity", () => {
  it("12h format output matches h:mm AM|PM with h ∈ [1,12]", () => {
    fc.assert(
      fc.property(arbHours, arbMinutes, (hours, minutes) => {
        const result = formatTime(hours, minutes, "12h");

        // Must match pattern: 1-12, colon, two digits, space, AM or PM
        const match = result.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
        expect(match).not.toBeNull();

        const h = parseInt(match![1], 10);
        const mm = match![2];

        // Hour must be in [1, 12]
        expect(h).toBeGreaterThanOrEqual(1);
        expect(h).toBeLessThanOrEqual(12);

        // Minutes must be zero-padded 2 digits
        expect(mm).toHaveLength(2);
        const m = parseInt(mm, 10);
        expect(m).toBe(minutes);
      }),
      { numRuns: 100 },
    );
  });

  it("24h format output matches HH:mm with zero-padded 00–23", () => {
    fc.assert(
      fc.property(arbHours, arbMinutes, (hours, minutes) => {
        const result = formatTime(hours, minutes, "24h");

        // Must match pattern: two digits, colon, two digits
        const match = result.match(/^(\d{2}):(\d{2})$/);
        expect(match).not.toBeNull();

        const HH = parseInt(match![1], 10);
        const mm = parseInt(match![2], 10);

        // Hours must be in [0, 23]
        expect(HH).toBeGreaterThanOrEqual(0);
        expect(HH).toBeLessThanOrEqual(23);
        expect(HH).toBe(hours);

        // Minutes must be in [0, 59]
        expect(mm).toBeGreaterThanOrEqual(0);
        expect(mm).toBeLessThanOrEqual(59);
        expect(mm).toBe(minutes);
      }),
      { numRuns: 100 },
    );
  });

  it("hours 0-11 produce AM in 12h format, hours 12-23 produce PM", () => {
    fc.assert(
      fc.property(arbHours, arbMinutes, (hours, minutes) => {
        const result = formatTime(hours, minutes, "12h");
        const period = result.split(" ")[1];

        if (hours < 12) {
          expect(period).toBe("AM");
        } else {
          expect(period).toBe("PM");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("minute part is always zero-padded to 2 digits", () => {
    fc.assert(
      fc.property(arbHours, arbMinutes, (hours, minutes) => {
        const result12 = formatTime(hours, minutes, "12h");
        const result24 = formatTime(hours, minutes, "24h");

        // Extract minute part from 12h format (before the space)
        const timePart12 = result12.split(" ")[0];
        const minutePart12 = timePart12.split(":")[1];
        expect(minutePart12).toHaveLength(2);

        // Extract minute part from 24h format
        const minutePart24 = result24.split(":")[1];
        expect(minutePart24).toHaveLength(2);
      }),
      { numRuns: 100 },
    );
  });
});
