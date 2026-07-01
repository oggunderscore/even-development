import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildOccupancyGrid,
  canPlace,
  placeWidget,
  removeWidget,
  moveWidgetMultiCell,
  getUnplacedWidgets,
  getAvailableWidgetsForCell,
} from "./hud-layout-editor";
import { WIDGET_SIZES } from "./types";
import type { HudGrid } from "./types";

/**
 * Feature: hud-settings-refinement
 *
 * Property-based tests for the HUD Layout Editor pure functions.
 * Grid: 2 rows × 5 columns.
 * Widget sizes: clock(1×1), weather(2×1), reminders(1×2), assistant(1×1), tasks(1×1)
 */

// --- Constants ---

const HUD_ROWS = 2;
const HUD_COLS = 5;
const ALL_WIDGET_IDS = Object.keys(WIDGET_SIZES);

// --- Arbitraries ---

/**
 * Generate a valid non-overlapping grid state by iteratively trying to place
 * widgets at random valid positions.
 */
const arbValidGrid: fc.Arbitrary<HudGrid> = fc
  .shuffledSubarray(ALL_WIDGET_IDS, {
    minLength: 0,
    maxLength: ALL_WIDGET_IDS.length,
  })
  .chain((widgetIds) =>
    fc.tuple(
      fc.constant(widgetIds),
      fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: HUD_COLS - 1 }),
          fc.integer({ min: 0, max: HUD_ROWS - 1 }),
        ),
        { minLength: widgetIds.length, maxLength: widgetIds.length },
      ),
    ),
  )
  .map(([widgetIds, positions]) => {
    let grid: HudGrid = [];
    for (let i = 0; i < widgetIds.length; i++) {
      const [col, row] = positions[i];
      if (canPlace(grid, widgetIds[i], col, row)) {
        grid = placeWidget(grid, widgetIds[i], col, row);
      }
    }
    return grid;
  });

/**
 * Generate a valid grid that has at least one widget placed.
 */
const arbNonEmptyGrid: fc.Arbitrary<HudGrid> = arbValidGrid.filter(
  (grid) => grid.length > 0,
);

/**
 * Generate a cell position within the grid bounds.
 */
const arbCellPosition: fc.Arbitrary<{ col: number; row: number }> = fc.record({
  col: fc.integer({ min: 0, max: HUD_COLS - 1 }),
  row: fc.integer({ min: 0, max: HUD_ROWS - 1 }),
});

// --- Property 1: Placement occupies exactly the correct cells ---

/**
 * Property 1: Placement occupies exactly the correct cells
 *
 * For any valid grid state, buildOccupancyGrid SHALL have each widget's ID
 * in exactly the cells from (col..col+size.cols-1) × (row..row+size.rows-1),
 * and no other cells SHALL contain that widget's ID.
 *
 * Validates: Requirements 2.3, 3.3
 */
