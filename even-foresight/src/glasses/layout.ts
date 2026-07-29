/**
 * Translation between the shapes the phone webapp persists and the shapes
 * the glasses runtime consumes. Kept pure so it is cheap to test.
 */

import type { StorageManager } from "../storage/storage-manager";
import { STORAGE_KEYS, type HudLayoutConfig } from "../storage/schemas";
import type { HudComponentType } from "../hud/types";
import { HUD_COLS, HUD_ROWS } from "../constants";

/** The webapp's on-disk grid format (`WidgetPlacement` in webapp/types). */
export type HudGridPlacement = { widgetId: string; col: number; row: number };

/** Widget ids the glasses can actually render. */
const RENDERABLE: ReadonlySet<string> = new Set<HudComponentType>([
  "clock",
  "weather",
  "reminders",
]);

/**
 * Converts the webapp's placement list into the slot config HudManager wants.
 *
 * Placements are dropped rather than clamped when they are unrenderable or
 * out of bounds: a widget silently relocating to a cell the user did not pick
 * is more confusing than one that does not appear.
 */
export function hudGridToLayoutConfig(
  grid: readonly HudGridPlacement[] | null | undefined,
): HudLayoutConfig {
  const slots: HudLayoutConfig["slots"] = [];
  if (!Array.isArray(grid)) return { slots };

  for (const placement of grid) {
    if (!placement || !RENDERABLE.has(placement.widgetId)) continue;

    const { row, col } = placement;
    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
    if (row < 0 || row >= HUD_ROWS || col < 0 || col >= HUD_COLS) continue;

    slots.push({
      row: row as 0 | 1,
      col: col as 0 | 1 | 2 | 3 | 4,
      componentType: placement.widgetId as HudComponentType,
    });
  }

  return { slots };
}

/** Legacy value kept so configs saved before the rename still parse. */
const LEGACY_SLEEP_MODE = "hidden";

/**
 * Reads the inactivity-timer settings.
 *
 * @returns milliseconds of inactivity before the HUD sleeps, or `null` for
 *          "never sleep".
 */
export function readSleepSettings(storage: StorageManager): number | null {
  const mode = storage.get<{ mode?: string }>(STORAGE_KEYS.HUD_SLEEP)?.mode;
  const sleeps = mode === "inactivity-timer" || mode === LEGACY_SLEEP_MODE;
  if (!sleeps) return null;

  const seconds = storage.get<{ displayDurationSeconds?: number }>(
    STORAGE_KEYS.HUD_SLEEP_DELAY,
  )?.displayDurationSeconds;

  // Fall back to 15s rather than to "never": the user explicitly asked for a
  // timer, so a missing or nonsensical delay should still sleep.
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return 15_000;
  }
  return Math.round(seconds) * 1000;
}
