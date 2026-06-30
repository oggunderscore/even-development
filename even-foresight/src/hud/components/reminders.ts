import type { HudComponent } from "../types";
import type { StorageManager } from "../../storage/storage-manager";
import type {
  Reminder,
  RemindersStore,
  ClockConfig,
} from "../../storage/schemas";
import {
  STORAGE_KEYS,
  DEFAULT_REMINDERS_STORE,
  DEFAULT_CLOCK_CONFIG,
} from "../../storage/schemas";
import { REMINDERS_MAX, REMINDER_TITLE_MAX_LENGTH } from "../../constants";

/**
 * Finds the nearest upcoming reminder (smallest targetTime > currentTime, not completed).
 */
export function findNearestUpcoming(
  reminders: Reminder[],
  currentTime: number,
): Reminder | null {
  let nearest: Reminder | null = null;

  for (const reminder of reminders) {
    if (reminder.completed) continue;
    if (reminder.targetTime <= currentTime) continue;

    if (nearest === null || reminder.targetTime < nearest.targetTime) {
      nearest = reminder;
    }
  }

  return nearest;
}

/**
 * Validates a reminder input: title length [1, 30] AND targetTime > currentTime.
 */
export function validateReminder(
  title: string,
  targetTime: number,
  currentTime: number,
): boolean {
  return (
    title.length >= 1 &&
    title.length <= REMINDER_TITLE_MAX_LENGTH &&
    targetTime > currentTime
  );
}

/**
 * Checks if a reminder should trigger: not completed AND currentTime >= targetTime.
 */
export function isReminderTriggered(
  reminder: Reminder,
  currentTime: number,
): boolean {
  return !reminder.completed && currentTime >= reminder.targetTime;
}

/**
 * Checks if another reminder can be added (below REMINDERS_MAX capacity).
 */
export function canAddReminder(reminders: Reminder[]): boolean {
  return reminders.length < REMINDERS_MAX;
}

/**
 * Deletes a reminder by id, returning a new array without the deleted item.
 */
export function deleteReminder(reminders: Reminder[], id: string): Reminder[] {
  return reminders.filter((r) => r.id !== id);
}

/**
 * Formats a Unix timestamp in the given clock format.
 */
export function formatReminderTime(
  targetTime: number,
  format: "12h" | "24h",
): string {
  const date = new Date(targetTime);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const mm = minutes.toString().padStart(2, "0");

  if (format === "24h") {
    const hh = hours.toString().padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // 12-hour format
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${h12}:${mm} ${period}`;
}

export type NotificationCallback = (title: string) => void;

/**
 * Reminders HUD component.
 * Displays the nearest upcoming reminder (title + time in Clock's format).
 * On refresh, checks for triggered reminders and fires a notification callback.
 */
export function createRemindersComponent(
  storage: StorageManager,
  onNotification?: NotificationCallback,
): HudComponent {
  let displayText = "No reminders";
  let unsubscribeReminders: (() => void) | null = null;
  let unsubscribeClock: (() => void) | null = null;

  function getClockFormat(): "12h" | "24h" {
    const config = storage.get<ClockConfig>(STORAGE_KEYS.CLOCK_CONFIG);
    return config?.format ?? DEFAULT_CLOCK_CONFIG.format;
  }

  function getRemindersStore(): RemindersStore {
    return (
      storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS) ??
      DEFAULT_REMINDERS_STORE
    );
  }

  async function checkAndTrigger(): Promise<void> {
    const store = getRemindersStore();
    const now = Date.now();
    let storeChanged = false;

    for (const reminder of store.reminders) {
      if (isReminderTriggered(reminder, now)) {
        // Trigger banner notification
        if (onNotification) {
          onNotification(reminder.title);
        }
        // Mark as completed
        reminder.completed = true;
        storeChanged = true;
      }
    }

    if (storeChanged) {
      await storage.set<RemindersStore>(STORAGE_KEYS.REMINDERS, store);
    }
  }

  function updateDisplay(): void {
    const store = getRemindersStore();
    const now = Date.now();
    const format = getClockFormat();
    const nearest = findNearestUpcoming(store.reminders, now);

    if (nearest) {
      const timeStr = formatReminderTime(nearest.targetTime, format);
      displayText = `${nearest.title} ${timeStr}`;
    } else {
      displayText = "No reminders";
    }
  }

  // Subscribe to storage changes
  unsubscribeReminders = storage.onChange(STORAGE_KEYS.REMINDERS, () => {
    updateDisplay();
  });
  unsubscribeClock = storage.onChange(STORAGE_KEYS.CLOCK_CONFIG, () => {
    updateDisplay();
  });

  // Initial display update
  updateDisplay();

  return {
    type: "reminders" as const,

    render(): string {
      return displayText;
    },

    async refresh(): Promise<void> {
      await checkAndTrigger();
      updateDisplay();
    },

    dispose(): void {
      if (unsubscribeReminders) {
        unsubscribeReminders();
        unsubscribeReminders = null;
      }
      if (unsubscribeClock) {
        unsubscribeClock();
        unsubscribeClock = null;
      }
    },
  };
}
