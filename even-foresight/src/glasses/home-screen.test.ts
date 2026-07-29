import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHomeScreen } from "./home-screen";
import { STORAGE_KEYS } from "../storage/schemas";
import {
  createFakeStorage,
  type FakeStorage,
} from "../storage/storage-manager.test-utils";
import {
  CONTAINER,
  CONTAINER_NAME,
  HOME_CONTAINER_COUNT,
  HUD_COLS,
} from "../constants";

function createMockBridge() {
  const upgrades: Array<{ containerID: number; content: string }> = [];
  const rebuilds: any[] = [];

  return {
    upgrades,
    rebuilds,
    rebuildPageContainer: vi.fn(async (config: any) => {
      rebuilds.push(config);
      return true;
    }),
    textContainerUpgrade: vi.fn(async (upgrade: any) => {
      upgrades.push({
        containerID: upgrade.containerID,
        content: upgrade.content,
      });
      return true;
    }),
    shutDownPageContainer: vi.fn(async () => true),
    getLocalStorage: vi.fn(async () => ""),
    setLocalStorage: vi.fn(async () => true),
  };
}

/** Latest content written to a container. */
function latest(
  bridge: ReturnType<typeof createMockBridge>,
  containerID: number,
): string | undefined {
  return bridge.upgrades.filter((u) => u.containerID === containerID).at(-1)
    ?.content;
}

