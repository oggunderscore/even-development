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
  SCROLL_DEBOUNCE_MS,
  SCHEDULER_TICK_INTERVAL_MS,
  HUD_REFRESH_INTERVAL_MS,
  BANNER_DEFAULT_DURATION_S,
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

      // Exit is the last entry, after the sub-apps registered at boot
      // (SmarterEveryday). Walk the highlight down to it, then select.
      const entryCount = menuContent.split("\n").length;
      for (let i = 0; i < entryCount - 1; i++) {
        home.handleScrollDown();
        await vi.advanceTimersByTimeAsync(SCROLL_DEBOUNCE_MS);
      }

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

  describe("catchUpAfterPossibleThrottling", () => {
    // Real mobile WebViews suspend/throttle setInterval and setTimeout while
    // backgrounded (the normal state for a glasses wearer, per
    // background-lifecycle.md) — so these simulate that directly: move the
    // fake wall clock forward with vi.setSystemTime WITHOUT advancing fake
    // timers, meaning any pending setTimeout/setInterval callback that
    // "should" have fired by now provably has not. Calling
    // catchUpAfterPossibleThrottling() must self-correct anyway.

    function configureSleep(seconds: number): void {
      storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "inactivity-timer" });
      storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, {
        displayDurationSeconds: seconds,
      });
    }

    it("puts an overdue-for-sleep HUD to sleep even though the scheduled timer never fired", async () => {
      configureSleep(15);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      expect(home.isHudAwake).toBe(true);

      vi.setSystemTime(Date.now() + 30_000); // well past 15s, timer never ran

      home.catchUpAfterPossibleThrottling();
      await vi.advanceTimersByTimeAsync(0);

      expect(home.isHudAwake).toBe(false);
      home.dispose();
    });

    it("does not sleep early when not actually overdue", async () => {
      configureSleep(15);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      vi.setSystemTime(Date.now() + 5_000); // short of 15s

      home.catchUpAfterPossibleThrottling();
      await vi.advanceTimersByTimeAsync(0);

      expect(home.isHudAwake).toBe(true);
      home.dispose();
    });

    it("refreshes stale HUD content (e.g. the clock) even if the 60s refresh interval never fired", async () => {
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
      ]);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);
      const initialClock = latest(bridge, CONTAINER.HUD_COL_BASE);

      // 5 minutes pass with no interval tick — matches the reported "HUD
      // only updates once every ~5 minutes" symptom.
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);

      home.catchUpAfterPossibleThrottling();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).not.toBe(initialClock);
      home.dispose();
    });

    it("does not refresh again within HUD_REFRESH_INTERVAL_MS of the last catch-up (avoids flooding BLE traffic on rapid gestures)", async () => {
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
      ]);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);
      bridge.textContainerUpgrade.mockClear();

      // A burst of gestures in quick succession, well inside the interval —
      // e.g. rapid menu scrolling. None of these should trigger a fresh
      // HUD refresh; only the gesture's own (menu) container write happens.
      const burstStepMs = Math.floor(HUD_REFRESH_INTERVAL_MS / 10);
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(Date.now() + burstStepMs);
        home.catchUpAfterPossibleThrottling();
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(bridge.textContainerUpgrade).not.toHaveBeenCalledWith(
        expect.objectContaining({ containerID: CONTAINER.HUD_COL_BASE }),
      );
      home.dispose();
    });

    it("dismisses an overdue banner even if its own setTimeout never fired", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);

      home.pushDebugNotification("yes");
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.BANNER)).toBe("yes");

      // Past the banner's configured duration, but the dismiss timer never
      // actually runs (no advanceTimersByTime) — simulates it having been
      // throttled away in a backgrounded WebView.
      vi.setSystemTime(Date.now() + (BANNER_DEFAULT_DURATION_S + 1) * 1000);

      home.catchUpAfterPossibleThrottling();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      home.dispose();
    });

    it("is a no-op before start() and after dispose()", () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      expect(() => home.catchUpAfterPossibleThrottling()).not.toThrow();

      home.dispose();
      expect(() => home.catchUpAfterPossibleThrottling()).not.toThrow();
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

    it("refreshes the HUD when WEATHER_CACHE changes (e.g. the Debug tab's test weather push)", async () => {
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "weather", col: 0, row: 0 },
      ]);
      storage.seed(STORAGE_KEYS.WEATHER_CONFIG, {
        location: "Irvine, CA",
        unit: "fahrenheit",
        refreshIntervalMinutes: 30,
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);

      home.applyConfigChange(STORAGE_KEYS.WEATHER_CACHE, {
        temperature: 80,
        condition: "sunny",
        unit: "fahrenheit",
        fetchedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toContain("80");

      home.dispose();
    });
  });

  describe("menu order", () => {
    it("applies the saved order at boot, without a page rebuild", async () => {
      storage.seed(STORAGE_KEYS.MENU_ORDER, ["exit", "reminders"]);

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      bridge.rebuildPageContainer.mockClear();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      const content = latest(bridge, CONTAINER.MENU) ?? "";
      const lines = content.split("\n");
      expect(lines[0]).toBe("MENU");
      expect(lines[1]).toContain("Exit Foresight");
      expect(lines[2]).toContain("Reminders");
      expect(lines[3]).toContain("SmarterEveryday");
      expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();

      home.dispose();
    });

    it("re-orders live on a MENU_ORDER config change, without a page rebuild", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      bridge.rebuildPageContainer.mockClear();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect((latest(bridge, CONTAINER.MENU) ?? "").split("\n")[1]).toContain(
        "SmarterEveryday",
      );
      home.handleDoubleTap(); // close it before reordering
      await vi.advanceTimersByTimeAsync(0);

      home.applyConfigChange(STORAGE_KEYS.MENU_ORDER, ["reminders"]);
      await vi.advanceTimersByTimeAsync(0);

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      const lines = (latest(bridge, CONTAINER.MENU) ?? "").split("\n");
      expect(lines[0]).toBe("MENU");
      expect(lines[1]).toContain("Reminders");
      expect(lines[2]).toContain("SmarterEveryday");
      expect(lines[3]).toContain("Exit Foresight");
      expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();

      home.dispose();
    });

    it("ignores stale ids no longer registered and appends unmentioned entries", async () => {
      storage.seed(STORAGE_KEYS.MENU_ORDER, ["ghost-app", "reminders"]);

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      const lines = (latest(bridge, CONTAINER.MENU) ?? "").split("\n");
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe("MENU");
      expect(lines[1]).toContain("Reminders");
      expect(lines[2]).toContain("SmarterEveryday");
      expect(lines[3]).toContain("Exit Foresight");

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

    it("expands the banner on the first tap and dismisses it on the second", async () => {
      // Requirement 8.1/8.4: under NotificationSystem a tap expands the
      // banner (showing source + timestamp + full text) and only the tap on
      // that expanded view dismisses it. This replaces BannerSystem's
      // single-tap-dismisses behavior.
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

      // Expanded: attributed to the Reminders app, full text on its own
      // line, and the HUD is still blanked beneath it.
      expect(latest(bridge, CONTAINER.BANNER)).toContain("Reminders");
      expect(latest(bridge, CONTAINER.BANNER)).toContain("Take a break");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toBe("");

      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);

      home.dispose();
    });

    it("dismisses the banner on a swipe and archives it to history", async () => {
      // Requirement 8.3/9.1: a swipe skips the expanded view entirely, and the
      // dismissed entry is persisted to Notification_History.
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

      home.handleScrollUp();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);
      expect(
        storage.get<{ entries: Array<{ text: string }> }>(
          STORAGE_KEYS.NOTIFICATION_HISTORY,
        )?.entries.map((e) => e.text),
      ).toEqual(["Take a break"]);

      home.dispose();
    });
    it("leaves an open menu intact when a banner auto-dismisses over it", async () => {
      // The notification system borrows the menu container for the
      // Notification_Center, so a naive "returning to idle blanks both
      // containers" render would wipe a menu the wearer has open.
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
        { widgetId: "reminders", col: 1, row: 0 },
      ]);
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      const menuContent = latest(bridge, CONTAINER.MENU)!;
      expect(menuContent).toContain("Exit Foresight");

      // The phone adds an already-due reminder while the menu is open, which
      // banners immediately. Stay well inside the menu's own timeout
      // (MENU_TIMEOUT_MS).
      home.applyConfigChange(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Take a break",
            targetTime: Date.now() - 1000,
            completed: false,
          },
        ],
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.BANNER)).toBe("Take a break");

      // Let the banner time out on its own.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      expect(latest(bridge, CONTAINER.MENU)).toBe(menuContent);

      home.dispose();
    });

    it("pushDebugNotification banners the Debug tab's test text and wakes the HUD", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(0);

      home.pushDebugNotification("Hello from Debug tab");
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("Hello from Debug tab");

      home.dispose();
    });

    it("does not race the HUD back on under a banner when the HUD was asleep at push time", async () => {
      // Regression test for the bug reported as "notification text stuck
      // overlaid on top of the clock": pushing a notification while the HUD
      // is asleep used to call wakeHud() (hud.setVisible(true)) racing
      // NotificationSystem's own onVisibilityChange(true)
      // (hud.setVisible(false)) — both fire-and-forget against the same
      // HudManager `visible` flag. The HUD column would end up re-drawn
      // with real content (clock/weather) at the same time the banner text
      // was written to its own container, producing overlapping text on
      // real hardware. The HUD must stay blank the whole time the banner
      // is up, regardless of whether it was asleep when the push happened.
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
      ]);
      storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "inactivity-timer" });
      storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, {
        displayDurationSeconds: 5,
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();
      await vi.advanceTimersByTimeAsync(5_000 + 1);
      expect(home.isHudAwake).toBe(false);
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toBe("");

      home.pushDebugNotification("yes");
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("yes");
      // Must still be blank — not re-drawn with the clock underneath the banner.
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toBe("");

      // Once the banner clears, the HUD should come back (hudAsleep was
      // cleared by the push, even though setVisible(true) wasn't called
      // immediately).
      home.handleTap(); // expand
      await vi.advanceTimersByTimeAsync(0);
      home.handleTap(); // dismiss
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);

      home.dispose();
    });
  });

  describe("sub-apps", () => {
    it("registers SmarterEveryday as a menu entry at boot", async () => {
      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.MENU)).toContain("SmarterEveryday");

      home.dispose();
    });

    it("activates the sub-app from the menu and closes it on double-tap", async () => {
      storage.seed(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS, {
        topics: [
          {
            id: "t1",
            description: "Roman history",
            notificationIntervalMinutes: 60,
            quietHours: {
              enabled: false,
              startMinuteOfDay: 0,
              endMinuteOfDay: 0,
            },
            createdAt: Date.now(),
            paused: false,
            consecutiveFailures: 0,
            lastDeliveryAt: null,
            suppressedDuringQuietHours: false,
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      // SmarterEveryday is the first entry, so the initial highlight is on it.
      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.SUBAPP)).toContain("Roman history");
      // The sub-app draws into its own container, never the HUD's.
      expect(latest(bridge, CONTAINER.HUD_COL_BASE)).toMatch(/\d{1,2}:\d{2}/);

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.SUBAPP)).toBe("");

      home.dispose();
    });

    it("runs the Scheduler whether or not the sub-app is on screen", async () => {
      // Requirement 2.5 / design decision 1: Content_Delivery is driven by the
      // Scheduler booted in `start()`, NOT by `SubApp.activate()`, so it must
      // tick with the sub-app closed. The placeholder LlmClient always
      // rejects, so no banner is produced — the tick is observable through the
      // `lastDeliveryAt` the Scheduler persists after attempting delivery.
      storage.seed(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS, {
        topics: [
          {
            id: "t1",
            description: "Roman history",
            notificationIntervalMinutes: 10,
            quietHours: {
              enabled: false,
              startMinuteOfDay: 0,
              endMinuteOfDay: 0,
            },
            createdAt: Date.now(),
            paused: false,
            consecutiveFailures: 0,
            lastDeliveryAt: null,
            suppressedDuringQuietHours: false,
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      // Never opened from the menu — the sub-app stays inactive throughout.
      await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_INTERVAL_MS + 1000);

      const topic = storage.get<{ topics: Array<Record<string, unknown>> }>(
        STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      )?.topics[0];
      expect(topic?.lastDeliveryAt).not.toBeNull();
      expect(latest(bridge, CONTAINER.SUBAPP) ?? "").toBe("");

      home.dispose();
    });

    it("forwards a hold to the active sub-app", async () => {
      storage.seed(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS, { topics: [] });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      home.handleTap(); // activate SmarterEveryday
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.SUBAPP)).toBe("No topics yet");

      // SmarterEveryday ignores hold, but it must reach the sub-app rather
      // than being swallowed or routed to the notification center.
      expect(() => home.handleHold()).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.SUBAPP)).toBe("No topics yet");

      home.dispose();
    });

    it("registers Reminders as a menu entry and activates it from the menu", async () => {
      storage.seed(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Take a break",
            targetTime: Date.now() + 60_000,
            completed: false,
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.MENU)).toContain("Reminders");

      // Reminders is registered after SmarterEveryday, so it is the second entry.
      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);
      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.SUBAPP)).toContain("Take a break");

      home.dispose();
    });
  });

  describe("notification center", () => {
    function seedHistory(...texts: string[]): void {
      storage.seed(STORAGE_KEYS.NOTIFICATION_HISTORY, {
        entries: texts.map((text, i) => ({
          id: `h${i}`,
          sourceAppId: "tasks",
          sourceAppName: "Tasks",
          text,
          timestamp: 1_700_000_000_000 + i,
        })),
      });
    }

    it("opens on a swipe-down from the bare HUD, most-recent-first", async () => {
      seedHistory("older", "newer");

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);

      const content = latest(bridge, CONTAINER.MENU)!;
      expect(content).toContain("newer");
      expect(content).toContain("older");
      expect(content.indexOf("newer")).toBeLessThan(content.indexOf("older"));

      home.dispose();
    });

    it("closes on a double-tap", async () => {
      seedHistory("entry one");

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.MENU)).toContain("entry one");

      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.MENU)).toBe("");

      home.dispose();
    });

    it("hold opens the confirm-clear prompt and a tap confirms it", async () => {
      // Requirements 9.9/9.10 — the whole point of the hold gesture.
      seedHistory("entry one", "entry two");

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);

      home.handleHold();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.MENU)).toContain("Clear all");

      // The prompt says "Tap to confirm", so a tap must actually clear.
      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      expect(latest(bridge, CONTAINER.MENU)).toBe(
        "NOTIFICATIONS\nNo notifications",
      );
      expect(
        storage.get<{ entries: unknown[] }>(STORAGE_KEYS.NOTIFICATION_HISTORY)
          ?.entries,
      ).toEqual([]);

      home.dispose();
    });

    it("survives a notification arriving while it is open, then closes", async () => {
      // Regression: a push used to overwrite the center phase with "banner"
      // while priorPhase still read "idle", so dismissing the interrupting
      // banner silently dropped the wearer's open center for good. The
      // Scheduler pushes on its own 60s tick, so this was not a rare race.
      seedHistory("entry one");
      storage.seed(STORAGE_KEYS.HUD_LAYOUT, [
        { widgetId: "clock", col: 0, row: 0 },
        { widgetId: "reminders", col: 1, row: 0 },
      ]);

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.MENU)).toContain("entry one");

      home.applyConfigChange(STORAGE_KEYS.REMINDERS, {
        reminders: [
          {
            id: "r1",
            title: "Take a break",
            targetTime: Date.now() - 1000,
            completed: false,
          },
        ],
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.BANNER)).toBe("Take a break");

      // Let the banner time out; the center comes back, now including it.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(latest(bridge, CONTAINER.BANNER)).toBe("");
      const restored = latest(bridge, CONTAINER.MENU)!;
      expect(restored).toContain("entry one");
      expect(restored).toContain("Take a break");

      // And the restored center must still be closable — priorPhase must not
      // have been left pointing at the center, or this would restore it onto
      // itself and trap the wearer.
      home.handleDoubleTap();
      await vi.advanceTimersByTimeAsync(0);
      expect(latest(bridge, CONTAINER.MENU)).toBe("");

      home.dispose();
    });

    it("wakes a sleeping HUD instead of opening", async () => {
      seedHistory("entry one");
      storage.seed(STORAGE_KEYS.HUD_SLEEP, { mode: "inactivity-timer" });
      storage.seed(STORAGE_KEYS.HUD_SLEEP_DELAY, { displayDurationSeconds: 5 });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(5000);
      expect(home.isHudAwake).toBe(false);

      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);

      // Opening a center on a display the wearer cannot see is disorienting.
      // The container is never written at all, hence the `?? ""`.
      expect(home.isHudAwake).toBe(true);
      expect(latest(bridge, CONTAINER.MENU) ?? "").toBe("");

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
