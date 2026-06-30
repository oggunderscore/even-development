import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { truncateText, navigateDown, navigateUp } from "./menu-system";

/**
 * Feature: even-hub, Property 11: Text Truncation Correctness
 *
 * For any string and any maximum length M, the truncation function SHALL return
 * the original string unchanged if string.length ≤ M, or a string of exactly M
 * characters where the last 3 characters are "..." if string.length > M.
 *
 * Validates: Requirements 6.2, 8.2
 */

// --- Arbitraries ---

const arbText = fc.string({ minLength: 0, maxLength: 100 });
const arbMaxLength = fc.integer({ min: 3, max: 50 });

// --- Property 11 Tests ---

describe("Feature: even-hub, Property 11: Text Truncation Correctness", () => {
  it("returns original string unchanged when string.length ≤ maxLength", () => {
    fc.assert(
      fc.property(arbText, arbMaxLength, (text, maxLength) => {
        fc.pre(text.length <= maxLength);

        const result = truncateText(text, maxLength);
        expect(result).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it("returns exactly maxLength chars ending in '...' when string.length > maxLength", () => {
    fc.assert(
      fc.property(arbText, arbMaxLength, (text, maxLength) => {
        fc.pre(text.length > maxLength);

        const result = truncateText(text, maxLength);

        // Result has exactly maxLength characters
        expect(result.length).toBe(maxLength);

        // Result ends with "..."
        expect(result.endsWith("...")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: even-hub, Property 12: Menu Navigation Bounds
 *
 * For any menu state with N entries (1 ≤ N ≤ 10) and current highlight index I
 * (0 ≤ I < N): applying swipe-down SHALL produce index min(I + 1, N − 1), and
 * applying swipe-up SHALL produce index max(I − 1, 0). The resulting index SHALL
 * always satisfy 0 ≤ result < N.
 *
 * Validates: Requirements 6.3, 6.4, 6.7, 6.8
 */

// --- Arbitraries ---

const arbMenuState = fc.integer({ min: 1, max: 10 }).chain((totalEntries) =>
  fc.record({
    totalEntries: fc.constant(totalEntries),
    currentIndex: fc.integer({ min: 0, max: totalEntries - 1 }),
  }),
);

// --- Property 12 Tests ---

describe("Feature: even-hub, Property 12: Menu Navigation Bounds", () => {
  it("navigateDown produces min(I+1, N-1)", () => {
    fc.assert(
      fc.property(arbMenuState, ({ totalEntries, currentIndex }) => {
        const result = navigateDown(currentIndex, totalEntries);
        const expected = Math.min(currentIndex + 1, totalEntries - 1);

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("navigateUp produces max(I-1, 0)", () => {
    fc.assert(
      fc.property(arbMenuState, ({ currentIndex }) => {
        const result = navigateUp(currentIndex);
        const expected = Math.max(currentIndex - 1, 0);

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("navigateDown result is always in [0, N)", () => {
    fc.assert(
      fc.property(arbMenuState, ({ totalEntries, currentIndex }) => {
        const result = navigateDown(currentIndex, totalEntries);

        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(totalEntries);
      }),
      { numRuns: 100 },
    );
  });

  it("navigateUp result is always in [0, N)", () => {
    fc.assert(
      fc.property(arbMenuState, ({ totalEntries, currentIndex }) => {
        const result = navigateUp(currentIndex);

        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(totalEntries);
      }),
      { numRuns: 100 },
    );
  });
});
