import { describe, it, expect, vi } from "vitest";
import {
  findNearestUpcoming,
  validateReminder,
  isReminderTriggered,
  canAddReminder,
  deleteReminder,
  formatReminderTime,
  createRemindersComponent,
} from "./reminders";
import type { Reminder } from "../../storage/schemas";
import { REMINDERS_MAX } from "../../constants";

describe("findNearestUpcoming", () => {
  const now = 1000;

  it("returns null for empty reminders list", () => {
    expect(findNearestUpcoming([], now)).toBeNull();
  });

  it("returns null when all reminders are in the past", () => {
    const reminders: Reminder[] = [
      { id: "1", title: "Past", targetTime: 500, completed: false },
      { id: "2", title: "Also past", targetTime: 900, completed: false },
    ];
    expect(findNearestUpcoming(reminders, now)).toBeNull();
  });

  it("returns null when all reminders are completed", () => {
    const reminders: Reminder[] = [
      { id: "1", title: "Done", targetTime: 2000, completed: true },
      { id: "2", title: "Also done", targetTime: 3000, completed: true },
    ];
    expect(findNearestUpcoming(reminders, now)).toBeNull();
  });

  it("returns the nearest upcoming reminder", () => {
    const reminders: Reminder[] = [
      { id: "1", title: "Far", targetTime: 5000, completed: false },
      { id: "2", title: "Near", targetTime: 1500, completed: false },
      { id: "3", title: "Medium", targetTime: 3000, completed: false },
    ];
    const result = findNearestUpcoming(reminders, now);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("2");
    expect(result!.title).toBe("Near");
  });

  it("skips completed reminders even if they are nearest", () => {
    const reminders: Reminder[] = [
      { id: "1", title: "Nearest but done", targetTime: 1100, completed: true },
      { id: "2", title: "Next up", targetTime: 2000, completed: false },
    ];
    const result = findNearestUpcoming(reminders, now);
    expect(result!.id).toBe("2");
  });

  it("ignores reminders at exactly currentTime (not strictly greater)", () => {
    const reminders: Reminder[] = [
      { id: "1", title: "Exact", targetTime: 1000, completed: false },
      { id: "2", title: "Future", targetTime: 2000, completed: false },
    ];
    const result = findNearestUpcoming(reminders, now);
    expect(result!.id).toBe("2");
  });
});

describe("validateReminder", () => {
  const now = 1000;

  it("returns true for valid title and future time", () => {
    expect(validateReminder("Buy milk", 2000, now)).toBe(true);
  });

  it("returns true for title at exactly 30 characters", () => {
    const title = "a".repeat(30);
    expect(validateReminder(title, 2000, now)).toBe(true);
  });

  it("returns true for title at exactly 1 character", () => {
    expect(validateReminder("X", 2000, now)).toBe(true);
  });

  it("returns false for empty title", () => {
    expect(validateReminder("", 2000, now)).toBe(false);
  });

  it("returns false for title exceeding 30 characters", () => {
    const title = "a".repeat(31);
    expect(validateReminder(title, 2000, now)).toBe(false);
  });

  it("returns false when targetTime equals currentTime", () => {
    expect(validateReminder("Test", 1000, now)).toBe(false);
  });

  it("returns false when targetTime is in the past", () => {
    expect(validateReminder("Test", 500, now)).toBe(false);
  });
});

describe("isReminderTriggered", () => {
  it("returns true when currentTime >= targetTime and not completed", () => {
    const reminder: Reminder = {
      id: "1",
      title: "Go",
      targetTime: 1000,
      completed: false,
    };
    expect(isReminderTriggered(reminder, 1000)).toBe(true);
    expect(isReminderTriggered(reminder, 1500)).toBe(true);
  });

  it("returns false when reminder is completed", () => {
    const reminder: Reminder = {
      id: "1",
      title: "Done",
      targetTime: 1000,
      completed: true,
    };
    expect(isReminderTriggered(reminder, 1500)).toBe(false);
  });

  it("returns false when currentTime < targetTime", () => {
    const reminder: Reminder = {
      id: "1",
      title: "Future",
      targetTime: 2000,
      completed: false,
    };
    expect(isReminderTriggered(reminder, 1000)).toBe(false);
  });
});

