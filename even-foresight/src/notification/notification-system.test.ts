import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotificationSystem } from "./notification-system";
import type { NotificationEntry } from "../storage/schemas";
import { STORAGE_KEYS } from "../storage/schemas";
import { CONTAINER, CONTAINER_NAME } from "../constants";

// === createNotificationSystem integration tests ===
//
// Replaces the old `banner-system.test.ts` suite (now dead code — see
// task 13.2/9.1: `BannerSystem` was renamed/evolved into `NotificationSystem`
// and every caller updated). These tests exercise the real factory this
// codebase ships (`createNotificationSystem`) rather than the deleted
// `createBannerSystem`, covering the same push/dismiss/queue/duration
// behaviors plus the new tap-to-expand/swipe-to-dismiss/history surface.

describe("createNotificationSystem", () => {
  let mockBridge: any;
  let mockStorage: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockBridge = {
      textContainerUpgrade: vi.fn().mockResolvedValue(undefined),
    };

    mockStorage = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      onChange: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeNotification = (
    id: string,
    text = `Notification ${id}`,
  ): NotificationEntry => ({
    id,
    sourceAppId: "test",
    sourceAppName: "Test",
    text,
    timestamp: Date.now(),
  });

  it("displays immediately when no banner is active", () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    expect(system.isVisible).toBe(false);

    system.push(makeNotification("1"));

    expect(system.isVisible).toBe(true);
    const call = mockBridge.textContainerUpgrade.mock.calls[0][0];
    expect(call.containerID).toBe(CONTAINER.BANNER);
    expect(call.content).toBe("Notification 1");
  });

  it("queues a notification pushed while a banner is already active", () => {
    const system = createNotificationSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));
    system.push(makeNotification("2"));

    // The second push is queued, not displayed — only "1" is on screen.
    expect(system.isVisible).toBe(true);
    const lastCall =
      mockBridge.textContainerUpgrade.mock.calls[
        mockBridge.textContainerUpgrade.mock.calls.length - 1
      ][0];
    expect(lastCall.content).toBe("Notification 1");
  });

  it("auto-dismisses on timer expiry", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage, {
      defaultDuration: 5,
    });

    system.push(makeNotification("1"));
    expect(system.isVisible).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);

    expect(system.isVisible).toBe(false);
  });

  describe("checkTimeoutElapsed", () => {
    it("dismisses a banner overdue for auto-dismiss even if its setTimeout never fired", async () => {
      const system = createNotificationSystem(mockBridge, mockStorage, {
        defaultDuration: 5,
      });
      system.push(makeNotification("1"));
      expect(system.isVisible).toBe(true);

      // Wall clock moves past the duration WITHOUT running fake timers —
      // simulates the setTimeout having been throttled away rather than
      // firing on schedule.
      vi.setSystemTime(Date.now() + 6000);

      system.checkTimeoutElapsed();
      // Dismissal archives to history first (an awaited storage.set()), so
      // the state commit lands a microtask later than this call returns —
      // same as every other dispatch()-driven method here.
      await Promise.resolve();
      await Promise.resolve();

      expect(system.isVisible).toBe(false);
    });

    it("is a no-op when not overdue", () => {
      const system = createNotificationSystem(mockBridge, mockStorage, {
        defaultDuration: 5,
      });
      system.push(makeNotification("1"));

      vi.setSystemTime(Date.now() + 2000);
      system.checkTimeoutElapsed();

      expect(system.isVisible).toBe(true);
    });

    it("is a no-op when idle (no timer running)", () => {
      const system = createNotificationSystem(mockBridge, mockStorage);
      expect(() => system.checkTimeoutElapsed()).not.toThrow();
      expect(system.isVisible).toBe(false);
    });

    it("does not re-dismiss after a manual swipe-dismiss already cleared the timer", async () => {
      const system = createNotificationSystem(mockBridge, mockStorage, {
        defaultDuration: 5,
      });
      system.push(makeNotification("1"));
      system.push(makeNotification("2"));
      system.handleSwipeDismiss(); // advances to "2", starts a fresh timer
      await Promise.resolve();
      await Promise.resolve();

      vi.setSystemTime(Date.now() + 100);
      system.checkTimeoutElapsed();
      await Promise.resolve();
      await Promise.resolve();

      // "2" hasn't been up anywhere near 5s yet, so it must still be showing.
      expect(system.isVisible).toBe(true);
      const calls = mockBridge.textContainerUpgrade.mock.calls;
      expect(calls[calls.length - 1][0].content).toBe("Notification 2");
    });
  });

  it("advances to the next queued notification after auto-dismiss", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage, {
      defaultDuration: 5,
    });

    system.push(makeNotification("1"));
    system.push(makeNotification("2"));

    await vi.advanceTimersByTimeAsync(5000);

    expect(system.isVisible).toBe(true);
    const calls = mockBridge.textContainerUpgrade.mock.calls;
    expect(calls[calls.length - 1][0].content).toBe("Notification 2");
  });

  it("tap expands a visible banner instead of dismissing it", () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    system.push(makeNotification("1", "Full text goes here"));

    system.handleTap();

    expect(system.isVisible).toBe(true);
    const calls = mockBridge.textContainerUpgrade.mock.calls;
    expect(calls[calls.length - 1][0].content).toContain("Full text goes here");
  });

  it("tap on an expanded view dismisses it and archives to history", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    system.push(makeNotification("1"));
    system.handleTap(); // expand

    system.handleTap(); // dismiss the expanded view
    await vi.advanceTimersByTimeAsync(0);

    expect(system.isVisible).toBe(false);
    expect(mockStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.NOTIFICATION_HISTORY,
      { entries: [expect.objectContaining({ id: "1" })] },
    );
  });

  it("swipe dismisses a visible banner immediately without expanding", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    system.push(makeNotification("1"));

    system.handleSwipeDismiss();
    await vi.advanceTimersByTimeAsync(0);

    expect(system.isVisible).toBe(false);
    expect(mockStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.NOTIFICATION_HISTORY,
      { entries: [expect.objectContaining({ id: "1" })] },
    );
  });

  it("dismiss() (the legacy BannerSystem-compatible surface) archives and advances the queue", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));
    system.push(makeNotification("2"));
    system.push(makeNotification("3"));

    system.dismiss();
    await vi.advanceTimersByTimeAsync(0);
    expect(system.isVisible).toBe(true);
    let calls = mockBridge.textContainerUpgrade.mock.calls;
    expect(calls[calls.length - 1][0].content).toBe("Notification 2");

    system.dismiss();
    await vi.advanceTimersByTimeAsync(0);
    expect(system.isVisible).toBe(true);
    calls = mockBridge.textContainerUpgrade.mock.calls;
    expect(calls[calls.length - 1][0].content).toBe("Notification 3");

    system.dismiss();
    await vi.advanceTimersByTimeAsync(0);
    expect(system.isVisible).toBe(false);
  });

  it("truncates banner text exceeding 50 characters before display", () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    const longText = "a".repeat(60);

    system.push(makeNotification("1", longText));

    const call = mockBridge.textContainerUpgrade.mock.calls[0][0];
    expect(call.content.length).toBe(50);
    expect(call.content.endsWith("...")).toBe(true);
  });

  it("reads the framework banner duration from storage and clamps to [3, 15]", async () => {
    mockStorage.get.mockImplementation((key: string) =>
      key === STORAGE_KEYS.BANNER_CONFIG
        ? { displayDurationSeconds: 10 }
        : null,
    );
    const system = createNotificationSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));

    await vi.advanceTimersByTimeAsync(5000);
    expect(system.isVisible).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(system.isVisible).toBe(false);
  });

  it("passes an explicit per-notification duration through unclamped", async () => {
    // SmarterEveryday's popup duration (10-120s) legitimately exceeds the
    // framework banner bounds — see resolveDurationSeconds's docstring.
    const system = createNotificationSystem(mockBridge, mockStorage);

    system.push({ ...makeNotification("1"), duration: 60 });

    await vi.advanceTimersByTimeAsync(15000);
    expect(system.isVisible).toBe(true);

    await vi.advanceTimersByTimeAsync(45000);
    expect(system.isVisible).toBe(false);
  });

  it("uses the dedicated banner container", () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    system.push(makeNotification("1"));

    const call = mockBridge.textContainerUpgrade.mock.calls[0][0];
    expect(call.containerID).toBe(CONTAINER.BANNER);
    expect(call.containerName).toBe(CONTAINER_NAME.BANNER);
  });

  it("defaults to 5 seconds when no config exists", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));

    await vi.advanceTimersByTimeAsync(4999);
    expect(system.isVisible).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(system.isVisible).toBe(false);
  });

  it("fires onVisibilityChange when a banner appears and when it clears", async () => {
    const onVisibilityChange = vi.fn();
    const system = createNotificationSystem(mockBridge, mockStorage, {
      onVisibilityChange,
    });

    system.push(makeNotification("1"));
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true);

    system.handleSwipeDismiss();
    await vi.advanceTimersByTimeAsync(0);

    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  });

  it("opens the Notification_Center and navigates/closes it", () => {
    const system = createNotificationSystem(mockBridge, mockStorage);

    system.openCenter();
    expect(system.isCenterVisible).toBe(true);

    system.handleCenterClose();
    expect(system.isCenterVisible).toBe(false);
  });

  it("dispose() cancels the pending auto-dismiss timer", async () => {
    const system = createNotificationSystem(mockBridge, mockStorage);
    system.push(makeNotification("1"));

    system.dispose();

    // If the timer were still pending, this would have fired
    // "duration-elapsed" and flipped isVisible to false.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(system.isVisible).toBe(true);
  });
});
