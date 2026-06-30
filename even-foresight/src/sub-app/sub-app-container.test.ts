import { describe, it, expect, vi } from "vitest";
import { createSubAppContainer, EvenAppBridge } from "./sub-app-container";
import { SubApp, SubAppContext, GestureEvent } from "./types";

function createMockBridge(): EvenAppBridge {
  return {
    rebuildPageContainer: vi.fn().mockResolvedValue(undefined),
    textContainerUpgrade: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSubApp(overrides?: Partial<SubApp>): SubApp {
  return {
    id: "test-app",
    name: "Test App",
    activate: vi.fn().mockResolvedValue(undefined),
    handleGesture: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createSubAppContainer", () => {
  describe("activate", () => {
    it("activates a sub-app and sets it as activeApp", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);

      expect(container.activeApp).toBe(app);
      expect(app.activate).toHaveBeenCalledOnce();
    });

    it("passes SubAppContext with correct dimensions to sub-app", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      let receivedContext: SubAppContext | null = null;

      const app = createMockSubApp({
        activate: vi.fn(async (ctx: SubAppContext) => {
          receivedContext = ctx;
        }),
      });

      await container.activate(app);

      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.width).toBe(576);
      expect(receivedContext!.height).toBe(173);
      expect(receivedContext!.yOffset).toBe(115);
    });

    it("deactivates previous app before activating new one", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app1 = createMockSubApp({ id: "app-1" });
      const app2 = createMockSubApp({ id: "app-2" });

      await container.activate(app1);
      await container.activate(app2);

      expect(app1.cleanup).toHaveBeenCalledOnce();
      expect(container.activeApp).toBe(app2);
    });

    it("provides updateContent that calls bridge.textContainerUpgrade", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      let receivedContext: SubAppContext | null = null;

      const app = createMockSubApp({
        activate: vi.fn(async (ctx: SubAppContext) => {
          receivedContext = ctx;
        }),
      });

      await container.activate(app);
      await receivedContext!.updateContent(0, "Hello");

      expect(bridge.textContainerUpgrade).toHaveBeenCalledWith(0, "Hello");
    });

    it("provides requestContainers that returns container IDs starting from 0", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      let receivedContext: SubAppContext | null = null;

      const app = createMockSubApp({
        activate: vi.fn(async (ctx: SubAppContext) => {
          receivedContext = ctx;
        }),
      });

      await container.activate(app);
      const containers = receivedContext!.requestContainers(3);

      expect(containers).toEqual([0, 1, 2]);
    });
  });

  describe("deactivate", () => {
    it("calls cleanup on active app and sets activeApp to null", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);
      await container.deactivate();

      expect(app.cleanup).toHaveBeenCalledOnce();
      expect(container.activeApp).toBeNull();
    });

    it("does nothing when no app is active", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);

      // Should not throw
      await container.deactivate();
      expect(container.activeApp).toBeNull();
    });

    it("force-releases when cleanup exceeds 1 second timeout", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);

      const app = createMockSubApp({
        cleanup: vi.fn(
          (): Promise<void> =>
            new Promise((resolve) => setTimeout(resolve, 5000)),
        ),
      });

      await container.activate(app);

      const start = Date.now();
      await container.deactivate();
      const elapsed = Date.now() - start;

      // Should have resolved within ~1 second (with some tolerance)
      expect(elapsed).toBeLessThan(1500);
      expect(container.activeApp).toBeNull();
    });

    it("force-releases when cleanup throws an error", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);

      const app = createMockSubApp({
        cleanup: vi.fn().mockRejectedValue(new Error("Cleanup failed")),
      });

      await container.activate(app);
      await container.deactivate();

      expect(container.activeApp).toBeNull();
    });
  });

  describe("handleGesture", () => {
    it("forwards single-tap to active sub-app", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);

      const event: GestureEvent = { type: "single-tap", timestamp: 1000 };
      container.handleGesture(event);

      expect(app.handleGesture).toHaveBeenCalledWith(event);
    });

    it("forwards swipe-up to active sub-app", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);

      const event: GestureEvent = { type: "swipe-up", timestamp: 1000 };
      container.handleGesture(event);

      expect(app.handleGesture).toHaveBeenCalledWith(event);
    });

    it("forwards swipe-down to active sub-app", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);

      const event: GestureEvent = { type: "swipe-down", timestamp: 1000 };
      container.handleGesture(event);

      expect(app.handleGesture).toHaveBeenCalledWith(event);
    });

    it("intercepts double-tap and does NOT forward to sub-app", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);

      const event: GestureEvent = { type: "double-tap", timestamp: 1000 };
      container.handleGesture(event);

      expect(app.handleGesture).not.toHaveBeenCalled();
    });

    it("does nothing when no app is active", () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);

      // Should not throw
      const event: GestureEvent = { type: "single-tap", timestamp: 1000 };
      container.handleGesture(event);
    });
  });

  describe("activeApp", () => {
    it("is null initially", () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      expect(container.activeApp).toBeNull();
    });

    it("reflects the currently active app", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);
      expect(container.activeApp).toBe(app);
    });

    it("is null after deactivation", async () => {
      const bridge = createMockBridge();
      const container = createSubAppContainer(bridge);
      const app = createMockSubApp();

      await container.activate(app);
      await container.deactivate();
      expect(container.activeApp).toBeNull();
    });
  });
});
