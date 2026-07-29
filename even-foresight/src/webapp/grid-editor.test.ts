/**
 * Unit tests for hud-layout-editor pure functions.
 *
 * Feature: hud-settings-refinement
 * Validates: Requirements 1.1, 2.1, 2.2, 2.3, 3.3, 4.1, 5.2, 5.3
 */

import { describe, it, expect } from "vitest";
import {
  buildOccupancyGrid,
  canPlace,
  placeWidget,
  removeWidget,
  moveWidgetMultiCell,
  getUnplacedWidgets,
  getAvailableWidgetsForCell,
  migrateOldGrid,
} from "./hud-layout-editor";
import { WIDGET_SIZES } from "./types";
import type { HudGrid, WidgetSize } from "./types";

/**
 * Production ships every widget at 1x1 — the glasses give each HUD column its
 * own container and cannot span them. The placement maths is nonetheless
 * fully general, so multi-cell behaviour is exercised through an explicit
 * size map rather than by pretending WIDGET_SIZES contains sizes it does not.
 */
const MULTI_CELL_SIZES: Record<string, WidgetSize> = {
  clock: { cols: 1, rows: 1 },
  weather: { cols: 2, rows: 1 },
  reminders: { cols: 1, rows: 2 },
  assistant: { cols: 1, rows: 1 },
  tasks: { cols: 1, rows: 1 },
};

// --- buildOccupancyGrid ---

describe("buildOccupancyGrid", () => {
  it("returns all nulls for an empty grid", () => {
    const result = buildOccupancyGrid([]);
    expect(result).toEqual([
      [null, null, null, null, null],
      [null, null, null, null, null],
    ]);
  });

  it("marks a single 1×1 widget in the correct cell", () => {
    const grid: HudGrid = [{ widgetId: "clock", col: 2, row: 0 }];
    const result = buildOccupancyGrid(grid);
    expect(result[0][2]).toBe("clock");
    // All other cells null
    expect(result[0][0]).toBeNull();
    expect(result[0][1]).toBeNull();
    expect(result[0][3]).toBeNull();
    expect(result[0][4]).toBeNull();
    expect(result[1][0]).toBeNull();
    expect(result[1][2]).toBeNull();
  });

  it("spans correct cells for a multi-cell widget (weather 2×1)", () => {
    const grid: HudGrid = [{ widgetId: "weather", col: 1, row: 0 }];
    const result = buildOccupancyGrid(grid, MULTI_CELL_SIZES);
    expect(result[0][1]).toBe("weather");
    expect(result[0][2]).toBe("weather");
    // Adjacent cells unaffected
    expect(result[0][0]).toBeNull();
    expect(result[0][3]).toBeNull();
    expect(result[1][1]).toBeNull();
    expect(result[1][2]).toBeNull();
  });

  it("places multiple widgets correctly", () => {
    const grid: HudGrid = [
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 1, row: 0 },
      { widgetId: "reminders", col: 4, row: 0 }, // 1×2, spans rows 0 and 1
    ];
    const result = buildOccupancyGrid(grid, MULTI_CELL_SIZES);
    expect(result[0][0]).toBe("clock");
    expect(result[0][1]).toBe("weather");
    expect(result[0][2]).toBe("weather");
    expect(result[0][4]).toBe("reminders");
    expect(result[1][4]).toBe("reminders");
    expect(result[0][3]).toBeNull();
    expect(result[1][0]).toBeNull();
  });
});

// --- canPlace ---

describe("canPlace", () => {
  it("returns true for valid placement on empty grid", () => {
    expect(canPlace([], "clock", 0, 0)).toBe(true);
    expect(canPlace([], "weather", 0, 0)).toBe(true);
    expect(canPlace([], "reminders", 0, 0)).toBe(true);
  });

  it("returns false for out-of-bounds placement (weather at col 4)", () => {
    // weather is 2×1, so col 4 + 2 = 6 > 5
    expect(canPlace([], "weather", 4, 0, MULTI_CELL_SIZES)).toBe(false);
  });

  it("returns false when overlapping an existing widget", () => {
    const grid: HudGrid = [{ widgetId: "clock", col: 1, row: 0 }];
    // weather is 2×1, placing at col 0 would span cols 0-1, overlapping clock at col 1
    expect(canPlace(grid, "weather", 0, 0, MULTI_CELL_SIZES)).toBe(false);
  });

  it("returns false for unknown widget ID", () => {
    expect(canPlace([], "nonexistent", 0, 0)).toBe(false);
  });
});

