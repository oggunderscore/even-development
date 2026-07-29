/**
 * HUD Layout Editor for the webapp Settings page.
 *
 * Renders a 2×5 grid representing the HUD home page layout.
 * Supports multi-cell widgets with fixed sizes, a widget picker for
 * placing new widgets, removal interactions, and select-source →
 * select-target move interactions with conflict detection.
 *
 * Feature: hud-settings-refinement
 */

import { loadConfig, saveConfig } from "./storage-helpers";
import { WIDGET_SIZES, STORAGE_KEYS } from "./types";
import type { HudGrid, WidgetSize } from "./types";

// --- Grid Constants ---

const HUD_ROWS = 2;
const HUD_COLS = 5;

/** CSS class prefix for all grid elements. */
const CSS_PREFIX = "hud-grid";

/**
 * Map of widget id to its footprint.
 *
 * Every function below takes this as an optional parameter rather than
 * reading `WIDGET_SIZES` directly. Production always passes the default (all
 * widgets are 1x1, because the glasses renderer gives each column its own
 * container and cannot span them), but the placement maths is fully general,
 * and the parameter is what lets the tests exercise the multi-cell paths.
 */
export type SizeMap = Record<string, WidgetSize>;

// --- Pure Functions (exported for testing) ---

/**
 * Build a 2D occupancy grid from placements.
 * Returns a 2×5 array where each cell is either the widgetId occupying it or null.
 */
export function buildOccupancyGrid(
  placements: HudGrid,
  sizes: SizeMap = WIDGET_SIZES,
): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: HUD_ROWS }, () =>
    Array.from({ length: HUD_COLS }, () => null),
  );
  for (const p of placements) {
    const size = sizes[p.widgetId];
    if (!size) continue;
    for (let r = p.row; r < p.row + size.rows; r++) {
      for (let c = p.col; c < p.col + size.cols; c++) {
        if (r >= 0 && c >= 0 && r < HUD_ROWS && c < HUD_COLS) {
          grid[r][c] = p.widgetId;
        }
      }
    }
  }
  return grid;
}

/**
 * Check whether a widget of given size can be placed at (col, row)
 * without overlapping any existing placements.
 */
export function canPlace(
  placements: HudGrid,
  widgetId: string,
  col: number,
  row: number,
  sizes: SizeMap = WIDGET_SIZES,
): boolean {
  const size = sizes[widgetId];
  if (!size) return false;
  // Bounds check
  if (col < 0 || row < 0) return false;
  if (col + size.cols > HUD_COLS || row + size.rows > HUD_ROWS) return false;
  // Occupancy check
  const occupancy = buildOccupancyGrid(placements, sizes);
  for (let r = row; r < row + size.rows; r++) {
    for (let c = col; c < col + size.cols; c++) {
      if (occupancy[r][c] !== null) return false;
    }
  }
  return true;
}

/**
 * Place a widget at (col, row). Returns the new grid.
 * Caller must verify canPlace() first.
 */
export function placeWidget(
  placements: HudGrid,
  widgetId: string,
  col: number,
  row: number,
): HudGrid {
  return [...placements, { widgetId, col, row }];
}

/**
 * Remove a widget from the grid by widgetId.
 * Returns the new grid with that widget's placement removed.
 */
export function removeWidget(placements: HudGrid, widgetId: string): HudGrid {
  return placements.filter((p) => p.widgetId !== widgetId);
}

/**
 * Move a widget to a new position. Returns { success, newGrid }.
 * Validates that all target cells are free (excluding the widget being moved).
 */
export function moveWidgetMultiCell(
  placements: HudGrid,
  widgetId: string,
  targetCol: number,
  targetRow: number,
  sizes: SizeMap = WIDGET_SIZES,
): { success: boolean; newGrid: HudGrid } {
  const withoutSelf = removeWidget(placements, widgetId);
  if (!canPlace(withoutSelf, widgetId, targetCol, targetRow, sizes)) {
    return { success: false, newGrid: placements };
  }
  return {
    success: true,
    newGrid: placeWidget(withoutSelf, widgetId, targetCol, targetRow),
  };
}

