import type { GestureType, GestureEvent } from "./sub-app/types";
import type { BannerSystem } from "./banner/types";
import type { MenuSystem } from "./menu/types";
import type { SubAppContainerInstance } from "./sub-app/sub-app-container";
import { SCROLL_DEBOUNCE_MS } from "./constants";

// === Pure Types (exported for PBT) ===

export interface AppState {
  bannerVisible: boolean;
  menuVisible: boolean;
  subAppActive: boolean;
}

export type GestureRouteTarget =
  | "banner-dismiss"
  | "menu-nav"
  | "menu-select"
  | "menu-dismiss"
  | "subapp-deactivate"
  | "subapp-forward"
  | "open-menu"
  | "none";

export interface GestureRouteResult {
  target: GestureRouteTarget;
}

// === Pure Functions (exported for PBT) ===

/**
 * Determines whether a scroll event should be accepted based on the debounce interval.
 * Returns true if (currentTimestamp - previousTimestamp) >= 300ms.
 */
export function shouldAcceptScroll(
  previousTimestamp: number,
  currentTimestamp: number,
): boolean {
  return currentTimestamp - previousTimestamp >= SCROLL_DEBOUNCE_MS;
}

/**
 * Determines the routing target for a gesture based on the current application state.
 * Priority order:
 * 1. Banner visible + single-tap → dismiss banner
 * 2. Menu visible → route to menu handler (swipe-down: menu-nav, swipe-up: menu-nav, single-tap: menu-select, double-tap: menu-dismiss)
 * 3. Sub-app active + double-tap → deactivate sub-app
 * 4. Sub-app active + other gesture → forward to sub-app
 * 5. HUD only + double-tap → open menu
 * 6. All other combinations → none
 */
export function routeGesture(
  state: AppState,
  gestureType: GestureType,
): GestureRouteResult {
  // Priority 1: Banner visible + single-tap → dismiss
  if (state.bannerVisible && gestureType === "single-tap") {
    return { target: "banner-dismiss" };
  }

  // Priority 2: Menu visible → route to menu handler
  if (state.menuVisible) {
    switch (gestureType) {
      case "swipe-down":
      case "swipe-up":
        return { target: "menu-nav" };
      case "single-tap":
        return { target: "menu-select" };
      case "double-tap":
        return { target: "menu-dismiss" };
    }
  }

  // Priority 3 & 4: Sub-app active
  if (state.subAppActive) {
    if (gestureType === "double-tap") {
      return { target: "subapp-deactivate" };
    }
    return { target: "subapp-forward" };
  }

  // Priority 5: HUD only + double-tap → open menu
  if (gestureType === "double-tap") {
    return { target: "open-menu" };
  }

  // No action for other gestures in HUD-only mode
  return { target: "none" };
}

// === Gesture Parsing ===

/**
 * Parses a raw SDK textEvent string into a GestureEvent, or null if unrecognized.
 */
export function parseGestureEvent(eventText: string): GestureEvent | null {
  const gestureMap: Record<string, GestureType> = {
    "single-tap": "single-tap",
    "double-tap": "double-tap",
    "swipe-up": "swipe-up",
    "swipe-down": "swipe-down",
  };

  const gestureType = gestureMap[eventText];
  if (!gestureType) {
    return null;
  }

  return {
    type: gestureType,
    timestamp: Date.now(),
  };
}

// === Factory ===

export interface GestureRouterDeps {
  bannerSystem: BannerSystem;
  menuSystem: MenuSystem;
  subAppContainer: SubAppContainerInstance;
  onOpenMenu: () => Promise<void>;
  onDeactivateAndShowMenu: () => Promise<void>;
}

export interface GestureRouter {
  handleGesture(event: GestureEvent): void;
}

/**
 * Creates a GestureRouter instance that dispatches gesture events
 * to the appropriate system based on application state and priority.
 */
export function createGestureRouter(deps: GestureRouterDeps): GestureRouter {
  const {
    bannerSystem,
    menuSystem,
    subAppContainer,
    onOpenMenu,
    onDeactivateAndShowMenu,
  } = deps;

  let lastScrollTimestamp = 0;

  function handleGesture(event: GestureEvent): void {
    const state: AppState = {
      bannerVisible: bannerSystem.isVisible,
      menuVisible: menuSystem.isVisible,
      subAppActive: subAppContainer.activeApp !== null,
    };

    // Apply scroll debounce for swipe events ONLY when menu is visible
    if (
      state.menuVisible &&
      (event.type === "swipe-up" || event.type === "swipe-down")
    ) {
      if (!shouldAcceptScroll(lastScrollTimestamp, event.timestamp)) {
        return; // Debounced — discard event
      }
      lastScrollTimestamp = event.timestamp;
    }

    const result = routeGesture(state, event.type);

    switch (result.target) {
      case "banner-dismiss":
        bannerSystem.dismiss();
        break;

      case "menu-nav":
        if (event.type === "swipe-down") {
          menuSystem.moveDown();
        } else {
          menuSystem.moveUp();
        }
        break;

      case "menu-select":
        menuSystem.select();
        break;

      case "menu-dismiss":
        menuSystem.hide();
        break;

      case "subapp-deactivate":
        onDeactivateAndShowMenu();
        break;

      case "subapp-forward":
        subAppContainer.handleGesture(event);
        break;

      case "open-menu":
        onOpenMenu();
        break;

      case "none":
        // No action
        break;
    }
  }

  return { handleGesture };
}