describe("canAddReminder", () => {
  it("returns true when list has fewer than 20 reminders", () => {
    const reminders: Reminder[] = Array.from({ length: 19 }, (_, i) => ({
      id: String(i),
      title: `R${i}`,
      targetTime: 1000 + i,
      completed: false,
    }));
    expect(canAddReminder(reminders)).toBe(true);
  });

  it("returns true for empty list", () => {
    expect(canAddReminder([])).toBe(true);
  });

  it("returns false when list has exactly 20 reminders", () => {
    const reminders: Reminder[] = Array.from(
      { length: REMINDERS_MAX },
      (_, i) => ({
        id: String(i),
        title: `R${i}`,
        targetTime: 1000 + i,
        completed: false,
      }),
    );
    expect(canAddReminder(reminders)).toBe(false);
  });
});

describe("deleteReminder", () => {
  it("removes the reminder with the given id", () => {
    const reminders: Reminder[] = [
      { id: "a", title: "A", targetTime: 1000, completed: false },
      { id: "b", title: "B", targetTime: 2000, completed: false },
      { id: "c", title: "C", targetTime: 3000, completed: false },
    ];
    const result = deleteReminder(reminders, "b");
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.id === "b")).toBeUndefined();
  });

  it("preserves other reminders unchanged", () => {
    const reminders: Reminder[] = [
      { id: "a", title: "A", targetTime: 1000, completed: false },
      { id: "b", title: "B", targetTime: 2000, completed: false },
    ];
    const result = deleteReminder(reminders, "a");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "b",
      title: "B",
      targetTime: 2000,
      completed: false,
    });
  });

  it("returns the same array contents when id not found", () => {
    const reminders: Reminder[] = [
      { id: "a", title: "A", targetTime: 1000, completed: false },
    ];
    const result = deleteReminder(reminders, "nonexistent");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("returns a new array (does not mutate original)", () => {
    const reminders: Reminder[] = [
      { id: "a", title: "A", targetTime: 1000, completed: false },
    ];
    const result = deleteReminder(reminders, "a");
    expect(result).not.toBe(reminders);
    expect(reminders).toHaveLength(1);
  });
});

describe("formatReminderTime", () => {
  it("formats in 12h format correctly (AM)", () => {
    // 9:05 AM — Jan 1, 2024 09:05:00 UTC
    const time = new Date(2024, 0, 1, 9, 5).getTime();
    expect(formatReminderTime(time, "12h")).toBe("9:05 AM");
  });

  it("formats in 12h format correctly (PM)", () => {
    // 2:30 PM
    const time = new Date(2024, 0, 1, 14, 30).getTime();
    expect(formatReminderTime(time, "12h")).toBe("2:30 PM");
  });

  it("formats 12:00 noon as 12:00 PM", () => {
    const time = new Date(2024, 0, 1, 12, 0).getTime();
    expect(formatReminderTime(time, "12h")).toBe("12:00 PM");
  });

  it("formats midnight as 12:00 AM in 12h format", () => {
    const time = new Date(2024, 0, 1, 0, 0).getTime();
    expect(formatReminderTime(time, "12h")).toBe("12:00 AM");
  });

  it("formats in 24h format correctly", () => {
    const time = new Date(2024, 0, 1, 14, 30).getTime();
    expect(formatReminderTime(time, "24h")).toBe("14:30");
  });

  it("formats midnight as 00:00 in 24h format", () => {
    const time = new Date(2024, 0, 1, 0, 0).getTime();
    expect(formatReminderTime(time, "24h")).toBe("00:00");
  });

  it("zero-pads minutes", () => {
    const time = new Date(2024, 0, 1, 8, 3).getTime();
    expect(formatReminderTime(time, "12h")).toBe("8:03 AM");
    expect(formatReminderTime(time, "24h")).toBe("08:03");
  });
});

