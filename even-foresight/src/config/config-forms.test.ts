import { describe, it, expect, beforeEach } from "vitest";
import type { StorageManager } from "../storage/storage-manager";
import {
  validateWeatherRefreshInterval,
  validateReminderTitle,
  validateWeatherLocation,
  clampBannerDuration,
  ClockConfigForm,
  WeatherConfigForm,
  RemindersConfigForm,
  BannerConfigForm,
} from "./config-forms";

// --- Mock StorageManager ---

function createMockStorage(): StorageManager {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | null {
      return (store.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
    onChange(_key: string, _callback: (value: unknown) => void): () => void {
      return () => {};
    },
    async loadKey(_key: string): Promise<void> {},
    async loadKeys(_keys: string[]): Promise<void> {},
  };
}

// === Pure Validation Functions ===

describe("validateWeatherRefreshInterval", () => {
  it("accepts minimum value 15", () => {
    expect(validateWeatherRefreshInterval(15)).toBe(true);
  });

  it("accepts maximum value 120", () => {
    expect(validateWeatherRefreshInterval(120)).toBe(true);
  });

  it("accepts value in range", () => {
    expect(validateWeatherRefreshInterval(60)).toBe(true);
  });

  it("rejects value below minimum", () => {
    expect(validateWeatherRefreshInterval(14)).toBe(false);
  });

  it("rejects value above maximum", () => {
    expect(validateWeatherRefreshInterval(121)).toBe(false);
  });

  it("rejects zero", () => {
    expect(validateWeatherRefreshInterval(0)).toBe(false);
  });

  it("rejects negative", () => {
    expect(validateWeatherRefreshInterval(-5)).toBe(false);
  });
});

describe("validateReminderTitle", () => {
  it("accepts single character", () => {
    expect(validateReminderTitle("A")).toBe(true);
  });

  it("accepts exactly 30 characters", () => {
    expect(validateReminderTitle("A".repeat(30))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateReminderTitle("")).toBe(false);
  });

  it("rejects 31 characters", () => {
    expect(validateReminderTitle("A".repeat(31))).toBe(false);
  });
});

describe("validateWeatherLocation", () => {
  it("accepts single character", () => {
    expect(validateWeatherLocation("X")).toBe(true);
  });

  it("accepts exactly 50 characters", () => {
    expect(validateWeatherLocation("A".repeat(50))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateWeatherLocation("")).toBe(false);
  });

  it("rejects 51 characters", () => {
    expect(validateWeatherLocation("A".repeat(51))).toBe(false);
  });
});

describe("clampBannerDuration", () => {
  it("returns value when within range", () => {
    expect(clampBannerDuration(10)).toBe(10);
  });

  it("clamps to minimum 3", () => {
    expect(clampBannerDuration(1)).toBe(3);
  });

  it("clamps to maximum 15", () => {
    expect(clampBannerDuration(20)).toBe(15);
  });

  it("returns 3 for zero", () => {
    expect(clampBannerDuration(0)).toBe(3);
  });

  it("returns 3 for negative", () => {
    expect(clampBannerDuration(-10)).toBe(3);
  });

  it("returns exact boundary min", () => {
    expect(clampBannerDuration(3)).toBe(3);
  });

  it("returns exact boundary max", () => {
    expect(clampBannerDuration(15)).toBe(15);
  });
});

// === ClockConfigForm ===

describe("ClockConfigForm", () => {
  let storage: StorageManager;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it("defaults to 12h format when no config exists", () => {
    const form = new ClockConfigForm(storage);
    expect(form.getFormat()).toBe("12h");
  });

  it("saves and loads 24h format", async () => {
    const form = new ClockConfigForm(storage);
    await form.setFormat("24h");

    // Create a new form from same storage to verify persistence
    const form2 = new ClockConfigForm(storage);
    expect(form2.getFormat()).toBe("24h");
  });

  it("saves and loads 12h format", async () => {
    const form = new ClockConfigForm(storage);
    await form.setFormat("24h");
    await form.setFormat("12h");

    const form2 = new ClockConfigForm(storage);
    expect(form2.getFormat()).toBe("12h");
  });
});

// === WeatherConfigForm ===

describe("WeatherConfigForm", () => {
  let storage: StorageManager;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it("defaults to fahrenheit, null location, 30 min interval", () => {
    const form = new WeatherConfigForm(storage);
    const config = form.getConfig();
    expect(config.unit).toBe("fahrenheit");
    expect(config.location).toBeNull();
    expect(config.refreshIntervalMinutes).toBe(30);
  });

  it("validates and saves a valid location", async () => {
    const form = new WeatherConfigForm(storage);
    const result = await form.setLocation("New York");
    expect(result.success).toBe(true);

    const form2 = new WeatherConfigForm(storage);
    expect(form2.getConfig().location).toBe("New York");
  });

  it("rejects empty location with field error", async () => {
    const form = new WeatherConfigForm(storage);
    const result = await form.setLocation("");
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.location).toBeDefined();
  });

  it("rejects location exceeding 50 chars", async () => {
    const form = new WeatherConfigForm(storage);
    const result = await form.setLocation("A".repeat(51));
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.location).toBeDefined();
  });

  it("saves valid refresh interval", async () => {
    const form = new WeatherConfigForm(storage);
    const result = await form.setRefreshInterval(60);
    expect(result.success).toBe(true);

    const form2 = new WeatherConfigForm(storage);
    expect(form2.getConfig().refreshIntervalMinutes).toBe(60);
  });

  it("rejects interval below 15 with field error", async () => {
    const form = new WeatherConfigForm(storage);
    const result = await form.setRefreshInterval(10);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.refreshInterval).toBeDefined();
  });

  it("rejects interval above 120 with field error", async () => {
    const form = new WeatherConfigForm(storage);
    const result = await form.setRefreshInterval(200);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.refreshInterval).toBeDefined();
  });

  it("does not persist invalid location", async () => {
    const form = new WeatherConfigForm(storage);
    await form.setLocation("Portland");
    await form.setLocation(""); // invalid — should not persist

    const form2 = new WeatherConfigForm(storage);
    expect(form2.getConfig().location).toBe("Portland");
  });

  it("saves unit change", async () => {
    const form = new WeatherConfigForm(storage);
    await form.setUnit("celsius");

    const form2 = new WeatherConfigForm(storage);
    expect(form2.getConfig().unit).toBe("celsius");
  });
});

