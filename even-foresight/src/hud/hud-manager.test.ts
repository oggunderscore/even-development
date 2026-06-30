import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHudManager } from "./hud-manager";
import type { HudLayoutConfig } from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";

/**
 * Creates a mock StorageManager for testing.
 */
function createMockStorage(): StorageManager {
  const store = new Map<string, unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  return {
    get<T>(key: string): T | null {
      const value = store.get(key);
      return value !== undefined ? (value as T) : null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
      const keyListeners = listeners.get(key);
      if (keyListeners) {
        for (const cb of keyListeners) {
          cb(value);
        }
      }
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
    onChange(key: string, callback: (value: unknown) => void): () => void {
      if (!listeners.has(key)) {
        listeners.set(key, new Set());
      }
      listeners.get(key)!.add(callback);
      return () => {
        listeners.get(key)?.delete(callback);
      };
    },
    async loadKey(_key: string): Promise<void> {},
    async loadKeys(_keys: string[]): Promise<void> {},
  };
}

/**
 * Creates a mock bridge that tracks textContainerUpgrade calls.
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
    getLocalStorage(_key: string): string | null {
      return null;
    },
    setLocalStorage: vi.fn(),
  };
}

describe("HudManager", () => {
  let storage: StorageManager;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createMockStorage();
    bridge = createMockBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("init", () => {
    it("should initialize with an empty config and render nothing in slots", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: Array.from({ length: 10 }, (_, i) => ({
          row: Math.floor(i / 5) as 0 | 1,
          col: (i % 5) as 0 | 1 | 2 | 3 | 4,
          componentType: null,
        })),
      };

      await manager.init(bridge, config);

      // All slots should be cleared (empty strings rendered)
      const clearCalls = bridge.calls.filter((c) => c.content === "");
      expect(clearCalls.length).toBe(10);

      manager.dispose();
    });

    it("should initialize with a clock component and render time", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);

      // Should have cleared all slots and then rendered the clock slot
      // The last call for container 1 (row 0, col 0) should have non-empty content
      const slot0Calls = bridge.calls.filter((c) => c.containerID === 0);
      const lastSlot0Call = slot0Calls[slot0Calls.length - 1];
      expect(lastSlot0Call).toBeDefined();
      // Clock renders a time string (not empty)
      expect(lastSlot0Call.content).not.toBe("");

      manager.dispose();
    });

    it("should initialize with multiple component types", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          { row: 0, col: 1, componentType: "weather" },
          { row: 0, col: 2, componentType: "reminders" },
          { row: 0, col: 3, componentType: null },
          { row: 0, col: 4, componentType: null },
          { row: 1, col: 0, componentType: null },
          { row: 1, col: 1, componentType: null },
          { row: 1, col: 2, componentType: null },
          { row: 1, col: 3, componentType: null },
          { row: 1, col: 4, componentType: null },
        ],
      };

      await manager.init(bridge, config);

      // All content goes to container 1 (single HUD container mode)
      const hudCalls = bridge.calls.filter((c) => c.containerID === 0);
      // Should have received multiple render calls
      expect(hudCalls.length).toBeGreaterThan(0);
      // At least one call should contain time digits (clock)
      const hasTime = hudCalls.some((c) => /\d/.test(c.content));
      expect(hasTime).toBe(true);

      manager.dispose();
    });
  });

  describe("component instantiation per slot type", () => {
    it("should create clock components for clock slots", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          { row: 0, col: 1, componentType: null },
          { row: 0, col: 2, componentType: null },
          { row: 0, col: 3, componentType: null },
          { row: 0, col: 4, componentType: null },
          { row: 1, col: 0, componentType: null },
          { row: 1, col: 1, componentType: null },
          { row: 1, col: 2, componentType: null },
          { row: 1, col: 3, componentType: null },
          { row: 1, col: 4, componentType: null },
        ],
      };

      await manager.init(bridge, config);

      // Verify that the clock slot rendered a time-like string
      const clockCalls = bridge.calls.filter((c) => c.containerID === 0);
      const lastCall = clockCalls[clockCalls.length - 1];
      // 12h format: "h:mm AM" or "h:mm PM", 24h format: "HH:mm"
      expect(lastCall.content).toMatch(/\d{1,2}:\d{2}/);

      manager.dispose();
    });

    it("should support the same component type in multiple slots", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          { row: 0, col: 1, componentType: "clock" },
          { row: 0, col: 2, componentType: null },
          { row: 0, col: 3, componentType: null },
          { row: 0, col: 4, componentType: null },
          { row: 1, col: 0, componentType: null },
          { row: 1, col: 1, componentType: null },
          { row: 1, col: 2, componentType: null },
          { row: 1, col: 3, componentType: null },
          { row: 1, col: 4, componentType: null },
        ],
      };

      await manager.init(bridge, config);

      // All renders go to container 1 in single-container mode
      // Both clock instances should produce time-formatted content
      const hudCalls = bridge.calls.filter((c) => c.containerID === 0);
      const timeCalls = hudCalls.filter((c) => /\d{1,2}:\d{2}/.test(c.content));
      // Should have at least 2 time renders (one for each clock slot)
      expect(timeCalls.length).toBeGreaterThanOrEqual(2);

      manager.dispose();
    });
  });

  describe("pause/resume lifecycle", () => {
    it("should stop refresh timer on pause", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);

      const callCountAfterInit = bridge.calls.length;

      // Pause the manager
      manager.pause();

      // Advance timer by 60 seconds - should NOT trigger refresh
      await vi.advanceTimersByTimeAsync(60_000);

      // No new render calls should have happened
      expect(bridge.calls.length).toBe(callCountAfterInit);

      manager.dispose();
    });

    it("should restart refresh timer and trigger immediate refresh on resume", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);
      manager.pause();

      const callCountAfterPause = bridge.calls.length;

      // Resume triggers an immediate refreshAll
      manager.resume();

      // Allow the async refreshAll to settle
      await vi.advanceTimersByTimeAsync(0);

      // Should have new render calls from the immediate refresh
      expect(bridge.calls.length).toBeGreaterThan(callCountAfterPause);

      manager.dispose();
    });

    it("should refresh after 60 seconds when resumed", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);
      manager.pause();
      manager.resume();

      // Allow the immediate refresh to complete
      await vi.advanceTimersByTimeAsync(0);

      const callCountAfterResume = bridge.calls.length;

      // Advance 60 seconds - should trigger another refresh
      await vi.advanceTimersByTimeAsync(60_000);

      expect(bridge.calls.length).toBeGreaterThan(callCountAfterResume);

      manager.dispose();
    });
  });

  describe("rebuild with new config", () => {
    it("should replace components when config changes", async () => {
      const manager = createHudManager(storage);

      // Start with clock in slot 0
      const config1: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config1);

      // Clear call tracking
      bridge.calls.length = 0;

      // Rebuild with reminders in slot 0
      const config2: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "reminders" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.rebuild(config2);

      // Container 1 should now show reminders content
      const slot0Calls = bridge.calls.filter((c) => c.containerID === 0);
      const lastSlot0Call = slot0Calls[slot0Calls.length - 1];
      expect(lastSlot0Call.content).toBe("No reminders");

      manager.dispose();
    });

    it("should dispose old components on rebuild", async () => {
      const manager = createHudManager(storage);

      const config1: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          { row: 0, col: 1, componentType: "weather" },
          { row: 0, col: 2, componentType: "reminders" },
          ...Array.from({ length: 7 }, (_, i) => ({
            row: Math.floor((i + 3) / 5) as 0 | 1,
            col: ((i + 3) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config1);

      // Rebuild with empty config - all components should be disposed
      const config2: HudLayoutConfig = {
        slots: Array.from({ length: 10 }, (_, i) => ({
          row: Math.floor(i / 5) as 0 | 1,
          col: (i % 5) as 0 | 1 | 2 | 3 | 4,
          componentType: null,
        })),
      };

      // This should not throw (dispose works cleanly)
      await manager.rebuild(config2);

      // Verify all slots are cleared
      bridge.calls.length = 0;
      await manager.refreshAll();

      // With no active components, refreshAll should still render nothing new
      // (no components to refresh/render)
      const nonEmptyCalls = bridge.calls.filter((c) => c.content !== "");
      expect(nonEmptyCalls.length).toBe(0);

      manager.dispose();
    });
  });

  describe("empty config renders nothing", () => {
    it("should render empty overlay when no components are configured", async () => {
      const manager = createHudManager(storage);

      const emptyConfig: HudLayoutConfig = {
        slots: Array.from({ length: 10 }, (_, i) => ({
          row: Math.floor(i / 5) as 0 | 1,
          col: (i % 5) as 0 | 1 | 2 | 3 | 4,
          componentType: null,
        })),
      };

      await manager.init(bridge, emptyConfig);

      // All 10 slots should be cleared (empty strings)
      const allCalls = bridge.calls;
      expect(allCalls.length).toBe(10);
      for (const call of allCalls) {
        expect(call.content).toBe("");
      }

      manager.dispose();
    });
  });

  describe("60-second refresh cycle", () => {
    it("should refresh all components every 60 seconds", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          { row: 0, col: 1, componentType: "reminders" },
          ...Array.from({ length: 8 }, (_, i) => ({
            row: Math.floor((i + 2) / 5) as 0 | 1,
            col: ((i + 2) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);
      const callCountAfterInit = bridge.calls.length;

      // Advance 60 seconds
      await vi.advanceTimersByTimeAsync(60_000);

      // Should have additional render calls from the refresh
      expect(bridge.calls.length).toBeGreaterThan(callCountAfterInit);

      manager.dispose();
    });
  });

  describe("dispose", () => {
    it("should stop timers and clean up on dispose", async () => {
      const manager = createHudManager(storage);

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "clock" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);
      manager.dispose();

      const callCountAfterDispose = bridge.calls.length;

      // Advance 60 seconds - should NOT trigger any more refreshes
      await vi.advanceTimersByTimeAsync(60_000);

      expect(bridge.calls.length).toBe(callCountAfterDispose);
    });
  });

  describe("notification callback", () => {
    it("should pass onNotification callback to reminders component", async () => {
      const notifications: string[] = [];
      const onNotification = (title: string) => {
        notifications.push(title);
      };

      const manager = createHudManager(storage, onNotification);

      // Set up a reminder that's due now
      const now = Date.now();
      await storage.set("foresight-reminders-v1", {
        reminders: [
          {
            id: "test-1",
            title: "Test Reminder",
            targetTime: now - 1000, // already past
            completed: false,
          },
        ],
      });

      const config: HudLayoutConfig = {
        slots: [
          { row: 0, col: 0, componentType: "reminders" },
          ...Array.from({ length: 9 }, (_, i) => ({
            row: Math.floor((i + 1) / 5) as 0 | 1,
            col: ((i + 1) % 5) as 0 | 1 | 2 | 3 | 4,
            componentType: null as null,
          })),
        ],
      };

      await manager.init(bridge, config);

      // Trigger a refresh which should check for triggered reminders
      await manager.refreshAll();

      // The notification callback should have been called
      expect(notifications).toContain("Test Reminder");

      manager.dispose();
    });
  });
});