/**
 * Get list of widget IDs that are not currently placed on the grid.
 */
export function getUnplacedWidgets(
  placements: HudGrid,
  sizes: SizeMap = WIDGET_SIZES,
): string[] {
  const placedIds = new Set(placements.map((p) => p.widgetId));
  return Object.keys(sizes).filter((id) => !placedIds.has(id));
}

/**
 * Get available widgets that fit at a given cell position.
 * A widget is available if it is not placed AND its size fits
 * in the contiguous free space from (col, row).
 */
export function getAvailableWidgetsForCell(
  placements: HudGrid,
  col: number,
  row: number,
  sizes: SizeMap = WIDGET_SIZES,
): string[] {
  return getUnplacedWidgets(placements, sizes).filter((id) =>
    canPlace(placements, id, col, row, sizes),
  );
}

// --- Migration ---

/**
 * Migrate old flat-array grid format to placement-based format.
 * Old format: (string | null)[] with 10 elements (2 rows × 5 cols, row-major).
 * New format: WidgetPlacement[] (list of placements with col/row positions).
 */
export function migrateOldGrid(stored: unknown): HudGrid {
  if (!Array.isArray(stored)) return [];
  // Old format: flat array of 10 string|null
  if (
    stored.length === 10 &&
    stored.every((s) => s === null || typeof s === "string")
  ) {
    const placements: HudGrid = [];
    for (let i = 0; i < 10; i++) {
      if (stored[i] !== null) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        placements.push({ widgetId: stored[i] as string, col, row });
      }
    }
    return placements;
  }
  // New format: WidgetPlacement[]
  return stored as HudGrid;
}

// --- Editor Options ---

export interface HudLayoutEditorOptions {
  bridge: any | null;
  initialGrid?: HudGrid;
}

export interface HudLayoutEditor {
  mount(container: HTMLElement): void;
  unmount(): void;
  getGrid(): HudGrid;
}

// --- Factory ---

/**
 * Create a HUD layout editor instance.
 *
 * The editor renders a 2×5 grid and supports widget placement via picker,
 * removal via long-press or "×" button, and slot-to-slot moves via
 * click-source then click-target interaction.
 */