describe("createHomeScreen", () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let storage: FakeStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = createMockBridge();
    storage = createFakeStorage();
    storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
      { widgetId: "clock", col: 0, row: 0 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("page allocation", () => {
    it("builds the whole page in a single rebuild", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
      const config = bridge.rebuilds[0];
      expect(config.containerTotalNum).toBe(HOME_CONTAINER_COUNT);
      expect(config.textObject).toHaveLength(HOME_CONTAINER_COUNT);

      home.dispose();
    });

    it("allocates unique IDs and names within the platform limits", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      const containers = bridge.rebuilds[0].textObject;
      const ids = containers.map((c: any) => c.containerID);
      const names = containers.map((c: any) => c.containerName);

      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(names).size).toBe(names.length);
      // containerName is capped at 16 characters by the firmware.
      for (const name of names) {
        expect(name.length).toBeLessThanOrEqual(16);
      }
      // G2 allows 8 non-image containers per page.
      expect(containers.length).toBeLessThanOrEqual(8);

      home.dispose();
    });

    it("marks exactly one container as the event capture target", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      const capturing = bridge.rebuilds[0].textObject.filter(
        (c: any) => c.isEventCapture === 1,
      );
      expect(capturing).toHaveLength(1);
      expect(capturing[0].containerName).toBe(CONTAINER_NAME.MENU);

      home.dispose();
    });

    it("keeps every container inside the 576x288 display", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      for (const c of bridge.rebuilds[0].textObject) {
        expect(c.xPosition + c.width).toBeLessThanOrEqual(576);
        expect(c.yPosition + c.height).toBeLessThanOrEqual(288);
      }

      home.dispose();
    });
  });

  describe("menu", () => {
    it("never rebuilds the page when opening or closing", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      bridge.rebuildPageContainer.mockClear();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect(home.isMenuOpen).toBe(true);

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect(home.isMenuOpen).toBe(false);

      // A rebuild here would destroy the HUD columns.
      expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();

      home.dispose();
    });

    it("leaves HUD content intact after the menu closes", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      const hudBefore = latest(bridge, CONTAINER.HUD_COL_BASE);
      expect(hudBefore).toMatch(/\d{1,2}:\d{2}/);

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toBe(hudBefore);
      expect(latest(bridge, CONTAINER.MENU)).toBe("");

      home.dispose();
    });

    it("offers an Exit entry that requests the system exit dialog", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      const menuContent = latest(bridge, CONTAINER.MENU)!;
      expect(menuContent).toContain("Exit Foresight");

      // Highlight starts on the first entry, which is Exit when no extras
      // were registered; select it.
      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      // Mode 1 is the system confirmation dialog the platform requires.
      expect(bridge.shutDownPageContainer).toHaveBeenCalledWith(1);

      home.dispose();
    });
  });

  describe("inactivity timer", () => {
    function configureSleep(seconds: number): void {
      storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "inactivity-timer" });
      storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, {
        displayDurationSeconds: seconds,
      });
    }

    it("stays awake indefinitely when never-sleep is configured", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(home.isHudAwake).toBe(true);

      home.dispose();
    });

    it("blanks every HUD column after the configured idle time", async () => {
      configureSleep(10);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      expect(home.isHudAwake).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(home.isHudAwake).toBe(false);
      for (let col = 0; col < HUD_COLS; col++) {
        expect(latest(bridge, CONTAINER.HUD_COL_BASE + col)).toBe("");
      }

      home.dispose();
    });

    it("input postpones sleep", async () => {
      configureSleep(10);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(9_000);
      home.handleTap();
      await vi.advanceTimersByTimeAsync(9_000);

      // 18s total, but the timer restarted at 9s.
      expect(home.isHudAwake).toBe(true);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(home.isHudAwake).toBe(false);

      home.dispose();
    });

    it("a tap wakes a sleeping HUD and restores content", async () => {
      configureSleep(10);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(home.isHudAwake).toBe(false);

      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(home.isHudAwake).toBe(true);
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);

      home.dispose();
    });

    it("a double-tap on a sleeping HUD wakes it without opening the menu", async () => {
      configureSleep(10);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(10_000);
      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(home.isHudAwake).toBe(true);
      expect(home.isMenuOpen).toBe(false);

      // The next double-tap, now against a visible HUD, does open it.
      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect(home.isMenuOpen).toBe(true);

      home.dispose();
    });

    it("switching to never-sleep wakes the HUD immediately", async () => {
      configureSleep(10);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(home.isHudAwake).toBe(false);

      home.applyConfigChange(STORAGE_KEYS.HUD_SLEEP, { mode: "always-on" });
      await vi.advanceTimersByTimeAsync(0);

      expect(home.isHudAwake).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(home.isHudAwake).toBe(true);

      home.dispose();
    });

    it("does not sleep after dispose", async () => {
      configureSleep(10);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      // No timer should still be pending to touch a disposed bridge.
      expect(bridge.textContainerUpgrade).not.toHaveBeenCalledWith(
        expect.objectContaining({ containerID: CONTAINER.BANNER }),
      );
    });
  });

  describe("config changes", () => {
    it("applies a new HUD layout without a page rebuild", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      bridge.rebuildPageContainer.mockClear();

      home.applyConfigChange(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 4, row: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toBe("");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE + 4)).toMatch(
        /\d{1,2}:\d{2}/,
      );
      expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();

      home.dispose();
    });

    it("ignores unknown keys", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      expect(() =>
        home.applyConfigChange("something-unrelated", { a: 1 }),
      ).not.toThrow();

      home.dispose();
    });
  });

  describe("notifications", () => {
    it("shows a banner for a due reminder and blanks the HUD beneath it", async () => {
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
        { widgetId: "reminders", col: 1, row: 0 },
      ]);
      storage.seed(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Take a break",
            targetTime: Date.now() - 1000,
            completed: false,
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("Take a break");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toBe("");

      home.dispose();
    });

    it("restores the HUD when the banner is tapped away", async () => {
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
        { widgetId: "reminders", col: 1, row: 0 },
      ]);
      storage.seed(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Take a break",
            targetTime: Date.now() - 1000,
            completed: false,
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);

      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);

      home.dispose();
    });
  });

  describe("lifecycle", () => {
    it("dispose is safe before start", () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      expect(() => home.dispose()).not.toThrow();
    });

    it("dispose is idempotent", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.dispose();
      expect(() => home.dispose()).not.toThrow();
    });

    it("gestures after dispose do not throw", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      home.dispose();

      expect(() => {
        home.handleTap();
        home.handleDoubleTap();
        home.handleScrollUp();
        home.handleScrollDown();
      }).not.toThrow();
    });
  });
});