describe("createRemindersComponent", () => {
  function createMockStorage() {
    const data = new Map<string, unknown>();
    const listeners = new Map<string, Set<(value: unknown) => void>>();

    return {
      get<T>(key: string): T | null {
        return (data.get(key) as T) ?? null;
      },
      async set<T>(key: string, value: T): Promise<void> {
        data.set(key, value);
        const keyListeners = listeners.get(key);
        if (keyListeners) {
          for (const cb of keyListeners) cb(value);
        }
      },
      async remove(key: string): Promise<void> {
        data.delete(key);
      },
      onChange(key: string, callback: (value: unknown) => void): () => void {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key)!.add(callback);
        return () => {
          listeners.get(key)!.delete(callback);
        };
      },
      async loadKey(_key: string): Promise<void> {},
      async loadKeys(_keys: string[]): Promise<void> {},
      _setRaw<T>(key: string, value: T) {
        data.set(key, value);
      },
    };
  }

  it("renders 'No reminders' when store is empty", () => {
    const storage = createMockStorage();
    const component = createRemindersComponent(storage);
    expect(component.render()).toBe("No reminders");
    component.dispose();
  });

  it("renders nearest upcoming reminder with title and time", () => {
    const storage = createMockStorage();
    const futureTime = new Date(2024, 5, 15, 10, 30).getTime();
    storage._setRaw("foresight-reminders-v1", {
      reminders: [
        { id: "1", title: "Meeting", targetTime: futureTime, completed: false },
      ],
    });

    // Mock Date.now to be before the reminder
    const originalNow = Date.now;
    Date.now = () => futureTime - 60000;

    const component = createRemindersComponent(storage);
    const rendered = component.render();
    expect(rendered).toContain("Meeting");
    expect(rendered).toContain("10:30 AM");

    Date.now = originalNow;
    component.dispose();
  });

  it("triggers notification callback on refresh when reminder time reached", async () => {
    const storage = createMockStorage();
    const notifCallback = vi.fn();
    const targetTime = 1000;

    storage._setRaw("foresight-reminders-v1", {
      reminders: [{ id: "1", title: "Alert", targetTime, completed: false }],
    });

    const originalNow = Date.now;
    Date.now = () => 1500; // past the target time

    const component = createRemindersComponent(storage, notifCallback);
    await component.refresh();

    expect(notifCallback).toHaveBeenCalledWith("Alert");

    Date.now = originalNow;
    component.dispose();
  });

  it("marks reminder as completed after triggering", async () => {
    const storage = createMockStorage();
    const targetTime = 1000;

    storage._setRaw("foresight-reminders-v1", {
      reminders: [{ id: "1", title: "Alert", targetTime, completed: false }],
    });

    const originalNow = Date.now;
    Date.now = () => 1500;

    const component = createRemindersComponent(storage, vi.fn());
    await component.refresh();

    const store = storage.get<{ reminders: Reminder[] }>(
      "foresight-reminders-v1",
    );
    expect(store!.reminders[0].completed).toBe(true);

    Date.now = originalNow;
    component.dispose();
  });

  it("uses 24h format when clock config is set to 24h", () => {
    const storage = createMockStorage();
    const futureTime = new Date(2024, 5, 15, 14, 45).getTime();

    storage._setRaw("foresight-clock-config-v1", { format: "24h" });
    storage._setRaw("foresight-reminders-v1", {
      reminders: [
        { id: "1", title: "Call", targetTime: futureTime, completed: false },
      ],
    });

    const originalNow = Date.now;
    Date.now = () => futureTime - 60000;

    const component = createRemindersComponent(storage);
    const rendered = component.render();
    expect(rendered).toContain("Call");
    expect(rendered).toContain("14:45");

    Date.now = originalNow;
    component.dispose();
  });

  it("has type 'reminders'", () => {
    const storage = createMockStorage();
    const component = createRemindersComponent(storage);
    expect(component.type).toBe("reminders");
    component.dispose();
  });

  it("disposes without error", () => {
    const storage = createMockStorage();
    const component = createRemindersComponent(storage);
    expect(() => component.dispose()).not.toThrow();
  });
});