export function createHudLayoutEditor(
  options: HudLayoutEditorOptions,
): HudLayoutEditor {
  const { bridge } = options;
  let grid: HudGrid = options.initialGrid ? [...options.initialGrid] : [];
  let selectedWidgetId: string | null = null;
  let container: HTMLElement | null = null;
  let errorMessage: string | null = null;
  let conflictCell: { col: number; row: number } | null = null;
  let conflictTimeout: ReturnType<typeof setTimeout> | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let pickerElement: HTMLElement | null = null;
  let pickerOutsideClickHandler: ((e: MouseEvent) => void) | null = null;
  let pickerEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

  function render(): void {
    if (!container) return;
    container.innerHTML = "";

    const occupancy = buildOccupancyGrid(grid);

    // Grid wrapper
    const gridEl = document.createElement("div");
    gridEl.className = `${CSS_PREFIX}__container`;
    gridEl.setAttribute("role", "grid");
    gridEl.style.display = "grid";
    gridEl.style.gridTemplateColumns = `repeat(${HUD_COLS}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${HUD_ROWS}, 1fr)`;
    gridEl.style.gap = "4px";

    // Track which cells are anchor cells (first cell of a multi-cell widget)
    const anchors = new Map<string, { col: number; row: number }>();
    for (const p of grid) {
      anchors.set(p.widgetId, { col: p.col, row: p.row });
    }

    for (let row = 0; row < HUD_ROWS; row++) {
      for (let col = 0; col < HUD_COLS; col++) {
        const widgetId = occupancy[row][col];
        const cell = document.createElement("div");
        cell.setAttribute("role", "gridcell");
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.style.gridColumn = `${col + 1}`;
        cell.style.gridRow = `${row + 1}`;

        if (widgetId !== null) {
          // Occupied cell — render widget in a fixed-size cell (no spanning)
          cell.className = `${CSS_PREFIX}__slot ${CSS_PREFIX}__slot--occupied`;

          // Only show widget name on the anchor cell (top-left of placement)
          const anchor = anchors.get(widgetId);
          const isAnchor = !!(
            anchor &&
            anchor.col === col &&
            anchor.row === row
          );

          if (isAnchor) {
            const nameSpan = document.createElement("span");
            nameSpan.className = `${CSS_PREFIX}__widget-name`;
            nameSpan.textContent = widgetId;
            cell.appendChild(nameSpan);
          } else {
            // Continuation cell — dim it so it's clearly part of the widget
            cell.classList.add(`${CSS_PREFIX}__slot--continuation`);
          }

          // Selected highlight + remove button (only on anchor cell)
          if (widgetId === selectedWidgetId && isAnchor) {
            cell.classList.add(`${CSS_PREFIX}__slot--selected`);

            const removeBtn = document.createElement("button");
            removeBtn.className = `${CSS_PREFIX}__remove-btn`;
            removeBtn.textContent = "\u00d7";
            removeBtn.setAttribute("aria-label", `Remove ${widgetId}`);
            removeBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              handleRemoveWidget(widgetId);
            });
            cell.appendChild(removeBtn);
          }

          // Long-press removal (500ms)
          cell.addEventListener("pointerdown", () => {
            clearLongPressTimer();
            longPressTimer = setTimeout(() => {
              longPressTimer = null;
              handleRemoveWidget(widgetId);
            }, 500);
          });
          cell.addEventListener("pointerup", () => {
            clearLongPressTimer();
          });
          cell.addEventListener("pointerleave", () => {
            clearLongPressTimer();
          });

          cell.addEventListener("click", () => handleCellClick(col, row, cell));
        } else {
          // Empty cell
          cell.className = `${CSS_PREFIX}__slot ${CSS_PREFIX}__slot--empty`;

          // Conflict indicator
          if (
            conflictCell &&
            conflictCell.col === col &&
            conflictCell.row === row
          ) {
            cell.classList.add(`${CSS_PREFIX}__slot--conflict`);
          }

          cell.addEventListener("click", () => handleCellClick(col, row, cell));
        }

        gridEl.appendChild(cell);
      }
    }

    container.appendChild(gridEl);

    // Error message display
    if (errorMessage) {
      const errorEl = document.createElement("div");
      errorEl.className = `${CSS_PREFIX}__error`;
      errorEl.textContent = errorMessage;
      container.appendChild(errorEl);
    }
  }

  function clearLongPressTimer(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleRemoveWidget(widgetId: string): void {
    grid = removeWidget(grid, widgetId);
    selectedWidgetId = null;
    errorMessage = null;
    render();
    persistLayout();
  }

  function handleCellClick(
    col: number,
    row: number,
    anchorElement: HTMLElement,
  ): void {
    const occupancy = buildOccupancyGrid(grid);
    const widgetId = occupancy[row][col];

    // If no source selected yet
    if (selectedWidgetId === null) {
      // Only select cells that contain a widget
      if (widgetId !== null) {
        selectedWidgetId = widgetId;
        render();
      } else {
        // Empty cell with no widget selected → open widget picker
        showWidgetPicker(col, row, anchorElement);
      }
      return;
    }

    // Clicking the same widget again → deselect
    if (widgetId === selectedWidgetId) {
      selectedWidgetId = null;
      render();
      return;
    }

    // Clicking an empty cell → attempt move
    if (widgetId === null) {
      const result = moveWidgetMultiCell(grid, selectedWidgetId, col, row);
      if (result.success) {
        grid = result.newGrid;
        selectedWidgetId = null;
        errorMessage = null;
        render();
        persistLayout();
      } else {
        showConflict(col, row);
      }
      return;
    }

    // Clicking a different occupied cell → show conflict
    showConflict(col, row);
  }

  function showConflict(col: number, row: number): void {
    conflictCell = { col, row };
    render();

    if (conflictTimeout) {
      clearTimeout(conflictTimeout);
    }
    conflictTimeout = setTimeout(() => {
      conflictCell = null;
      conflictTimeout = null;
      render();
    }, 500);
  }

  async function persistLayout(): Promise<void> {
    const result = await saveConfig(bridge, STORAGE_KEYS.HUD_LAYOUT, grid);
    if (!result.success) {
      errorMessage = "Layout was not synced. Your changes are retained.";
      render();
    } else {
      errorMessage = null;
    }
  }

  function closeWidgetPicker(): void {
    if (pickerElement && pickerElement.parentNode) {
      pickerElement.parentNode.removeChild(pickerElement);
    }
    pickerElement = null;

    if (pickerOutsideClickHandler) {
      document.removeEventListener("click", pickerOutsideClickHandler, true);
      pickerOutsideClickHandler = null;
    }
    if (pickerEscapeHandler) {
      document.removeEventListener("keydown", pickerEscapeHandler);
      pickerEscapeHandler = null;
    }
  }

  function showWidgetPicker(
    col: number,
    row: number,
    anchorElement: HTMLElement,
  ): void {
    // Close any existing picker first
    closeWidgetPicker();

    const available = getAvailableWidgetsForCell(grid, col, row);

    const picker = document.createElement("div");
    picker.className = `${CSS_PREFIX}__picker`;

    // Position the picker near the anchor cell
    const anchorRect = anchorElement.getBoundingClientRect();
    picker.style.position = "absolute";
    picker.style.top = `${anchorRect.bottom + window.scrollY + 4}px`;
    picker.style.left = `${anchorRect.left + window.scrollX}px`;
    picker.style.zIndex = "1000";

    if (available.length === 0) {
      const msg = document.createElement("p");
      msg.className = `${CSS_PREFIX}__picker-empty`;
      msg.textContent = "No widgets fit in this space";
      picker.appendChild(msg);
    } else {
      const list = document.createElement("ul");
      list.className = `${CSS_PREFIX}__picker-list`;

      for (const widgetId of available) {
        const item = document.createElement("li");
        item.className = `${CSS_PREFIX}__picker-item`;

        const button = document.createElement("button");
        button.className = `${CSS_PREFIX}__picker-button`;
        button.textContent = widgetId;
        button.type = "button";
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          grid = placeWidget(grid, widgetId, col, row);
          closeWidgetPicker();
          render();
          persistLayout();
        });

        item.appendChild(button);
        list.appendChild(item);
      }

      picker.appendChild(list);
    }

    document.body.appendChild(picker);
    pickerElement = picker;

    // Dismiss on outside click (use capture to detect before other handlers)
    pickerOutsideClickHandler = (e: MouseEvent) => {
      if (pickerElement && !pickerElement.contains(e.target as Node)) {
        closeWidgetPicker();
      }
    };
    // Delay adding the listener so the current click event doesn't immediately close it
    setTimeout(() => {
      if (pickerOutsideClickHandler) {
        document.addEventListener("click", pickerOutsideClickHandler, true);
      }
    }, 0);

    // Dismiss on Escape key
    pickerEscapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeWidgetPicker();
      }
    };
    document.addEventListener("keydown", pickerEscapeHandler);
  }

  async function loadStoredLayout(): Promise<void> {
    const stored = await loadConfig<unknown>(
      bridge,
      STORAGE_KEYS.HUD_LAYOUT,
      grid,
    );
    grid = migrateOldGrid(stored);
    render();
  }

  return {
    mount(el: HTMLElement): void {
      container = el;
      loadStoredLayout();
    },

    unmount(): void {
      if (conflictTimeout) {
        clearTimeout(conflictTimeout);
        conflictTimeout = null;
      }
      clearLongPressTimer();
      closeWidgetPicker();
      if (container) {
        container.innerHTML = "";
      }
      container = null;
      selectedWidgetId = null;
      errorMessage = null;
      conflictCell = null;
    },

    getGrid(): HudGrid {
      return [...grid];
    },
  };
}
