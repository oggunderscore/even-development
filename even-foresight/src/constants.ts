// === G2 Display ===
export const DISPLAY_WIDTH = 576;
export const DISPLAY_HEIGHT = 288;

// === HUD Region ===
// The HUD occupies the top band of the display as 5 side-by-side text
// containers, one per column. Each container renders its row-0 content on
// line 1 and its row-1 content on line 2, which is how the 2x5 logical grid
// maps onto 5 physical containers.
export const HUD_COLS = 5;
export const HUD_ROWS = 2;
export const HUD_SLOT_WIDTH = 115; // 576 / 5 = 115.2, floored to 115

/** LVGL renders every line at a fixed 27px. */
export const TEXT_LINE_HEIGHT = 27;

/**
 * Exactly two lines tall — one per grid row.
 *
 * Sizing this to a whole number of lines is what keeps the grid honest: a
 * taller container lets row 0 wrap onto a third line and shove row 1 out of
 * position, so slot content is truncated to one line (see `fitToColumn`) and
 * the container is sized to match.
 */
export const HUD_HEIGHT = HUD_ROWS * TEXT_LINE_HEIGHT; // 54
export const HUD_Y = 0;

// === Overlay Region (menu / banner) ===
// Sits below the HUD band so a visible menu never overlaps HUD content.
export const OVERLAY_Y = 64;
export const OVERLAY_HEIGHT = 224; // 64 + 224 = 288 (exactly full height)
export const OVERLAY_WIDTH = 576;

/**
 * Fixed container-ID allocation for the home page.
 *
 * The page is built ONCE by `rebuildPageContainer` when the home screen
 * starts, and every later update is an in-place `textContainerUpgrade`.
 * Rebuilding replaces the whole page and destroys every container, so no
 * subsystem may rebuild on its own — that is what previously wiped the HUD
 * the first time the menu was opened.
 *
 * G2 allows 8 non-image containers per page; this uses 7.
 */
export const CONTAINER = {
  /** HUD columns 0-4 occupy IDs 0-4. */
  HUD_COL_BASE: 0,
  /** App launcher menu. */
  MENU: 5,
  /** Notification banner. Declared last so it draws on top. */
  BANNER: 6,
} as const;

export const HOME_CONTAINER_COUNT = 7;

/** containerName values must be unique and <= 16 characters. */
export const CONTAINER_NAME = {
  hudCol: (col: number) => `hud-col-${col}`,
  MENU: "menu",
  BANNER: "banner",
} as const;

// === Menu ===
export const MENU_MAX_ENTRIES = 10;
export const MENU_ENTRY_TRUNCATE = 20;

// === Banner ===
export const BANNER_DEFAULT_DURATION_S = 5;
export const BANNER_MIN_DURATION_S = 3;
export const BANNER_MAX_DURATION_S = 15;
export const BANNER_MAX_TEXT_LENGTH = 50;
export const BANNER_QUEUE_MAX = 5;

// === Timing ===
export const HUD_REFRESH_INTERVAL_MS = 60_000;
export const SCROLL_DEBOUNCE_MS = 300;
export const MENU_TIMEOUT_MS = 30_000;
export const WEATHER_MIN_INTERVAL_MIN = 15;
export const WEATHER_MAX_INTERVAL_MIN = 120;
export const WEATHER_DEFAULT_INTERVAL_MIN = 30;
export const WEATHER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// === Input ===
export const DOUBLE_TAP_MIN_MS = 200;
export const DOUBLE_TAP_MAX_MS = 800;
export const DOUBLE_TAP_DEFAULT_MS = 400;

// === Reminders ===
export const REMINDERS_MAX = 20;
export const REMINDER_TITLE_MAX_LENGTH = 30;

// === Weather Location ===
export const WEATHER_LOCATION_MAX_LENGTH = 50;
