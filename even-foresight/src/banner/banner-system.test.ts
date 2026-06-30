import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  truncateBannerText,
  processQueue,
  processAfterDismiss,
  clampDuration,
  createBannerSystem,
} from "./banner-system";
import type { BannerNotification } from "./types";

// === Pure function tests ===

describe("truncateBannerText", () => {
  it("returns text unchanged when <= 50 chars", () => {
    const text = "Hello World";
    expect(truncateBannerText(text)).toBe("Hello World");
  });

  it("returns text unchanged when exactly 50 chars", () => {
    const text = "a".repeat(50);
    expect(truncateBannerText(text)).toBe(text);
  });

  it("truncates text > 50 chars with ellipsis", () => {
    const text = "a".repeat(60);
    const result = truncateBannerText(text);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
    expect(result).toBe("a".repeat(47) + "...");
  });

  it("handles empty string", () => {
    expect(truncateBannerText("")).toBe("");
  });
});

describe("processQueue", () => {
  const makeNotification = (id: string): BannerNotification => ({
    id,
    text: `Notification ${id}`,
    timestamp: Date.now(),
  });

  it("appends to queue when less than 5 items", () => {
    const queue = [makeNotification("1"), makeNotification("2")];
    const newNotif = makeNotification("3");
    const result = processQueue(queue, newNotif);
    expect(result).toHaveLength(3);
    expect(result[2].id).toBe("3");
  });

  it("appends to empty queue", () => {
    const result = processQueue([], makeNotification("1"));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("drops oldest when queue has 5 items", () => {
    const queue = [
      makeNotification("1"),
      makeNotification("2"),
      makeNotification("3"),
      makeNotification("4"),
      makeNotification("5"),
    ];
    const newNotif = makeNotification("6");
    const result = processQueue(queue, newNotif);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe("2"); // oldest (1) dropped
    expect(result[4].id).toBe("6"); // new appended
  });

  it("does not mutate original queue", () => {
    const queue = [makeNotification("1"), makeNotification("2")];
    const original = [...queue];
    processQueue(queue, makeNotification("3"));
    expect(queue).toEqual(original);
  });
});

describe("processAfterDismiss", () => {
  const makeNotification = (id: string): BannerNotification => ({
    id,
    text: `Notification ${id}`,
    timestamp: Date.now(),
  });

  it("returns null active and empty queue when queue is empty", () => {
    const result = processAfterDismiss([]);
    expect(result.active).toBeNull();
    expect(result.remainingQueue).toEqual([]);
  });

  it("dequeues first item as active when queue has items", () => {
    const queue = [
      makeNotification("1"),
      makeNotification("2"),
      makeNotification("3"),
    ];
    const result = processAfterDismiss(queue);
    expect(result.active?.id).toBe("1");
    expect(result.remainingQueue).toHaveLength(2);
    expect(result.remainingQueue[0].id).toBe("2");
    expect(result.remainingQueue[1].id).toBe("3");
  });

  it("dequeues single item correctly", () => {
    const queue = [makeNotification("1")];
    const result = processAfterDismiss(queue);
    expect(result.active?.id).toBe("1");
    expect(result.remainingQueue).toEqual([]);
  });
});

describe("clampDuration", () => {
  it("returns value when within range [3, 15]", () => {
    expect(clampDuration(5)).toBe(5);
    expect(clampDuration(3)).toBe(3);
    expect(clampDuration(15)).toBe(15);
  });

  it("clamps below minimum to 3", () => {
    expect(clampDuration(1)).toBe(3);
    expect(clampDuration(0)).toBe(3);
    expect(clampDuration(-5)).toBe(3);
  });

  it("clamps above maximum to 15", () => {
    expect(clampDuration(16)).toBe(15);
    expect(clampDuration(100)).toBe(15);
  });
});

// === BannerSystem integration tests ===

describe("createBannerSystem", () => {
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
  ): BannerNotification => ({
    id,
    text,
    timestamp: Date.now(),
  });

  it("displays immediately when no banner is active", () => {
    const system = createBannerSystem(mockBridge, mockStorage);
    expect(system.isVisible).toBe(false);

    system.push(makeNotification("1"));

    expect(system.isVisible).toBe(true);
    expect(mockBridge.textContainerUpgrade).toHaveBeenCalledTimes(1);
    const call = mockBridge.textContainerUpgrade.mock.calls[0][0];
    expect(call.containerID).toBe(0);
    expect(call.content).toBe("Notification 1");
  });

  it("queues notification when banner is already active", () => {
    const system = createBannerSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));
    system.push(makeNotification("2"));

    // Only one display call (for the first notification)
    expect(mockBridge.textContainerUpgrade).toHaveBeenCalledTimes(1);
    expect(system.isVisible).toBe(true);
  });

  it("drops oldest from queue on overflow (queue > 5)", () => {
    const system = createBannerSystem(mockBridge, mockStorage);

    // First notification is displayed immediately (not queued)
    system.push(makeNotification("active"));

    // Fill queue to 5
    system.push(makeNotification("1"));
    system.push(makeNotification("2"));
    system.push(makeNotification("3"));
    system.push(makeNotification("4"));
    system.push(makeNotification("5"));

    // Overflow: push 6th queued item, should drop "1"
    system.push(makeNotification("6"));

    // Dismiss active → next should be "2" (since "1" was dropped)
    system.dismiss();

    // The display call for the next banner
    const calls = mockBridge.textContainerUpgrade.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.content).toBe("Notification 2");
  });

  it("auto-dismisses on timer expiry", () => {
    const system = createBannerSystem(mockBridge, mockStorage, {
      defaultDuration: 5,
    });

    system.push(makeNotification("1"));
    expect(system.isVisible).toBe(true);

    // Advance past the 5-second duration
    vi.advanceTimersByTime(5000);

    expect(system.isVisible).toBe(false);
  });

  it("processes next in queue after auto-dismiss", () => {
    const system = createBannerSystem(mockBridge, mockStorage, {
      defaultDuration: 5,
    });

    system.push(makeNotification("1"));
    system.push(makeNotification("2"));

    // Advance past the 5-second duration
    vi.advanceTimersByTime(5000);

    // Should still be visible (showing "2" now)
    expect(system.isVisible).toBe(true);
    const calls = mockBridge.textContainerUpgrade.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.content).toBe("Notification 2");
  });

  it("manual dismiss processes next in queue", () => {
    const system = createBannerSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));
    system.push(makeNotification("2"));
    system.push(makeNotification("3"));

    // Dismiss first
    system.dismiss();
    expect(system.isVisible).toBe(true);
    let calls = mockBridge.textContainerUpgrade.mock.calls;
    expect(calls[calls.length - 1][0].content).toBe("Notification 2");

    // Dismiss second
    system.dismiss();
    expect(system.isVisible).toBe(true);
    calls = mockBridge.textContainerUpgrade.mock.calls;
    expect(calls[calls.length - 1][0].content).toBe("Notification 3");

    // Dismiss third — queue empty, should hide
    system.dismiss();
    expect(system.isVisible).toBe(false);
  });

  it("truncates text exceeding 50 characters before display", () => {
    const system = createBannerSystem(mockBridge, mockStorage);
    const longText = "a".repeat(60);

    system.push(makeNotification("1", longText));

    const call = mockBridge.textContainerUpgrade.mock.calls[0][0];
    expect(call.content.length).toBe(50);
    expect(call.content.endsWith("...")).toBe(true);
  });

  it("reads duration from storage config and clamps to [3, 15]", () => {
    // Config says 10 seconds
    mockStorage.get.mockReturnValue({ displayDurationSeconds: 10 });
    const system = createBannerSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));
    expect(system.isVisible).toBe(true);

    // Should NOT dismiss at 5 seconds (default)
    vi.advanceTimersByTime(5000);
    expect(system.isVisible).toBe(true);

    // Should dismiss at 10 seconds
    vi.advanceTimersByTime(5000);
    expect(system.isVisible).toBe(false);
  });

  it("clamps duration below minimum to 3 seconds", () => {
    mockStorage.get.mockReturnValue({ displayDurationSeconds: 1 });
    const system = createBannerSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));

    // Should NOT dismiss at 1 second
    vi.advanceTimersByTime(1000);
    expect(system.isVisible).toBe(true);

    // Should dismiss at 3 seconds (clamped minimum)
    vi.advanceTimersByTime(2000);
    expect(system.isVisible).toBe(false);
  });

  it("clamps duration above maximum to 15 seconds", () => {
    mockStorage.get.mockReturnValue({ displayDurationSeconds: 30 });
    const system = createBannerSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));

    // Should NOT dismiss at 15.5 seconds
    vi.advanceTimersByTime(14999);
    expect(system.isVisible).toBe(true);

    // Should dismiss at 15 seconds (clamped maximum)
    vi.advanceTimersByTime(1);
    expect(system.isVisible).toBe(false);
  });

  it("uses per-notification duration when provided", () => {
    const system = createBannerSystem(mockBridge, mockStorage, {
      defaultDuration: 5,
    });

    const notification: BannerNotification = {
      id: "1",
      text: "Custom duration",
      duration: 10,
      timestamp: Date.now(),
    };
    system.push(notification);

    // Should NOT dismiss at 5 seconds
    vi.advanceTimersByTime(5000);
    expect(system.isVisible).toBe(true);

    // Should dismiss at 10 seconds
    vi.advanceTimersByTime(5000);
    expect(system.isVisible).toBe(false);
  });

  it("uses container 0 for banner overlay", () => {
    const system = createBannerSystem(mockBridge, mockStorage);
    system.push(makeNotification("1"));

    const call = mockBridge.textContainerUpgrade.mock.calls[0][0];
    expect(call.containerID).toBe(0);
    expect(call.containerName).toBe("display");
  });

  it("defaults to 5 seconds when no config exists", () => {
    mockStorage.get.mockReturnValue(null);
    const system = createBannerSystem(mockBridge, mockStorage);

    system.push(makeNotification("1"));

    // Should NOT dismiss at 4.9 seconds
    vi.advanceTimersByTime(4999);
    expect(system.isVisible).toBe(true);

    // Should dismiss at 5 seconds
    vi.advanceTimersByTime(1);
    expect(system.isVisible).toBe(false);
  });
});
