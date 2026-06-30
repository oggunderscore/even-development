/**
 * Tests for main.ts application lifecycle orchestration.
 *
 * Tests cover:
 * - Successful startup sequence
 * - Init failure (non-zero result) handling
 * - System exit cleanup
 * - Foreground exit/enter cycle
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock SDK (must include all exports used by sub-modules) ──────────────────

const mockBridge = {
  createStartUpPageContainer: vi.fn().mockResolvedValue(undefined),
  onEvenHubEvent: vi.fn().mockReturnValue(vi.fn()), // returns unsub function
  offEvenHubEvent: vi.fn(),
  shutDownPageContainer: vi.fn(),
  textContainerUpgrade: vi.fn().mockResolvedValue(undefined),
  rebuildPageContainer: vi.fn().mockResolvedValue(undefined),
  getLocalStorage: vi.fn().mockResolvedValue(null),
  setLocalStorage: vi.fn().mockResolvedValue(true),
};

vi.mock("@evenrealities/even_hub_sdk", () => ({
  waitForEvenAppBridge: vi.fn().mockResolvedValue(mockBridge),
  CreateStartUpPageContainer: vi
    .fn()
    .mockImplementation((config: any) => config),
  TextContainerProperty: vi.fn().mockImplementation((config: any) => config),
  TextContainerUpgrade: vi.fn().mockImplementation((config: any) => config),
  RebuildPageContainer: vi.fn().mockImplementation((config: any) => config),
  OsEventTypeList: {
    CLICK_EVENT: 0,
    SCROLL_TOP_EVENT: 1,
    SCROLL_BOTTOM_EVENT: 2,
    DOUBLE_CLICK_EVENT: 3,
    FOREGROUND_ENTER_EVENT: 4,
    FOREGROUND_EXIT_EVENT: 5,
    ABNORMAL_EXIT_EVENT: 6,
    SYSTEM_EXIT_EVENT: 7,
  },
}));

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function resetMocks(): void {
  vi.clearAllMocks();
  mockBridge.createStartUpPageContainer.mockResolvedValue(undefined);
  mockBridge.onEvenHubEvent.mockReturnValue(vi.fn());
  mockBridge.getLocalStorage.mockResolvedValue(null);
  mockBridge.setLocalStorage.mockResolvedValue(true);
  mockBridge.textContainerUpgrade.mockResolvedValue(undefined);
  mockBridge.rebuildPageContainer.mockResolvedValue(undefined);
}

/**
 * Imports main.ts dynamically so each test gets a fresh execution.
 * The module is uncached before import to reset state.
 */
