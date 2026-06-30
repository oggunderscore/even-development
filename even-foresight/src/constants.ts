// === G2 Display ===
export const DISPLAY_WIDTH = 576;
export const DISPLAY_HEIGHT = 288;

// === HUD Region ===
export const HUD_HEIGHT = 115; // 2 rows × 57px + 1px gap
export const HUD_ROW_HEIGHT = 57;
export const HUD_ROW_GAP = 1;
export const HUD_SLOT_WIDTH = 115; // 576 / 5 = 115.2, rounded to 115
export const HUD_COLS = 5;
export const HUD_ROWS = 2;

// === Sub-App Region ===
export const SUBAPP_Y_OFFSET = 115;
export const SUBAPP_HEIGHT = 173; // 288 - 115
export const SUBAPP_WIDTH = 576;

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

// === Reminders ===
export const REMINDERS_MAX = 20;
export const REMINDER_TITLE_MAX_LENGTH = 30;

// === Weather Location ===
export const WEATHER_LOCATION_MAX_LENGTH = 50;
