import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { calculateSlotPosition, isSlotPositionValid } from "./hud-slot";

/**
 * Feature: even-hub, Property 1: Slot Position Calculation Invariant
 *
 * For any valid HUD slot assignment (row ∈ {0, 1}, col ∈ {0, 1, 2, 3, 4}),
 * the computed container rectangle SHALL have: x = col × 115, y = row × 58
 * (where 58 = 57 + 1 gap), width = 115, height = 57, and all coordinates
 * satisfy x + width ≤ 576 and y + height ≤ 115. Furthermore, for any two
 * distinct slot positions, the computed rectangles SHALL NOT overlap.
 *
 * Validates: Requirements 1.1, 1.2, 2.4
 */

// --- Arbitraries ---

const arbRow = fc.constantFrom(0 as const, 1 as const);
const arbCol = fc.constantFrom(
  0 as const,
  1 as const,
  2 as const,
  3 as const,
  4 as const,
);

const arbSlot = fc.record({ row: arbRow, col: arbCol });

// Generate two distinct (row, col) pairs
const arbTwoDistinctSlots = fc
  .tuple(arbSlot, arbSlot)
  .filter(([a, b]) => a.row !== b.row || a.col !== b.col);

// --- Property Tests ---

describe("Feature: even-hub, Property 1: Slot Position Calculation Invariant", () => {
  it("computed position stays within HUD bounds (x + width ≤ 576, y + height ≤ 115)", () => {
    fc.assert(
      fc.property(arbRow, arbCol, (row, col) => {
        const pos = calculateSlotPosition(row, col);

        // Verify the position is valid according to bounds checking
        expect(isSlotPositionValid(pos)).toBe(true);

        // Explicitly check the bounds
        expect(pos.x + pos.width).toBeLessThanOrEqual(576);
        expect(pos.y + pos.height).toBeLessThanOrEqual(115);

        // Verify non-negative coordinates
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.y).toBeGreaterThanOrEqual(0);
        expect(pos.width).toBeGreaterThan(0);
        expect(pos.height).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("computed position matches expected formula: x = col × 115, y = row × 58, width = 115, height = 57", () => {
    fc.assert(
      fc.property(arbRow, arbCol, (row, col) => {
        const pos = calculateSlotPosition(row, col);

        expect(pos.x).toBe(col * 115);
        expect(pos.y).toBe(row * 58);
        expect(pos.width).toBe(115);
        expect(pos.height).toBe(57);
      }),
      { numRuns: 100 },
    );
  });

  it("no two distinct slots produce overlapping rectangles", () => {
    fc.assert(
      fc.property(arbTwoDistinctSlots, ([slotA, slotB]) => {
        const posA = calculateSlotPosition(slotA.row, slotA.col);
        const posB = calculateSlotPosition(slotB.row, slotB.col);

        // Two rectangles overlap if:
        // rect1.x < rect2.x + rect2.width AND
        // rect1.x + rect1.width > rect2.x AND
        // rect1.y < rect2.y + rect2.height AND
        // rect1.y + rect1.height > rect2.y
        const overlaps =
          posA.x < posB.x + posB.width &&
          posA.x + posA.width > posB.x &&
          posA.y < posB.y + posB.height &&
          posA.y + posA.height > posB.y;

        expect(overlaps).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
