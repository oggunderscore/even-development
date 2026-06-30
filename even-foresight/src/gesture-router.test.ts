import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shouldAcceptScroll,
  routeGesture,
  parseGestureEvent,
  createGestureRouter,
  type AppState,
  type GestureRouterDeps,
} from "./gesture-router";
import type { GestureType, GestureEvent } from "./sub-app/types";
import type { BannerSystem } from "./banner/types";
import type { MenuSystem } from "./menu/types";
import type { SubAppContainerInstance } from "./sub-app/sub-app-container";

// === Pure Function Tests: shouldAcceptScroll ===

describe("shouldAcceptScroll", () => {
  it("accepts when difference is exactly 300ms", () => {
    expect(shouldAcceptScroll(1000, 1300)).toBe(true);
  });

  it("accepts when difference is greater than 300ms", () => {
    expect(shouldAcceptScroll(1000, 1500)).toBe(true);
  });

  it("rejects when difference is less than 300ms", () => {
    expect(shouldAcceptScroll(1000, 1299)).toBe(false);
  });

  it("rejects when timestamps are equal", () => {
    expect(shouldAcceptScroll(1000, 1000)).toBe(false);
  });

  it("accepts when previous is 0 (first event)", () => {
    expect(shouldAcceptScroll(0, 300)).toBe(true);
  });
});

// === Pure Function Tests: routeGesture ===

describe("routeGesture", () => {
  describe("Priority 1: Banner visible + single-tap", () => {
    it("routes to banner-dismiss when banner visible and single-tap", () => {
      const state: AppState = {
        bannerVisible: true,
        menuVisible: false,
        subAppActive: false,
      };
      expect(routeGesture(state, "single-tap")).toEqual({
        target: "banner-dismiss",
      });
    });

    it("routes to banner-dismiss even if sub-app is active", () => {
      const state: AppState = {
        bannerVisible: true,
        menuVisible: false,
        subAppActive: true,
      };
      expect(routeGesture(state, "single-tap")).toEqual({
        target: "banner-dismiss",
      });
    });

    it("does NOT route to banner-dismiss on double-tap when banner visible", () => {
      const state: AppState = {
        bannerVisible: true,
        menuVisible: false,
        subAppActive: false,
      };
      // Double-tap with banner visible but no menu/sub-app → open-menu
      expect(routeGesture(state, "double-tap")).toEqual({
        target: "open-menu",
      });
    });
  });

  describe("Priority 2: Menu visible", () => {
    const menuState: AppState = {
      bannerVisible: false,
      menuVisible: true,
      subAppActive: false,
    };

    it("routes swipe-down to menu-nav", () => {
      expect(routeGesture(menuState, "swipe-down")).toEqual({
        target: "menu-nav",
      });
    });

    it("routes swipe-up to menu-nav", () => {
      expect(routeGesture(menuState, "swipe-up")).toEqual({
        target: "menu-nav",
      });
    });

    it("routes single-tap to menu-select", () => {
      expect(routeGesture(menuState, "single-tap")).toEqual({
        target: "menu-select",
      });
    });

    it("routes double-tap to menu-dismiss", () => {
      expect(routeGesture(menuState, "double-tap")).toEqual({
        target: "menu-dismiss",
      });
    });

    it("banner-dismiss takes priority over menu when banner visible + single-tap", () => {
      const state: AppState = {
        bannerVisible: true,
        menuVisible: true,
        subAppActive: false,
      };
      expect(routeGesture(state, "single-tap")).toEqual({
        target: "banner-dismiss",
      });
    });
  });

  describe("Priority 3 & 4: Sub-app active", () => {
    const subAppState: AppState = {
      bannerVisible: false,
      menuVisible: false,
      subAppActive: true,
    };

    it("routes double-tap to subapp-deactivate", () => {
      expect(routeGesture(subAppState, "double-tap")).toEqual({
        target: "subapp-deactivate",
      });
    });

    it("routes single-tap to subapp-forward", () => {
      expect(routeGesture(subAppState, "single-tap")).toEqual({
        target: "subapp-forward",
      });
    });

    it("routes swipe-up to subapp-forward", () => {
      expect(routeGesture(subAppState, "swipe-up")).toEqual({
        target: "subapp-forward",
      });
    });

    it("routes swipe-down to subapp-forward", () => {
      expect(routeGesture(subAppState, "swipe-down")).toEqual({
        target: "subapp-forward",
      });
    });
  });

  describe("Priority 5: HUD only + double-tap", () => {
    const hudState: AppState = {
      bannerVisible: false,
      menuVisible: false,
      subAppActive: false,
    };

    it("routes double-tap to open-menu", () => {
      expect(routeGesture(hudState, "double-tap")).toEqual({
        target: "open-menu",
      });
    });

    it("routes single-tap to none in HUD-only mode", () => {
      expect(routeGesture(hudState, "single-tap")).toEqual({ target: "none" });
    });

    it("routes swipe-up to none in HUD-only mode", () => {
      expect(routeGesture(hudState, "swipe-up")).toEqual({ target: "none" });
    });

    it("routes swipe-down to none in HUD-only mode", () => {
      expect(routeGesture(hudState, "swipe-down")).toEqual({ target: "none" });
    });
  });
});

