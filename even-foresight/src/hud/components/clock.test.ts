import { describe, it, expect } from "vitest";
import { formatTime, createClockComponent } from "./clock";
import type { StorageManager } from "../../storage/storage-manager";
import { STORAGE_KEYS } from "../../storage/schemas";

// --- Pure formatTime tests ---

describe("formatTime", () => {
  describe("12h format", () => {
    it("formats midnight as 12:00 AM", () => {
      expect(formatTime(0, 0, "12h")).toBe("12:00 AM");
    });

    it("formats noon as 12:00 PM", () => {
      expect(formatTime(12, 0, "12h")).toBe("12:00 PM");
    });

    it("formats 1:05 AM correctly", () => {
      expect(formatTime(1, 5, "12h")).toBe("1:05 AM");
    });

    it("formats 11:59 AM correctly", () => {
      expect(formatTime(11, 59, "12h")).toBe("11:59 AM");
    });

    it("formats 1:00 PM correctly (13:00)", () => {
      expect(formatTime(13, 0, "12h")).toBe("1:00 PM");
    });

    it("formats 11:59 PM correctly (23:59)", () => {
      expect(formatTime(23, 59, "12h")).toBe("11:59 PM");
    });

    it("zero-pads minutes", () => {
      expect(formatTime(3, 7, "12h")).toBe("3:07 AM");
    });
  });

  describe("24h format", () => {
    it("formats midnight as 00:00", () => {
      expect(formatTime(0, 0, "24h")).toBe("00:00");
    });

    it("formats noon as 12:00", () => {
      expect(formatTime(12, 0, "24h")).toBe("12:00");
    });

    it("formats 23:59 correctly", () => {
      expect(formatTime(23, 59, "24h")).toBe("23:59");
    });

    it("zero-pads single-digit hours", () => {
      expect(formatTime(5, 30, "24h")).toBe("05:30");
    });

    it("zero-pads single-digit minutes", () => {
      expect(formatTime(14, 3, "24h")).toBe("14:03");
    });
  });

  describe("invalid inputs", () => {
    it("returns placeholder for NaN hours", () => {
      expect(formatTime(NaN, 30, "12h")).toBe("--:--");
    });

    it("returns placeholder for NaN minutes", () => {
      expect(formatTime(10, NaN, "24h")).toBe("--:--");
    });

    it("returns placeholder for negative hours", () => {
      expect(formatTime(-1, 0, "12h")).toBe("--:--");
    });

    it("returns placeholder for hours > 23", () => {
      expect(formatTime(24, 0, "24h")).toBe("--:--");
    });

    it("returns placeholder for minutes > 59", () => {
      expect(formatTime(10, 60, "12h")).toBe("--:--");
    });

    it("returns placeholder for Infinity", () => {
      expect(formatTime(Infinity, 0, "12h")).toBe("--:--");
    });
  });
});

// --- Clock component integration tests ---

function createMockStorage(
  config: Record<string, unknown> = {},
): StorageManager {
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  return {
    get<T>(key: string): T | null {
      return (config[key] as T) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      config[key] = value;
      const keyListeners = listeners.get(key);
      if (keyListeners) {
        for (const cb of keyListeners) {
          cb(value);
        }
      }
    },
    async remove(key: string): Promise<void> {
      delete config[key];
      const keyListeners = listeners.get(key);
      if (keyListeners) {
        for (const cb of keyListeners) {
          cb(null);
        }
      }
    },
    onChange(key: string, callback: (value: unknown) => void): () => void {
      if (!listeners.has(key)) {
        listeners.set(key, new Set());
      }
      listeners.get(key)!.add(callback);
      return () => {
        listeners.get(key)!.delete(callback);
      };
    },
    async loadKey(_key: string): Promise<void> {},
    async loadKeys(_keys: string[]): Promise<void> {},
  };
}

describe("createClockComponent", () => {
  it("defaults to 12h format when no config exists", () => {
    const storage = createMockStorage();
    const clock = createClockComponent(storage);
    const rendered = clock.render();

    // Should match 12h pattern: h:mm AM or h:mm PM
    expect(rendered).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    clock.dispose();
  });

  it("uses 24h format when config specifies it", () => {
    const storage = createMockStorage({
      [STORAGE_KEYS.CLOCK_CONFIG]: { format: "24h" },
    });
    const clock = createClockComponent(storage);
    const rendered = clock.render();

    // Should match 24h pattern: HH:mm
    expect(rendered).toMatch(/^\d{2}:\d{2}$/);
    clock.dispose();
  });

  it("re-reads config on refresh()", async () => {
    const storageData: Record<string, unknown> = {};
    const storage = createMockStorage(storageData);
    const clock = createClockComponent(storage);

    // Initially 12h (no config)
    expect(clock.render()).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);

    // Change config to 24h
    storageData[STORAGE_KEYS.CLOCK_CONFIG] = { format: "24h" };
    await clock.refresh();

    // Now should render in 24h format
    expect(clock.render()).toMatch(/^\d{2}:\d{2}$/);
    clock.dispose();
  });

  it("reacts to onChange events from storage", async () => {
    const storage = createMockStorage();
    const clock = createClockComponent(storage);

    // Initially 12h
    expect(clock.render()).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);

    // Simulate config change via storage.set (triggers onChange)
    await storage.set(STORAGE_KEYS.CLOCK_CONFIG, { format: "24h" });

    // Should now render in 24h
    expect(clock.render()).toMatch(/^\d{2}:\d{2}$/);
    clock.dispose();
  });

  it("falls back to 12h on invalid config", async () => {
    const storage = createMockStorage({
      [STORAGE_KEYS.CLOCK_CONFIG]: { format: "invalid" },
    });
    const clock = createClockComponent(storage);

    // Invalid config should fall back to 12h default
    expect(clock.render()).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    clock.dispose();
  });

  it("shows placeholder on invalid system clock", () => {
    const storage = createMockStorage();
    const clock = createClockComponent(storage);

    // Mock Date to return NaN
    const originalDate = globalThis.Date;
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return new originalDate("invalid");
      }
    } as DateConstructor;

    expect(clock.render()).toBe("--:--");

    globalThis.Date = originalDate;
    clock.dispose();
  });

  it("dispose cleans up onChange subscription", async () => {
    const storage = createMockStorage();
    const clock = createClockComponent(storage);

    clock.dispose();

    // After dispose, changing config shouldn't affect the component
    // (no error should be thrown either)
    await storage.set(STORAGE_KEYS.CLOCK_CONFIG, { format: "24h" });

    // Component still renders (using last known format)
    expect(clock.render()).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("has type 'clock'", () => {
    const storage = createMockStorage();
    const clock = createClockComponent(storage);
    expect(clock.type).toBe("clock");
    clock.dispose();
  });
});
