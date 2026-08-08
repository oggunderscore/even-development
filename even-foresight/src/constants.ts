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
 * G2 allows 8 non-image containers per page; this uses all 8.
 */
export const CONTAINER = {
  /** HUD columns 0-4 occupy IDs 0-4. */
  HUD_COL_BASE: 0,
  /** App launcher menu. */
  MENU: 5,
  /** Notification banner. Declared last so it draws on top. */
  BANNER: 6,
  /**
   * The surface an activated `SubApp` draws into (`SubAppContainer`).
   *
   * Deliberately NOT shared with `MENU`: the notification system blanks the
   * menu container when it returns to its idle phase, which would silently
   * erase an active sub-app's view if the two shared an ID. It overlaps the
   * menu region instead, and is declared after it so it draws on top — the
   * two are never non-empty at the same time, since `MenuSystem.select()`
   * hides the menu before activating the entry.
   */
  SUBAPP: 7,
} as const;

export const HOME_CONTAINER_COUNT = 8;

/** containerName values must be unique and <= 16 characters. */
export const CONTAINER_NAME = {
  hudCol: (col: number) => `hud-col-${col}`,
  MENU: "menu",
  BANNER: "banner",
  SUBAPP: "subapp",
} as const;

// === Sub-App Surface ===
// The fixed region an activated SubApp owns, matching the literal types on
// `SubAppContext` (`src/sub-app/types.ts`).
export const SUBAPP_WIDTH = 576;
export const SUBAPP_HEIGHT = 173;
export const SUBAPP_Y_OFFSET = 115; // 115 + 173 = 288 (exactly full height)

/**
 * How many containers `SubAppContext.requestContainers()` can hand out. Only
 * one is allocated (`CONTAINER.SUBAPP`); requests beyond it are dropped
 * rather than returning IDs for containers that do not exist.
 */
export const SUBAPP_CONTAINER_COUNT = 1;

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
/**
 * Widened from 30s after reports of the menu apparently closing itself
 * mid-navigation on real hardware, with the next swipe then landing on
 * whatever the bare-HUD gesture does instead (e.g. opening the
 * Notification_Center instead of continuing to scroll the menu). Every
 * *accepted* scroll already calls `resetTimeout()`
 * (`menu-system.ts#moveDown/moveUp`), so this should only ever fire on
 * genuine idle time — but real BLE + touchpad pacing is slower and jumpier
 * than the simulator's instant event dispatch, so a wearer deliberating
 * over a longer list has more real seconds go by between accepted scrolls
 * than the same interaction would take in the simulator. Unverified
 * against real hardware; this is a defensive widening, not a confirmed root
 * cause. `menu-system.ts`'s own auto-hide timeout closes the menu silently
 * (it calls `hide()` directly, not through `home-screen.ts`'s `log(...)`
 * calls) — so on the debug log panel (`main.ts`/`debug-log.ts`), the
 * fingerprint of this happening is a gesture like "SWIPE DOWN" being
 * followed by "NOTIFICATION CENTER: OPEN" with no "MENU: CLOSE" in between,
 * meaning the menu was already gone before that swipe arrived.
 */
export const MENU_TIMEOUT_MS = 60_000;
export const WEATHER_MIN_INTERVAL_MIN = 15;
export const WEATHER_MAX_INTERVAL_MIN = 120;
export const WEATHER_DEFAULT_INTERVAL_MIN = 30;
export const WEATHER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// === Input ===
export const DOUBLE_TAP_MIN_MS = 200;
/**
 * Max widened from 800 after reports that double-tap (menu open/close,
 * notification dismiss) worked in the simulator but not reliably on real
 * hardware. The firmware doesn't reliably emit its own DOUBLE_CLICK_EVENT
 * (see `input-router.ts`), so most real double-taps depend entirely on this
 * software window; real BLE + touchpad round-trip latency plausibly pushes
 * the gap between two physical taps past 800ms more often than a desktop
 * simulator tab ever would. Only the max moved — `handleTap()` always
 * waits the *entire* configured window before delivering a single tap
 * (there's no early-exit once a second tap can no longer arrive), so
 * raising the *default* directly adds that much perceived latency to every
 * single tap. Leaving the default at 400 keeps single-tap responsive out of
 * the box; a wearer whose double-taps aren't registering can raise it
 * themselves via Settings → Input, up to this new ceiling. Unverified
 * against real hardware either way — if double-tap is still unreliable,
 * check the phone's diagnostic log panel (`#input-debug-log`, wired in
 * `main.ts`) for "TAP" vs "DOUBLE TAP (sw/hw)" vs "EVENT (unrecognised)" to
 * see what is actually being classified.
 */
export const DOUBLE_TAP_MAX_MS = 1200;
export const DOUBLE_TAP_DEFAULT_MS = 400;

// === Reminders ===
export const REMINDERS_MAX = 20;
export const REMINDER_TITLE_MAX_LENGTH = 30;
/**
 * How long a just-completed reminder stays in the Reminders list — struck
 * through and tappable to undo — before it is deleted for good.
 */
export const REMINDER_UNDO_WINDOW_MS = 5_000;

// === SmarterEveryday Scheduler ===
/** Matches HUD_REFRESH_INTERVAL_MS's granularity — Notification_Interval
 *  values are always whole minutes, so per-minute tick resolution suffices. */
export const SCHEDULER_TICK_INTERVAL_MS = 60_000;

// === Weather Location ===
export const WEATHER_LOCATION_MAX_LENGTH = 50;