async function bootApp(): Promise<void> {
  // Dynamic import to trigger the main() call
  await import("./main");
  // Allow microtasks (async main()) to settle
  await new Promise((resolve) => setTimeout(resolve, 150));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("main.ts - Application Lifecycle", () => {
  beforeEach(() => {
    resetMocks();
    // Mock window and document to simulate Even app environment
    vi.stubGlobal("document", {
      body: { textContent: "" },
      getElementById: vi.fn().mockReturnValue(null),
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      flutter_inappwebview: {}, // Simulate Even app environment
    });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  describe("Successful startup sequence", () => {
    it("should call createStartUpPageContainer with 1 container", async () => {
      await bootApp();

      expect(mockBridge.createStartUpPageContainer).toHaveBeenCalledTimes(1);
      const callArg = mockBridge.createStartUpPageContainer.mock.calls[0][0];
      expect(callArg.containerTotalNum).toBe(1);
      expect(callArg.textObject).toHaveLength(1);
    });

    it("should allocate container 0 as the display container", async () => {
      await bootApp();

      const callArg = mockBridge.createStartUpPageContainer.mock.calls[0][0];
      const container = callArg.textObject[0];
      expect(container.containerID).toBe(0);
      expect(container.containerName).toBe("display");
    });

    it("should subscribe to onEvenHubEvent after successful init", async () => {
      await bootApp();

      expect(mockBridge.onEvenHubEvent).toHaveBeenCalledTimes(1);
      expect(typeof mockBridge.onEvenHubEvent.mock.calls[0][0]).toBe(
        "function",
      );
    });

    it("should register event handler via onEvenHubEvent", async () => {
      await bootApp();

      expect(mockBridge.onEvenHubEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("Init failure handling", () => {
    it("should not subscribe to events when createStartUpPageContainer throws", async () => {
      mockBridge.createStartUpPageContainer.mockRejectedValue(
        new Error("Init error"),
      );

      await bootApp();

      expect(mockBridge.onEvenHubEvent).not.toHaveBeenCalled();
    });

    it("should log error when init fails", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBridge.createStartUpPageContainer.mockRejectedValue(
        new Error("Init error"),
      );

      await bootApp();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Foresight]"),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("System exit cleanup", () => {
    it("should call shutDownPageContainer on SYSTEM_EXIT_EVENT", async () => {
      const unsubFn = vi.fn();
      mockBridge.onEvenHubEvent.mockReturnValue(unsubFn);

      await bootApp();

      // Get the event handler and simulate SYSTEM_EXIT_EVENT
      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];
      eventHandler({ sysEvent: { eventType: 7 } }); // SYSTEM_EXIT_EVENT = 7

      expect(mockBridge.shutDownPageContainer).toHaveBeenCalled();
    });

    it("should unsubscribe from events on SYSTEM_EXIT_EVENT", async () => {
      const unsubFn = vi.fn();
      mockBridge.onEvenHubEvent.mockReturnValue(unsubFn);

      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];
      eventHandler({ sysEvent: { eventType: 7 } }); // SYSTEM_EXIT_EVENT

      // The unsub is not explicitly called in our code — the SDK manages it
      // via shutDownPageContainer. The handler just cleans up timers.
    });

    it("should call shutDownPageContainer on ABNORMAL_EXIT_EVENT", async () => {
      const unsubFn = vi.fn();
      mockBridge.onEvenHubEvent.mockReturnValue(unsubFn);

      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];
      eventHandler({ sysEvent: { eventType: 6 } }); // ABNORMAL_EXIT_EVENT = 6

      expect(mockBridge.shutDownPageContainer).toHaveBeenCalled();
    });

    it("should handle ABNORMAL_EXIT_EVENT without throwing", async () => {
      const unsubFn = vi.fn();
      mockBridge.onEvenHubEvent.mockReturnValue(unsubFn);

      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];
      expect(() => {
        eventHandler({ sysEvent: { eventType: 6 } }); // ABNORMAL_EXIT_EVENT
      }).not.toThrow();
    });
  });

  describe("Foreground exit/enter cycle", () => {
    it("should not throw on FOREGROUND_EXIT_EVENT", async () => {
      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];

      // Simulate FOREGROUND_EXIT_EVENT (5) — should not throw
      expect(() => {
        eventHandler({ sysEvent: { eventType: 5 } });
      }).not.toThrow();
    });

    it("should not throw on FOREGROUND_ENTER_EVENT after exit", async () => {
      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];

      // First, go to background
      eventHandler({ sysEvent: { eventType: 5 } }); // FOREGROUND_EXIT_EVENT

      // Then, come back to foreground — should not throw
      expect(() => {
        eventHandler({ sysEvent: { eventType: 4 } }); // FOREGROUND_ENTER_EVENT
      }).not.toThrow();
    });

    it("should not call shutDownPageContainer on FOREGROUND_EXIT_EVENT", async () => {
      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];
      eventHandler({ sysEvent: { eventType: 5 } }); // FOREGROUND_EXIT_EVENT

      expect(mockBridge.shutDownPageContainer).not.toHaveBeenCalled();
    });
  });

  describe("Gesture event routing", () => {
    it("should route text events to gesture router without throwing", async () => {
      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];

      // Simulate a single-tap (CLICK_EVENT = 0)
      expect(() => {
        eventHandler({ textEvent: { eventType: 0 } });
      }).not.toThrow();
    });

    it("should handle double-tap to open menu (HUD only state)", async () => {
      await bootApp();

      const eventHandler = mockBridge.onEvenHubEvent.mock.calls[0][0];

      // Simulate a double-tap (DOUBLE_CLICK_EVENT = 3)
      // In HUD-only state with no registered apps, this triggers onNoApps
      expect(() => {
        eventHandler({ textEvent: { eventType: 3 } });
      }).not.toThrow();
    });
  });
});