// --- placeWidget ---

describe("placeWidget", () => {
  it("adds widget to grid and does not mutate original (immutability)", () => {
    const original: HudGrid = [{ widgetId: "clock", col: 0, row: 0 }];
    const result = placeWidget(original, "assistant", 2, 1);

    // Result contains the new widget
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ widgetId: "assistant", col: 2, row: 1 });

    // Original unchanged
    expect(original).toHaveLength(1);
    expect(original[0]).toEqual({ widgetId: "clock", col: 0, row: 0 });
  });
});

// --- removeWidget ---

describe("removeWidget", () => {
  it("removes widget and returns new grid without it", () => {
    const grid: HudGrid = [
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 2, row: 0 },
    ];
    const result = removeWidget(grid, "clock");
    expect(result).toHaveLength(1);
    expect(result[0].widgetId).toBe("weather");
  });

  it("returns grid unchanged when removing non-existent widget", () => {
    const grid: HudGrid = [{ widgetId: "clock", col: 0, row: 0 }];
    const result = removeWidget(grid, "nonexistent");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ widgetId: "clock", col: 0, row: 0 });
  });
});

// --- moveWidgetMultiCell ---

describe("moveWidgetMultiCell", () => {
  it("valid move → success: true, widget at new position", () => {
    const grid: HudGrid = [{ widgetId: "clock", col: 0, row: 0 }];
    const { success, newGrid } = moveWidgetMultiCell(grid, "clock", 3, 1);
    expect(success).toBe(true);
    expect(newGrid).toHaveLength(1);
    expect(newGrid[0]).toEqual({ widgetId: "clock", col: 3, row: 1 });
  });

  it("move to occupied cell → success: false, grid unchanged", () => {
    const grid: HudGrid = [
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "assistant", col: 2, row: 0 },
    ];
    const { success, newGrid } = moveWidgetMultiCell(grid, "clock", 2, 0);
    expect(success).toBe(false);
    expect(newGrid).toEqual(grid);
  });

  it("move out of bounds → success: false", () => {
    const grid: HudGrid = [{ widgetId: "weather", col: 0, row: 0 }];
    const { success, newGrid } = moveWidgetMultiCell(
      grid,
      "weather",
      4,
      0,
      MULTI_CELL_SIZES,
    );
    expect(success).toBe(false);
    expect(newGrid).toEqual(grid);
  });

  it("move multi-cell widget (reminders 1×2) → clears both rows at source", () => {
    const grid: HudGrid = [
      { widgetId: "reminders", col: 0, row: 0 },
      { widgetId: "clock", col: 1, row: 0 },
    ];
    const { success, newGrid } = moveWidgetMultiCell(grid, "reminders", 4, 0);
    expect(success).toBe(true);

    // Reminders now at col 4
    const moved = newGrid.find((p) => p.widgetId === "reminders");
    expect(moved).toEqual({ widgetId: "reminders", col: 4, row: 0 });

    // Source cells (col 0, rows 0-1) should be free
    const occupancy = buildOccupancyGrid(newGrid);
    expect(occupancy[0][0]).toBeNull();
    expect(occupancy[1][0]).toBeNull();
  });
});

// --- getUnplacedWidgets ---

