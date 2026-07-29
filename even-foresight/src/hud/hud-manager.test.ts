import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHudManager } from "./hud-manager";
import { colToContainerId } from "./hud-slot";
import type { HudLayoutConfig } from "../storage/schemas";
import { STORAGE_KEYS } from "../storage/schemas";
import {
  createFakeStorage,
  type FakeStorage,
} from "../storage/storage-manager.test-utils";
import { HUD_COLS, HUD_REFRESH_INTERVAL_MS } from "../constants";

/**
 * Mock bridge recording every textContainerUpgrade.
 */
function createMockBridge() {
  const calls: Array<{ containerID: number; content: string }> = [];
  return {
    calls,
    async textContainerUpgrade(upgrade: any): Promise<void> {
      calls.push({
        containerID: upgrade.containerID,
        content: upgrade.content,
      });
    },
    setLocalStorage: vi.fn(async () => true),
    getLocalStorage: vi.fn(async () => ""),
  };
}

/** Latest content written to the container backing `col`. */
function latestForColumn(
  bridge: ReturnType<typeof createMockBridge>,
  col: number,
): string | undefined {
  const id = colToContainerId(col);
  const forCol = bridge.calls.filter((c) => c.containerID === id);
  return forCol.at(-1)?.content;
}

/** A layout with a component in one cell and nothing anywhere else. */
function singleSlot(
  componentType: "clock" | "weather" | "reminders",
  row: 0 | 1 = 0,
  col: 0 | 1 | 2 | 3 | 4 = 0,
): HudLayoutConfig {
  return { slots: [{ row, col, componentType }] };
}

const EMPTY_LAYOUT: HudLayoutConfig = { slots: [] };

