/**
 * Integration tests for home-screen main.ts wiring.
 *
 * These tests verify the end-to-end integration of the Scheduler,
 * NotificationSystem, and gesture routing through the home-screen,
 * complementing the unit-level tests in `home-screen.test.ts`.
 *
 * Validates: Requirements 2.5, 7.1, 9.9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHomeScreen } from "./home-screen";
import { STORAGE_KEYS } from "../storage/schemas";
import {
  createFakeStorage,
  type FakeStorage,
} from "../storage/storage-manager.test-utils";
import { CONTAINER, SCHEDULER_TICK_INTERVAL_MS } from "../constants";

// Mock the LLM client module so we can make SmarterEveryday's content
// generator actually succeed (the real placeholder always rejects).
vi.mock("../smarter-everyday/llm-client", () => ({
  createPlaceholderLlmClient: () => ({
    generate: vi
      .fn()
      .mockResolvedValue("The mitochondria is the powerhouse of the cell"),
  }),
}));

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

describe("home-screen integration", () => {
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

  describe("Scheduler independence (Requirement 2.5)", () => {
    it("ticks and delivers independently of whether SmarterEveryday SubApp is activated", async () => {
      // The Scheduler is booted in `start()` alongside HudManager/MenuSystem,
      // NOT inside SubApp.activate(). Content_Delivery fires on a timer loop
      // regardless of whether the sub-app is currently on screen.
      storage.seed(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS, {
        topics: [
          {
            id: "t1",
            description: "Biology basics",
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
      // An LLM provider must be configured for delivery to succeed.
      storage.seed(STORAGE_KEYS.ASSISTANT_CONFIG, {
        llmProvider: "anthropic",
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      // The sub-app is never opened from the menu — it stays inactive.
      // Advance past the scheduler tick interval.
      await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_INTERVAL_MS + 1000);

      // The scheduler ticked, delivery was attempted, and `lastDeliveryAt`
      // was updated — proving the scheduler runs independently of the SubApp
      // lifecycle.
      const topics = storage.get<{ topics: Array<Record<string, unknown>> }>(
        STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      );
      expect(topics?.topics[0]?.lastDeliveryAt).not.toBeNull();

      // The sub-app container was never drawn into (it was never activated).
      expect(latest(bridge, CONTAINER.SUBAPP) ?? "").toBe("");

      home.dispose();
    });
  });

  describe("SmarterEveryday push → banner (Requirement 7.1)", () => {
    it("delivers content through the NotificationSystem and appears as a banner", async () => {
      // With the mocked LLM client returning real content, a scheduled
      // Content_Delivery should push a notification through the
      // NotificationSystem, which renders it as a banner via
      // bridge.textContainerUpgrade on the BANNER container.
      storage.seed(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS, {
        topics: [
          {
            id: "t1",
            description: "Biology basics",
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
      storage.seed(STORAGE_KEYS.ASSISTANT_CONFIG, {
        llmProvider: "openai",
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      // Advance past the scheduler tick interval so the content generator fires.
      await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_INTERVAL_MS + 1000);

      // The mocked LLM returns "The mitochondria is the powerhouse of the cell".
      // The notification push path formats it as:
      //   `${topicDescription}: ${content}`
      // and the banner truncates to BANNER_MAX_TEXT_LENGTH (50 chars).
      const bannerContent = latest(bridge, CONTAINER.BANNER);
      expect(bannerContent).toBeDefined();
      expect(bannerContent).toContain("Biology basics");
      // The content may be truncated but should contain at least the start.
      expect(bannerContent).toContain("mitochondria");

      home.dispose();
    });

    it("the banner shows the correctly formatted SmarterEveryday notification text", async () => {
      storage.seed(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS, {
        topics: [
          {
            id: "t2",
            description: "Fun facts",
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
      storage.seed(STORAGE_KEYS.ASSISTANT_CONFIG, {
        llmProvider: "anthropic",
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_INTERVAL_MS + 1000);

      // The banner container was written to.
      const bannerContent = latest(bridge, CONTAINER.BANNER);
      expect(bannerContent).toBeDefined();
      // Format is "topicDescription: content", truncated to 50 chars.
      // "Fun facts: The mitochondria is the powerhouse..." (truncated)
      expect(bannerContent!.startsWith("Fun facts:")).toBe(true);

      home.dispose();
    });
  });

  describe("Hold gesture → notification-center-hold (Requirement 9.9)", () => {
    it("Hold gesture reaches notification-center-hold when Notification_Center is open", async () => {
      // Seed notification history so the center has something to display.
      storage.seed(STORAGE_KEYS.NOTIFICATION_HISTORY, {
        entries: [
          {
            id: "h1",
            sourceAppId: "tasks",
            sourceAppName: "Tasks",
            text: "Remember to stretch",
            timestamp: 1_700_000_000_000,
          },
          {
            id: "h2",
            sourceAppId: "smarter-everyday",
            sourceAppName: "SmarterEveryday",
            text: "Mitochondria fact",
            timestamp: 1_700_000_001_000,
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      // Open the Notification Center via swipe-down from idle HUD.
      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);

      // Verify the center is open (menu container shows notification entries).
      expect(latest(bridge, CONTAINER.MENU)).toContain("Mitochondria fact");

      // A Hold gesture while the center is open should trigger the
      // confirm-clear prompt (Requirement 9.9).
      home.handleHold();
      await vi.advanceTimersByTimeAsync(0);

      const menuContent = latest(bridge, CONTAINER.MENU)!;
      expect(menuContent).toContain("Clear all");
      expect(menuContent).toContain("Tap to confirm");

      home.dispose();
    });

    it("transitions to center-confirm-clear phase on Hold", async () => {
      storage.seed(STORAGE_KEYS.NOTIFICATION_HISTORY, {
        entries: [
          {
            id: "h1",
            sourceAppId: "tasks",
            sourceAppName: "Tasks",
            text: "Test entry",
            timestamp: Date.now(),
          },
        ],
      });

      const home = createHomeScreen({ bridge: bridge as any, storage });
      await home.start();

      // Open the Notification Center.
      home.handleScrollDown();
      await vi.advanceTimersByTimeAsync(0);

      // Hold should trigger the confirm-clear prompt.
      home.handleHold();
      await vi.advanceTimersByTimeAsync(0);

      // Confirm the clear by tapping.
      home.handleTap();
      await vi.advanceTimersByTimeAsync(0);

      // History should be cleared.
      const history = storage.get<{ entries: unknown[] }>(
        STORAGE_KEYS.NOTIFICATION_HISTORY,
      );
      expect(history?.entries).toEqual([]);

      // The center shows the empty state.
      expect(latest(bridge, CONTAINER.MENU)).toBe(
        "NOTIFICATIONS\nNo notifications",
      );

      home.dispose();
    });
  });
});
