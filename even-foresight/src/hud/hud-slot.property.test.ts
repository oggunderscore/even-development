import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  calculateSlotPosition,
  isSlotPositionValid,
  colToContainerId,
} from "./hud-slot";
import {
  CONTAINER,
  DISPLAY_WIDTH,
  HUD_COLS,
  HUD_HEIGHT,
  HUD_SLOT_WIDTH,
} from "../constants";

/**
 * Property 1: Slot Position Calculation Invariant
 *
 * For any HUD column (0-4) the computed rectangle is x = col x 115, y = 0,
 * width = 115, height = HUD_HEIGHT; it fits inside the display; and no two
 * distinct columns overlap.
 *
 * The 2x5 logical grid maps onto 5 physical containers — both rows share one
 * container per column and are separated by a newline — so position depends
 * on the column alone.
 */

const arbCol = fc.integer({ min: 0, max: HUD_COLS - 1 });

const arbTwoDistinctCols = fc
  .tuple(arbCol, arbCol)
  .filter(([a, b]) => a !== b);

describe("Property 1: Slot Position Calculation Invariant", () => {
  it("every column position is valid and inside the display", () => {
    fc.assert(
      fc.property(arbCol, (col) => {
        const pos = calculateSlotPosition(col);

        expect(isSlotPositionValid(pos)).toBe(true);
        expect(pos.x + pos.width).toBeLessThanOrEqual(DISPLAY_WIDTH);
        expect(pos.y + pos.height).toBeLessThanOrEqual(HUD_HEIGHT);
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.y).toBeGreaterThanOrEqual(0);
        expect(pos.width).toBeGreaterThan(0);
        expect(pos.height).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("position matches the formula x = col x HUD_SLOT_WIDTH", () => {
    fc.assert(
      fc.property(arbCol, (col) => {
        const pos = calculateSlotPosition(col);

        expect(pos.x).toBe(col * HUD_SLOT_WIDTH);
        expect(pos.y).toBe(0);
        expect(pos.width).toBe(HUD_SLOT_WIDTH);
        expect(pos.height).toBe(HUD_HEIGHT);
      }),
      { numRuns: 100 },
    );
  });

  it("no two distinct columns produce overlapping rectangles", () => {
    fc.assert(
      fc.property(arbTwoDistinctCols, ([colA, colB]) => {
        const a = calculateSlotPosition(colA);
        const b = calculateSlotPosition(colB);

        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;

        expect(overlaps).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("container IDs are unique per column and never hit the overlays", () => {
    fc.assert(
      fc.property(arbTwoDistinctCols, ([colA, colB]) => {
        expect(colToContainerId(colA)).not.toBe(colToContainerId(colB));
        expect(colToContainerId(colA)).not.toBe(CONTAINER.MENU);
        expect(colToContainerId(colA)).not.toBe(CONTAINER.BANNER);
      }),
      { numRuns: 100 },
    );
  });
});