describe("HudManager", () => {
  let storage: FakeStorage;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createFakeStorage();
    bridge = createMockBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("init", () => {
    it("writes an empty string to every column for an empty layout", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, EMPTY_LAYOUT);

      expect(bridge.calls).toHaveLength(HUD_COLS);
      for (const call of bridge.calls) {
        expect(call.content).toBe("");
      }

      manager.dispose();
    });

    it("renders a clock into the container for its column", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock", 0, 3));

      expect(latestForColumn(bridge, 3)).toMatch(/\d{1,2}:\d{2}/);
      expect(latestForColumn(bridge, 0)).toBe("");

      manager.dispose();
    });

    it("puts row 0 and row 1 on separate lines of one column", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, {
        slots: [
          { row: 0, col: 1, componentType: "clock" },
          { row: 1, col: 1, componentType: "reminders" },
        ],
      });

      const content = latestForColumn(bridge, 1)!;
      const [line0, line1] = content.split("\n");
      expect(line0).toMatch(/\d{1,2}:\d{2}/);
      expect(line1).toBe("No reminders");

      manager.dispose();
    });

    it("drops slots that fall outside the 2x5 grid", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          // Out of bounds — must not throw or write past the column set.
          { row: 5 as 0, col: 9 as 0, componentType: "clock" },
        ],
      });

      expect(bridge.calls).toHaveLength(HUD_COLS);
      expect(latestForColumn(bridge, 0)).toMatch(/\d{1,2}:\d{2}/);

      manager.dispose();
    });

    it("renders the same component type in multiple columns", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          { row: 0, col: 1, componentType: "clock" },
        ],
      });

      expect(latestForColumn(bridge, 0)).toMatch(/\d{1,2}:\d{2}/);
      expect(latestForColumn(bridge, 1)).toMatch(/\d{1,2}:\d{2}/);

      manager.dispose();
    });
  });

  describe("redundant writes", () => {
    it("does not re-send unchanged content on refresh", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("reminders"));

      bridge.calls.length = 0;
      await manager.refreshAll();

      // "No reminders" has not changed, so nothing goes over the bridge.
      expect(bridge.calls).toHaveLength(0);

      manager.dispose();
    });

    it("sends content once it actually changes", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("reminders"));

      bridge.calls.length = 0;
      await storage.set(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Standup",
            targetTime: Date.now() + 60_000,
            completed: false,
          },
        ],
      });
      await manager.refreshAll();

      expect(latestForColumn(bridge, 0)).toContain("Standup");

      manager.dispose();
    });
  });

  describe("visibility", () => {
    it("clears every column when hidden and restores content when shown", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      await manager.setVisible(false);
      expect(manager.isVisible()).toBe(false);
      expect(latestForColumn(bridge, 0)).toBe("");

      await manager.setVisible(true);
      expect(manager.isVisible()).toBe(true);
      expect(latestForColumn(bridge, 0)).toMatch(/\d{1,2}:\d{2}/);

      manager.dispose();
    });

    it("stays blank across a refresh while hidden", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));
      await manager.setVisible(false);

      bridge.calls.length = 0;
      await manager.refreshAll();

      for (const call of bridge.calls) {
        expect(call.content).toBe("");
      }

      manager.dispose();
    });

    it("setVisible is a no-op when already in that state", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      bridge.calls.length = 0;
      await manager.setVisible(true);
      expect(bridge.calls).toHaveLength(0);

      manager.dispose();
    });
  });

  describe("refresh cycle", () => {
    it("refreshes on the interval", async () => {
      // A reminder that is still upcoming at init and falls due before the
      // first tick, so the interval — not the initial render — is what
      // changes the display.
      storage.seed(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Standup",
            targetTime: Date.now() + HUD_REFRESH_INTERVAL_MS / 2,
            completed: false,
          },
        ],
      });

      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("reminders"));
      expect(latestForColumn(bridge, 0)).toContain("Standup");

      bridge.calls.length = 0;
      await vi.advanceTimersByTimeAsync(HUD_REFRESH_INTERVAL_MS);

      // The tick fired, saw the reminder come due, and cleared it.
      expect(latestForColumn(bridge, 0)).toBe("No reminders");

      manager.dispose();
    });

    it("pause stops the interval; resume restarts it", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      manager.pause();
      bridge.calls.length = 0;
      await vi.advanceTimersByTimeAsync(HUD_REFRESH_INTERVAL_MS * 2);
      expect(bridge.calls).toHaveLength(0);

      manager.resume();
      await vi.advanceTimersByTimeAsync(0);
      // resume() forces an immediate refresh; content is unchanged so the
      // memo suppresses the write, but the timer is running again.
      manager.pause();
      manager.dispose();
    });

    it("resume without a prior pause does not stack timers", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      manager.resume();
      manager.resume();

      manager.dispose();
      bridge.calls.length = 0;
      await vi.advanceTimersByTimeAsync(HUD_REFRESH_INTERVAL_MS * 2);
      expect(bridge.calls).toHaveLength(0);
    });
  });

  describe("rebuild", () => {
    it("clears columns that lost their component", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock", 0, 2));
      expect(latestForColumn(bridge, 2)).toMatch(/\d{1,2}:\d{2}/);

      await manager.rebuild(singleSlot("clock", 0, 4));

      expect(latestForColumn(bridge, 2)).toBe("");
      expect(latestForColumn(bridge, 4)).toMatch(/\d{1,2}:\d{2}/);

      manager.dispose();
    });

    it("disposes replaced components so their storage listeners unsubscribe", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      await manager.rebuild(EMPTY_LAYOUT);
      // Clock subscribes to CLOCK_CONFIG on construction and unsubscribes on
      // dispose; a leak here would grow the listener set on every rebuild.
      await storage.set(STORAGE_KEYS.CLOCK_CONFIG, { format: "24h" });

      expect(latestForColumn(bridge, 0)).toBe("");

      manager.dispose();
    });
  });

  describe("dispose", () => {
    it("stops the refresh timer", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      manager.dispose();
      bridge.calls.length = 0;

      await vi.advanceTimersByTimeAsync(HUD_REFRESH_INTERVAL_MS * 3);
      expect(bridge.calls).toHaveLength(0);
    });

    it("is safe to call twice", async () => {
      const manager = createHudManager(storage);
      await manager.init(bridge, singleSlot("clock"));

      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe("notification callback", () => {
    it("fires for a reminder that is already due", async () => {
      const notifications: string[] = [];
      const manager = createHudManager(storage, (title) => {
        notifications.push(title);
      });

      storage.seed(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "past-1",
            title: "Take medication",
            targetTime: Date.now() - 1000,
            completed: false,
          },
        ],
      });

      await manager.init(bridge, singleSlot("reminders"));

      expect(notifications).toContain("Take medication");

      manager.dispose();
    });

    it("fires once per reminder, not on every refresh", async () => {
      const notifications: string[] = [];
      const manager = createHudManager(storage, (title) => {
        notifications.push(title);
      });

      storage.seed(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "past-1",
            title: "Take medication",
            targetTime: Date.now() - 1000,
            completed: false,
          },
        ],
      });

      await manager.init(bridge, singleSlot("reminders"));
      await manager.refreshAll();
      await manager.refreshAll();

      expect(notifications).toHaveLength(1);

      manager.dispose();
    });
  });
});