describe("Feature: hud-settings-refinement, Property 1: Placement occupies exactly the correct cells", () => {
  it("each placed widget occupies exactly its size cells and nothing else", () => {
    fc.assert(
      fc.property(arbValidGrid, (grid) => {
        const occupancy = buildOccupancyGrid(grid);

        // For each placement, verify the widget occupies exactly its size cells
        for (const placement of grid) {
          const size = WIDGET_SIZES[placement.widgetId];

          // All cells within the widget's span should contain the widget ID
          for (let r = placement.row; r < placement.row + size.rows; r++) {
            for (let c = placement.col; c < placement.col + size.cols; c++) {
              expect(occupancy[r][c]).toBe(placement.widgetId);
            }
          }
        }

        // Verify total occupied cell count matches sum of all widget sizes
        let expectedOccupiedCount = 0;
        for (const placement of grid) {
          const size = WIDGET_SIZES[placement.widgetId];
          expectedOccupiedCount += size.cols * size.rows;
        }

        let actualOccupiedCount = 0;
        for (let r = 0; r < HUD_ROWS; r++) {
          for (let c = 0; c < HUD_COLS; c++) {
            if (occupancy[r][c] !== null) {
              actualOccupiedCount++;
            }
          }
        }

        expect(actualOccupiedCount).toBe(expectedOccupiedCount);
      }),
      { numRuns: 100 },
    );
  });

  it("cells outside a widget's span do not contain that widget's ID", () => {
    fc.assert(
      fc.property(arbValidGrid, (grid) => {
        const occupancy = buildOccupancyGrid(grid);

        for (const placement of grid) {
          const size = WIDGET_SIZES[placement.widgetId];

          // Check all cells NOT in this widget's span
          for (let r = 0; r < HUD_ROWS; r++) {
            for (let c = 0; c < HUD_COLS; c++) {
              const inSpan =
                r >= placement.row &&
                r < placement.row + size.rows &&
                c >= placement.col &&
                c < placement.col + size.cols;

              if (!inSpan && occupancy[r][c] === placement.widgetId) {
                expect.fail(
                  `Widget "${placement.widgetId}" found at (${c},${r}) which is outside its span`,
                );
              }
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2: Available widgets are exactly the unplaced widgets that fit ---

/**
 * Property 2: Available widgets are exactly the unplaced widgets that fit
 *
 * For any grid state and any cell position, getAvailableWidgetsForCell SHALL
 * return exactly those widget IDs that are (a) not placed AND (b) can fit at
 * the given position.
 *
 * Validates: Requirements 3.1, 3.2
 */
describe("Feature: hud-settings-refinement, Property 2: Available widgets are exactly the unplaced widgets that fit", () => {
  it("result contains only unplaced widgets whose size fits at position", () => {
    fc.assert(
      fc.property(arbValidGrid, arbCellPosition, (grid, cell) => {
        const available = getAvailableWidgetsForCell(grid, cell.col, cell.row);
        const unplaced = getUnplacedWidgets(grid);

        // Every returned widget must be unplaced
        for (const widgetId of available) {
          expect(unplaced).toContain(widgetId);
        }

        // Every returned widget must fit at the position
        for (const widgetId of available) {
          expect(canPlace(grid, widgetId, cell.col, cell.row)).toBe(true);
        }

        // Every unplaced widget that fits must be in the result
        for (const widgetId of unplaced) {
          if (canPlace(grid, widgetId, cell.col, cell.row)) {
            expect(available).toContain(widgetId);
          } else {
            expect(available).not.toContain(widgetId);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("no placed widget is ever returned as available", () => {
    fc.assert(
      fc.property(arbValidGrid, arbCellPosition, (grid, cell) => {
        const available = getAvailableWidgetsForCell(grid, cell.col, cell.row);
        const placedIds = new Set(grid.map((p) => p.widgetId));

        for (const widgetId of available) {
          expect(placedIds.has(widgetId)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 3: Removal frees all cells occupied by the widget ---

/**
 * Property 3: Removal frees all cells occupied by the widget
 *
 * For any grid containing a placed widget, removing that widget SHALL produce
 * a new grid where none of the cells previously covered contain that widget's ID,
 * and all other placements remain unchanged.
 *
 * Validates: Requirements 4.1, 4.3
 */
describe("Feature: hud-settings-refinement, Property 3: Removal frees all cells occupied by the widget", () => {
  it("removed widget's cells are empty and other placements unchanged", () => {
    fc.assert(
      fc.property(arbNonEmptyGrid, (grid) => {
        // Pick a random widget to remove (use the first one for determinism in the property)
        const targetPlacement = grid[0];
        const targetId = targetPlacement.widgetId;
        const targetSize = WIDGET_SIZES[targetId];

        const newGrid = removeWidget(grid, targetId);
        const newOccupancy = buildOccupancyGrid(newGrid);

        // All cells that were occupied by the removed widget should now be free
        // (or occupied by a different widget, but since we have non-overlapping grids, they should be null)
        for (
          let r = targetPlacement.row;
          r < targetPlacement.row + targetSize.rows;
          r++
        ) {
          for (
            let c = targetPlacement.col;
            c < targetPlacement.col + targetSize.cols;
            c++
          ) {
            expect(newOccupancy[r][c]).not.toBe(targetId);
          }
        }

        // All other placements remain in the grid
        const otherPlacements = grid.filter((p) => p.widgetId !== targetId);
        for (const p of otherPlacements) {
          const found = newGrid.find(
            (np) =>
              np.widgetId === p.widgetId &&
              np.col === p.col &&
              np.row === p.row,
          );
          expect(found).toBeDefined();
        }

        // The removed widget is not in the new grid
        expect(newGrid.find((p) => p.widgetId === targetId)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("other widgets' cells remain unchanged after removal", () => {
    fc.assert(
      fc.property(arbNonEmptyGrid, (grid) => {
        const targetId = grid[0].widgetId;

        const originalOccupancy = buildOccupancyGrid(grid);
        const newGrid = removeWidget(grid, targetId);
        const newOccupancy = buildOccupancyGrid(newGrid);

        // Every cell that was occupied by a different widget should remain the same
        for (let r = 0; r < HUD_ROWS; r++) {
          for (let c = 0; c < HUD_COLS; c++) {
            if (
              originalOccupancy[r][c] !== null &&
              originalOccupancy[r][c] !== targetId
            ) {
              expect(newOccupancy[r][c]).toBe(originalOccupancy[r][c]);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 4: Successful multi-cell move clears source and fills target ---

/**
 * Property 4: Successful multi-cell move clears source and fills target
 *
 * For any grid and placed widget moved to a valid target position, the resulting
 * grid SHALL have the widget at the new position, the source cells free, and
 * all other placements unchanged.
 *
 * Validates: Requirements 5.1, 5.2, 5.4
 */
describe("Feature: hud-settings-refinement, Property 4: Successful multi-cell move clears source and fills target", () => {
  it("widget appears at target, source is free, others unchanged", () => {
    fc.assert(
      fc.property(
        arbNonEmptyGrid.chain((grid) => {
          // Pick the widget to move
          const widget = grid[0];
          const widgetId = widget.widgetId;
          const size = WIDGET_SIZES[widgetId];

          // Generate valid target positions (within bounds)
          const maxCol = HUD_COLS - size.cols;
          const maxRow = HUD_ROWS - size.rows;

          return fc.tuple(
            fc.constant(grid),
            fc.constant(widgetId),
            fc.integer({ min: 0, max: maxCol }),
            fc.integer({ min: 0, max: maxRow }),
          );
        }),
        ([grid, widgetId, targetCol, targetRow]) => {
          const result = moveWidgetMultiCell(
            grid,
            widgetId,
            targetCol,
            targetRow,
          );

          // Only test successful moves
          if (!result.success) return;

          const size = WIDGET_SIZES[widgetId];
          const newOccupancy = buildOccupancyGrid(result.newGrid);

          // Target cells should contain the moved widget
          for (let r = targetRow; r < targetRow + size.rows; r++) {
            for (let c = targetCol; c < targetCol + size.cols; c++) {
              expect(newOccupancy[r][c]).toBe(widgetId);
            }
          }

          // Source cells should NOT contain the widget (unless source == target)
          const originalPlacement = grid.find((p) => p.widgetId === widgetId)!;
          if (
            originalPlacement.col !== targetCol ||
            originalPlacement.row !== targetRow
          ) {
            for (
              let r = originalPlacement.row;
              r < originalPlacement.row + size.rows;
              r++
            ) {
              for (
                let c = originalPlacement.col;
                c < originalPlacement.col + size.cols;
                c++
              ) {
                // Source cell should not have the widget (unless it overlaps with target)
                const inTarget =
                  r >= targetRow &&
                  r < targetRow + size.rows &&
                  c >= targetCol &&
                  c < targetCol + size.cols;
                if (!inTarget) {
                  expect(newOccupancy[r][c]).not.toBe(widgetId);
                }
              }
            }
          }

          // Other placements should remain unchanged
          const otherPlacements = grid.filter((p) => p.widgetId !== widgetId);
          for (const p of otherPlacements) {
            const found = result.newGrid.find(
              (np) =>
                np.widgetId === p.widgetId &&
                np.col === p.col &&
                np.row === p.row,
            );
            expect(found).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 5: Rejected multi-cell move preserves grid unchanged ---

/**
 * Property 5: Rejected multi-cell move preserves grid unchanged
 *
 * For any grid and placed widget, when a move is attempted to a position where
 * the required cells are not all free (out of bounds or occupied), the grid
 * SHALL remain identical to before.
 *
 * Validates: Requirements 5.3
 */
describe("Feature: hud-settings-refinement, Property 5: Rejected multi-cell move preserves grid unchanged", () => {
  it("invalid target (out of bounds) preserves grid unchanged", () => {
    fc.assert(
      fc.property(
        arbNonEmptyGrid,
        fc.integer({ min: 0, max: HUD_COLS + 2 }),
        fc.integer({ min: 0, max: HUD_ROWS + 2 }),
        (grid, targetCol, targetRow) => {
          const widgetId = grid[0].widgetId;
          const size = WIDGET_SIZES[widgetId];

          // Only test cases where the target is actually out of bounds
          if (
            targetCol + size.cols <= HUD_COLS &&
            targetRow + size.rows <= HUD_ROWS
          ) {
            // This position might be valid — skip
            return;
          }

          const result = moveWidgetMultiCell(
            grid,
            widgetId,
            targetCol,
            targetRow,
          );

          expect(result.success).toBe(false);
          expect(result.newGrid).toEqual(grid);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("invalid target (occupied by another widget) preserves grid unchanged", () => {
    fc.assert(
      fc.property(
        arbValidGrid.filter((grid) => grid.length >= 2),
        (grid) => {
          // Pick the first widget to move
          const movingWidget = grid[0];
          const movingId = movingWidget.widgetId;

          // Try to move it to the position of another widget (should be occupied)
          const otherWidget = grid[1];
          const targetCol = otherWidget.col;
          const targetRow = otherWidget.row;

          const result = moveWidgetMultiCell(
            grid,
            movingId,
            targetCol,
            targetRow,
          );

          // If the move was rejected, verify grid is unchanged
          if (!result.success) {
            expect(result.newGrid).toEqual(grid);
          }
          // Note: it might succeed if the moving widget's size fits at the other's position
          // after removing itself (e.g., if they don't overlap). That's fine — we only
          // assert the invariant for rejected moves.
        },
      ),
      { numRuns: 100 },
    );
  });

  it("any rejected move preserves grid exactly", () => {
    fc.assert(
      fc.property(arbNonEmptyGrid, arbCellPosition, (grid, target) => {
        const widgetId = grid[0].widgetId;

        const result = moveWidgetMultiCell(
          grid,
          widgetId,
          target.col,
          target.row,
        );

        // Only verify the invariant when the move is rejected
        if (!result.success) {
          expect(result.newGrid).toEqual(grid);
        }
      }),
      { numRuns: 100 },
    );
  });
});
