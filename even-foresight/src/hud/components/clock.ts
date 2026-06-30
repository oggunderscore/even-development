import type { HudComponent } from "../types";
import type { StorageManager } from "../../storage/storage-manager";
import type { ClockConfig } from "../../storage/schemas";
import { STORAGE_KEYS, DEFAULT_CLOCK_CONFIG } from "../../storage/schemas";

const PLACEHOLDER = "--:--";

/**
 * Pure formatting function for time values.
 * Exported separately for property-based testing.
 *
 * @param hours - Hour value (0-23)
 * @param minutes - Minute value (0-59)
 * @param format - "12h" or "24h"
 * @returns Formatted time string
 */
export function formatTime(
  hours: number,
  minutes: number,
  format: "12h" | "24h",
): string {
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return PLACEHOLDER;
  }

  const mm = String(minutes).padStart(2, "0");

  if (format === "24h") {
    const HH = String(hours).padStart(2, "0");
    return `${HH}:${mm}`;
  }

  // 12h format
  const period = hours < 12 ? "AM" : "PM";
  let h = hours % 12;
  if (h === 0) h = 12;
  return `${h}:${mm} ${period}`;
}

/**
 * Clock HUD component that displays the current time
 * in either 12h or 24h format based on user configuration.
 */
export function createClockComponent(storage: StorageManager): HudComponent {
  let currentFormat: "12h" | "24h" = DEFAULT_CLOCK_CONFIG.format;
  let unsubscribe: (() => void) | null = null;

  // Read initial config
  const config = storage.get<ClockConfig>(STORAGE_KEYS.CLOCK_CONFIG);
  if (config && (config.format === "12h" || config.format === "24h")) {
    currentFormat = config.format;
  }

  // Listen for config changes
  unsubscribe = storage.onChange(STORAGE_KEYS.CLOCK_CONFIG, (value) => {
    const updated = value as ClockConfig | null;
    if (updated && (updated.format === "12h" || updated.format === "24h")) {
      currentFormat = updated.format;
    } else {
      currentFormat = DEFAULT_CLOCK_CONFIG.format;
    }
  });

  const component: HudComponent = {
    type: "clock",

    render(): string {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // Check for invalid system clock (NaN date)
      if (isNaN(hours) || isNaN(minutes)) {
        return PLACEHOLDER;
      }

      return formatTime(hours, minutes, currentFormat);
    },

    async refresh(): Promise<void> {
      // Re-read config from storage on each refresh (format may have changed)
      const config = storage.get<ClockConfig>(STORAGE_KEYS.CLOCK_CONFIG);
      if (config && (config.format === "12h" || config.format === "24h")) {
        currentFormat = config.format;
      } else {
        currentFormat = DEFAULT_CLOCK_CONFIG.format;
      }
    },

    dispose(): void {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  };

  return component;
}