// === RemindersConfigForm ===

describe("RemindersConfigForm", () => {
  let storage: StorageManager;
  const now = 1700000000000;
  const futureTime = now + 60000;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it("starts with empty reminders", () => {
    const form = new RemindersConfigForm(storage);
    expect(form.getReminders()).toEqual([]);
  });

  it("adds a valid reminder", async () => {
    const form = new RemindersConfigForm(storage);
    const result = await form.addReminder("Buy milk", futureTime, now);
    expect(result.success).toBe(true);
    expect(result.value?.title).toBe("Buy milk");
    expect(result.value?.targetTime).toBe(futureTime);
    expect(result.value?.completed).toBe(false);
    expect(form.getReminders()).toHaveLength(1);
  });

  it("rejects empty title", async () => {
    const form = new RemindersConfigForm(storage);
    const result = await form.addReminder("", futureTime, now);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.title).toBeDefined();
  });

  it("rejects title exceeding 30 chars", async () => {
    const form = new RemindersConfigForm(storage);
    const result = await form.addReminder("A".repeat(31), futureTime, now);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.title).toBeDefined();
  });

  it("rejects past target time", async () => {
    const form = new RemindersConfigForm(storage);
    const result = await form.addReminder("Task", now - 1000, now);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.targetTime).toBeDefined();
  });

  it("rejects target time equal to current time", async () => {
    const form = new RemindersConfigForm(storage);
    const result = await form.addReminder("Task", now, now);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.targetTime).toBeDefined();
  });

  it("deletes a reminder by id", async () => {
    const form = new RemindersConfigForm(storage);
    const addResult = await form.addReminder("Task 1", futureTime, now);
    const id = addResult.value!.id;

    const deleteResult = await form.deleteReminder(id);
    expect(deleteResult.success).toBe(true);
    expect(form.getReminders()).toHaveLength(0);
  });

  it("returns error when deleting non-existent reminder", async () => {
    const form = new RemindersConfigForm(storage);
    const result = await form.deleteReminder("non-existent-id");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("enforces maximum of 20 reminders", async () => {
    const form = new RemindersConfigForm(storage);

    // Add 20 reminders
    for (let i = 0; i < 20; i++) {
      const result = await form.addReminder(`Task ${i}`, futureTime + i, now);
      expect(result.success).toBe(true);
    }

    // 21st should fail
    const result = await form.addReminder("Task 20", futureTime + 20, now);
    expect(result.success).toBe(false);
    expect(result.error).toContain("20");
    expect(form.getReminders()).toHaveLength(20);
  });

  it("persists reminders across form instances", async () => {
    const form = new RemindersConfigForm(storage);
    await form.addReminder("Persisted task", futureTime, now);

    const form2 = new RemindersConfigForm(storage);
    expect(form2.getReminders()).toHaveLength(1);
    expect(form2.getReminders()[0].title).toBe("Persisted task");
  });
});

// === BannerConfigForm ===

describe("BannerConfigForm", () => {
  let storage: StorageManager;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it("defaults to 5 seconds duration", () => {
    const form = new BannerConfigForm(storage);
    expect(form.getDuration()).toBe(5);
  });

  it("saves a valid duration", async () => {
    const form = new BannerConfigForm(storage);
    await form.setDuration(10);

    const form2 = new BannerConfigForm(storage);
    expect(form2.getDuration()).toBe(10);
  });

  it("clamps duration below minimum to 3", async () => {
    const form = new BannerConfigForm(storage);
    await form.setDuration(1);
    expect(form.getDuration()).toBe(3);
  });

  it("clamps duration above maximum to 15", async () => {
    const form = new BannerConfigForm(storage);
    await form.setDuration(30);
    expect(form.getDuration()).toBe(15);
  });

  it("persists clamped value", async () => {
    const form = new BannerConfigForm(storage);
    await form.setDuration(0);

    const form2 = new BannerConfigForm(storage);
    expect(form2.getDuration()).toBe(3);
  });
});