// === parseGestureEvent ===

describe("parseGestureEvent", () => {
  it("parses single-tap", () => {
    const event = parseGestureEvent("single-tap");
    expect(event).not.toBeNull();
    expect(event!.type).toBe("single-tap");
    expect(event!.timestamp).toBeGreaterThan(0);
  });

  it("parses double-tap", () => {
    const event = parseGestureEvent("double-tap");
    expect(event).not.toBeNull();
    expect(event!.type).toBe("double-tap");
  });

  it("parses swipe-up", () => {
    const event = parseGestureEvent("swipe-up");
    expect(event).not.toBeNull();
    expect(event!.type).toBe("swipe-up");
  });

  it("parses swipe-down", () => {
    const event = parseGestureEvent("swipe-down");
    expect(event).not.toBeNull();
    expect(event!.type).toBe("swipe-down");
  });

  it("returns null for unrecognized event", () => {
    expect(parseGestureEvent("unknown-gesture")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGestureEvent("")).toBeNull();
  });
});

// === createGestureRouter (integration with mocked deps) ===

describe("createGestureRouter", () => {
  let bannerSystem: BannerSystem;
  let menuSystem: MenuSystem;
  let subAppContainer: SubAppContainerInstance;
  let onOpenMenu: ReturnType<typeof vi.fn>;
  let onDeactivateAndShowMenu: ReturnType<typeof vi.fn>;
  let deps: GestureRouterDeps;

  beforeEach(() => {
    bannerSystem = {
      push: vi.fn(),
      dismiss: vi.fn(),
      isVisible: false,
    };

    menuSystem = {
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      moveDown: vi.fn(),
      moveUp: vi.fn(),
      select: vi.fn().mockResolvedValue(undefined),
      isVisible: false,
    };

    subAppContainer = {
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
      handleGesture: vi.fn(),
      activeApp: null,
    };

    onOpenMenu = vi.fn().mockResolvedValue(undefined);
    onDeactivateAndShowMenu = vi.fn().mockResolvedValue(undefined);

    deps = {
      bannerSystem,
      menuSystem,
      subAppContainer,
      onOpenMenu,
      onDeactivateAndShowMenu,
    };
  });

  function makeEvent(type: GestureType, timestamp = 1000): GestureEvent {
    return { type, timestamp };
  }

  describe("banner dismiss routing", () => {
    it("dismisses banner on single-tap when banner is visible", () => {
      Object.defineProperty(bannerSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("single-tap"));

      expect(bannerSystem.dismiss).toHaveBeenCalledOnce();
    });

    it("does not forward to sub-app when banner dismisses on tap", () => {
      Object.defineProperty(bannerSystem, "isVisible", { value: true });
      Object.defineProperty(subAppContainer, "activeApp", {
        value: { id: "test" },
      });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("single-tap"));

      expect(bannerSystem.dismiss).toHaveBeenCalledOnce();
      expect(subAppContainer.handleGesture).not.toHaveBeenCalled();
    });
  });

  describe("menu routing", () => {
    it("calls moveDown on swipe-down when menu visible", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("swipe-down", 1000));

      expect(menuSystem.moveDown).toHaveBeenCalledOnce();
    });

    it("calls moveUp on swipe-up when menu visible", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("swipe-up", 1000));

      expect(menuSystem.moveUp).toHaveBeenCalledOnce();
    });

    it("calls select on single-tap when menu visible", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("single-tap"));

      expect(menuSystem.select).toHaveBeenCalledOnce();
    });

    it("calls hide on double-tap when menu visible", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("double-tap"));

      expect(menuSystem.hide).toHaveBeenCalledOnce();
    });
  });

  describe("scroll debounce in menu", () => {
    it("debounces swipe events within 300ms when menu visible", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      // First swipe accepted (previous=0, current=100; 100-0 >= 300 is false... need >=300)
      router.handleGesture(makeEvent("swipe-down", 300));
      expect(menuSystem.moveDown).toHaveBeenCalledTimes(1);

      // Second swipe within 300ms — should be debounced
      router.handleGesture(makeEvent("swipe-down", 500));
      expect(menuSystem.moveDown).toHaveBeenCalledTimes(1);
    });

    it("accepts swipe events after 300ms have passed", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("swipe-down", 300));
      expect(menuSystem.moveDown).toHaveBeenCalledTimes(1);

      // 300ms later — should be accepted
      router.handleGesture(makeEvent("swipe-down", 600));
      expect(menuSystem.moveDown).toHaveBeenCalledTimes(2);
    });

    it("does not debounce non-swipe events in menu", () => {
      Object.defineProperty(menuSystem, "isVisible", { value: true });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("single-tap", 100));
      router.handleGesture(makeEvent("single-tap", 150));

      expect(menuSystem.select).toHaveBeenCalledTimes(2);
    });

    it("does not debounce swipe events when menu is not visible", () => {
      Object.defineProperty(subAppContainer, "activeApp", {
        value: { id: "test" },
      });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("swipe-down", 100));
      router.handleGesture(makeEvent("swipe-down", 150));

      expect(subAppContainer.handleGesture).toHaveBeenCalledTimes(2);
    });
  });

  describe("sub-app routing", () => {
    it("calls onDeactivateAndShowMenu on double-tap when sub-app active", () => {
      Object.defineProperty(subAppContainer, "activeApp", {
        value: { id: "test" },
      });
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("double-tap"));

      expect(onDeactivateAndShowMenu).toHaveBeenCalledOnce();
    });

    it("forwards non-double-tap gestures to sub-app", () => {
      Object.defineProperty(subAppContainer, "activeApp", {
        value: { id: "test" },
      });
      const router = createGestureRouter(deps);

      const event = makeEvent("single-tap");
      router.handleGesture(event);

      expect(subAppContainer.handleGesture).toHaveBeenCalledWith(event);
    });

    it("forwards swipe-up to sub-app when active", () => {
      Object.defineProperty(subAppContainer, "activeApp", {
        value: { id: "test" },
      });
      const router = createGestureRouter(deps);

      const event = makeEvent("swipe-up");
      router.handleGesture(event);

      expect(subAppContainer.handleGesture).toHaveBeenCalledWith(event);
    });
  });

  describe("HUD-only routing", () => {
    it("calls onOpenMenu on double-tap in HUD-only mode", () => {
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("double-tap"));

      expect(onOpenMenu).toHaveBeenCalledOnce();
    });

    it("does nothing on single-tap in HUD-only mode", () => {
      const router = createGestureRouter(deps);

      router.handleGesture(makeEvent("single-tap"));

      expect(bannerSystem.dismiss).not.toHaveBeenCalled();
      expect(menuSystem.select).not.toHaveBeenCalled();
      expect(subAppContainer.handleGesture).not.toHaveBeenCalled();
      expect(onOpenMenu).not.toHaveBeenCalled();
      expect(onDeactivateAndShowMenu).not.toHaveBeenCalled();
    });
  });
});
