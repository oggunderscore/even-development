import { describe, it, expect } from "vitest";
import { hudGridToLayoutConfig, readSleepSettings } from "./layout";
import { STORAGE_KEYS } from "../storage/schemas";
import { createFakeStorage } from "../storage/storage-manager.test-utils";

describe("hudGridToLayoutConfig", () => {
  it("converts renderable placements", () => {
    const result = hudGridToLayoutConfig([
      { widgetId: "clock", col: 0, row: 0 },
      { widgetId: "weather", col: 4, row: 1 },
    ]);

    expect(result.slots).toEqual([
      { row: 0, col: 0, componentType: "clock" },
      { row: 1, col: 4, componentType: "weather" },
    ]);
  });

  it("drops widgets the glasses cannot render", () => {
    // "assistant" and "tasks" are pickable in the layout editor but have no
    // HUD component; they must not reach HudManager as unknown types.
    const result = hudGridToLayoutConfig([
      { widgetId: "assistant", col: 0, row: 0 },
      { widgetId: "tasks", col: 1, row: 0 },
      { widgetId: "clock", col: 2, row: 0 },
    ]);

    expect(result.slots).toEqual([{ row: 0, col: 2, componentType: "clock" }]);
  });

  it("drops out-of-bounds placements instead of clamping them", () => {
    const result = hudGridToLayoutConfig([
      { widgetId: "clock", col: 5, row: 0 },
      { widgetId: "clock", col: 0, row: 2 },
      { widgetId: "clock", col: -1, row: 0 },
      { widgetId: "clock", col: 1.5, row: 0 },
    ]);

    expect(result.slots).toEqual([]);
  });

  it("tolerates malformed input", () => {
    expect(hudGridToLayoutConfig(null).slots).toEqual([]);
    expect(hudGridToLayoutConfig(undefined).slots).toEqual([]);
    expect(hudGridToLayoutConfig([] as any).slots).toEqual([]);
    expect(hudGridToLayoutConfig([null as any]).slots).toEqual([]);
    expect(hudGridToLayoutConfig("nope" as any).slots).toEqual([]);
  });
});

describe("readSleepSettings", () => {
  it("returns null when the HUD never sleeps", () => {
    const storage = createFakeStorage();
    storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "always-on" });

    expect(readSleepSettings(storage)).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(readSleepSettings(createFakeStorage())).toBeNull();
  });

  it("returns the configured delay in milliseconds", () => {
    const storage = createFakeStorage();
    storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "inactivity-timer" });
    storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, { displayDurationSeconds: 30 });

    expect(readSleepSettings(storage)).toBe(30_000);
  });

  it("accepts the legacy 'hidden' mode value", () => {
    const storage = createFakeStorage();
    storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "hidden" });
    storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, { displayDurationSeconds: 10 });

    expect(readSleepSettings(storage)).toBe(10_000);
  });

  it("falls back to 15s when a timer is requested without a usable delay", () => {
    const storage = createFakeStorage();
    storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "inactivity-timer" });

    expect(readSleepSettings(storage)).toBe(15_000);

    storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, { displayDurationSeconds: 0 });
    expect(readSleepSettings(storage)).toBe(15_000);

    storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, { displayDurationSeconds: -5 });
    expect(readSleepSettings(storage)).toBe(15_000);
  });
});