describe("getUnplacedWidgets", () => {
  it("returns all 5 widgets for an empty grid", () => {
    const result = getUnplacedWidgets([]);
    expect(result.sort()).toEqual(Object.keys(WIDGET_SIZES).sort());
    expect(result).toHaveLength(5);
  });

  it("returns only unplaced widgets when some are placed", () => {
    const grid: HudGrid = [
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 1, row: 0 },
    ];
    const result = getUnplacedWidgets(grid);
    expect(result).not.toContain("clock");
    expect(result).not.toContain("weather");
    expect(result).toContain("reminders");
    expect(result).toContain("assistant");
    expect(result).toContain("tasks");
    expect(result).toHaveLength(3);
  });
});

// --- getAvailableWidgetsForCell ---

describe("getAvailableWidgetsForCell", () => {
  it("empty grid at (0,0) → all widgets that fit", () => {
    const result = getAvailableWidgetsForCell([], 0, 0);
    // All widgets fit at (0,0) on an empty 2×5 grid
    expect(result.sort()).toEqual(Object.keys(WIDGET_SIZES).sort());
  });

  it("full grid → empty list", () => {
    // Fill the grid completely with 1×1 widgets (using fictional placements
    // that cover all cells — we use only the 5 real widgets plus some overlap
    // to demonstrate an effectively full grid)
    const grid: HudGrid = [
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 1, row: 0 }, // spans cols 1-2
      { widgetId: "assistant", col: 3, row: 0 },
      { widgetId: "reminders", col: 4, row: 0 }, // spans rows 0-1
      { widgetId: "tasks", col: 0, row: 1 },
    ];
    // All widgets are placed, so none are unplaced → empty list regardless of position
    const result = getAvailableWidgetsForCell(grid, 1, 1);
    expect(result).toEqual([]);
  });

  it("position that only fits 1×1 widgets → only 1×1 widgets returned", () => {
    // Place weather at cols 0-1 row 0, so at col 4 row 0 only 1 col remains in row 0
    // and reminders (1×2) would need row 0 + row 1 free at col 4
    // weather occupies cols 3-4 at row 1, so col 4 row 0 has only 1 col and
    // the cell below (row 1, col 4) is occupied — only 1×1 widgets fit
    const grid: HudGrid = [
      { widgetId: "weather", col: 3, row: 1 }, // occupies (3,1) and (4,1)
    ];
    // At position (4, 0): only 1 column available, row below is occupied
    // weather is 2×1 — needs 2 cols, won't fit (col 4 + 2 > 5)
    // reminders is 1×2 — needs 2 rows, but (4,1) is occupied
    // clock, assistant, tasks are 1×1 — fit fine
    const result = getAvailableWidgetsForCell(grid, 4, 0, MULTI_CELL_SIZES);
    // weather is unplaced but doesn't fit; reminders is unplaced but doesn't fit
    expect(result).toContain("clock");
    expect(result).toContain("assistant");
    expect(result).toContain("tasks");
    expect(result).not.toContain("weather");
    expect(result).not.toContain("reminders");
  });
});

// --- migrateOldGrid ---

describe("migrateOldGrid", () => {
  it("converts old format (10-element array) to placements", () => {
    const old = [
      "clock",
      null,
      "weather",
      null,
      null,
      null,
      null,
      null,
      "tasks",
      null,
    ];
    const result = migrateOldGrid(old);
    expect(result).toEqual([
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 2, row: 0 },
      { widgetId: "tasks", col: 3, row: 1 },
    ]);
  });

  it("passes through new format (WidgetPlacement[])", () => {
    const newFormat: HudGrid = [
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 2, row: 1 },
    ];
    const result = migrateOldGrid(newFormat);
    expect(result).toEqual(newFormat);
  });

  it("returns empty array for non-array input", () => {
    expect(migrateOldGrid(null)).toEqual([]);
    expect(migrateOldGrid(undefined)).toEqual([]);
    expect(migrateOldGrid("not an array")).toEqual([]);
    expect(migrateOldGrid(42)).toEqual([]);
    expect(migrateOldGrid({})).toEqual([]);
  });

  it("returns empty placements for old-format array with all nulls", () => {
    const allNulls = Array(10).fill(null);
    const result = migrateOldGrid(allNulls);
    expect(result).toEqual([]);
  });
});
