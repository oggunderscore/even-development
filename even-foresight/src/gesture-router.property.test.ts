import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { shouldAcceptScroll, routeGesture, AppState } from "./gesture-router";
import type { GestureType } from "./sub-app/types";

/**
 * Feature: even-hub, Property 13: Scroll Debounce Acceptance
 *
 * For any two consecutive scroll event timestamps (previous and current),
 * the debounce filter SHALL accept the current event if and only if
 * (current − previous) ≥ 300 ms.
 *
 * Validates: Requirements 6.6
 */

// --- Arbitraries ---

const arbTimestamp = fc.nat({ max: 1_000_000_000 });

// --- Property 13 Tests ---

describe("Feature: even-hub, Property 13: Scroll Debounce Acceptance", () => {
  it("accepts scroll when (current - previous) >= 300ms", () => {
    fc.assert(
      fc.property(arbTimestamp, arbTimestamp, (previous, offset) => {
        const current = previous + 300 + offset;

        const result = shouldAcceptScroll(previous, current);
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects scroll when (current - previous) < 300ms", () => {
    fc.assert(
      fc.property(
        arbTimestamp,
        fc.integer({ min: 0, max: 299 }),
        (previous, delta) => {
          const current = previous + delta;

          const result = shouldAcceptScroll(previous, current);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns true iff (current - previous) >= 300", () => {
    fc.assert(
      fc.property(arbTimestamp, arbTimestamp, (previous, current) => {
        fc.pre(current >= previous);

        const result = shouldAcceptScroll(previous, current);
        const expected = current - previous >= 300;

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: even-hub, Property 14: Gesture Routing Correctness
 *
 * For any application state (banner visible, menu visible, sub-app active,
 * or HUD-only) and any gesture type (single-tap, double-tap, swipe-up,
 * swipe-down), the gesture router SHALL:
 * (1) if banner is visible and gesture is single-tap, route to banner dismiss
 *     and NOT forward to sub-app;
 * (2) if menu is visible, route to menu handler;
 * (3) if sub-app is active and gesture is NOT double-tap, forward to sub-app;
 * (4) if sub-app is active and gesture IS double-tap, route to deactivation
 *     logic, NOT to sub-app.
 *
 * Validates: Requirements 7.2, 8.4
 */

// --- Arbitraries ---

const arbGestureType: fc.Arbitrary<GestureType> = fc.constantFrom(
  "single-tap",
  "double-tap",
  "swipe-up",
  "swipe-down",
);

const arbAppState: fc.Arbitrary<AppState> = fc.record({
  bannerVisible: fc.boolean(),
  menuVisible: fc.boolean(),
  subAppActive: fc.boolean(),
});

// --- Property 14 Tests ---

describe("Feature: even-hub, Property 14: Gesture Routing Correctness", () => {
  it("bannerVisible + single-tap → banner-dismiss", () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        fc.pre(state.bannerVisible);

        const result = routeGesture(
          { ...state, bannerVisible: true },
          "single-tap",
        );
        expect(result.target).toBe("banner-dismiss");
      }),
      { numRuns: 100 },
    );
  });

  it("menuVisible (and not banner+tap) + swipe → menu-nav", () => {
    fc.assert(
      fc.property(
        arbAppState,
        fc.constantFrom<GestureType>("swipe-up", "swipe-down"),
        (state, gesture) => {
          const testState: AppState = { ...state, menuVisible: true };
          // If banner is visible and gesture were single-tap, banner takes priority
          // But since gesture is a swipe, menu should handle
          // However banner only intercepts single-tap, so menu should handle swipes
          fc.pre(
            !(
              testState.bannerVisible &&
              gesture === ("single-tap" as GestureType)
            ),
          );

          const result = routeGesture(testState, gesture);
          expect(result.target).toBe("menu-nav");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("menuVisible + single-tap → menu-select (unless banner intercepts)", () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const testState: AppState = {
          ...state,
          menuVisible: true,
          bannerVisible: false,
        };

        const result = routeGesture(testState, "single-tap");
        expect(result.target).toBe("menu-select");
      }),
      { numRuns: 100 },
    );
  });

  it("menuVisible + double-tap → menu-dismiss", () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const testState: AppState = { ...state, menuVisible: true };
        // banner only intercepts single-tap, so double-tap always goes to menu

        const result = routeGesture(testState, "double-tap");
        expect(result.target).toBe("menu-dismiss");
      }),
      { numRuns: 100 },
    );
  });

  it("subAppActive + double-tap → subapp-deactivate (not forwarded)", () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const testState: AppState = {
          ...state,
          subAppActive: true,
          menuVisible: false,
          bannerVisible: false,
        };

        const result = routeGesture(testState, "double-tap");
        expect(result.target).toBe("subapp-deactivate");
        expect(result.target).not.toBe("subapp-forward");
      }),
      { numRuns: 100 },
    );
  });

  it("subAppActive + non-double-tap (no banner+tap, no menu) → subapp-forward", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<GestureType>("single-tap", "swipe-up", "swipe-down"),
        (gesture) => {
          const testState: AppState = {
            bannerVisible: false,
            menuVisible: false,
            subAppActive: true,
          };

          const result = routeGesture(testState, gesture);
          expect(result.target).toBe("subapp-forward");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("HUD only + double-tap → open-menu", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const testState: AppState = {
          bannerVisible: false,
          menuVisible: false,
          subAppActive: false,
        };

        const result = routeGesture(testState, "double-tap");
        expect(result.target).toBe("open-menu");
      }),
      { numRuns: 100 },
    );
  });

  it("HUD only + non-double-tap → none", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<GestureType>("single-tap", "swipe-up", "swipe-down"),
        (gesture) => {
          const testState: AppState = {
            bannerVisible: false,
            menuVisible: false,
            subAppActive: false,
          };

          const result = routeGesture(testState, gesture);
          expect(result.target).toBe("none");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("exhaustive routing: all state/gesture combinations produce expected target", () => {
    fc.assert(
      fc.property(arbAppState, arbGestureType, (state, gesture) => {
        const result = routeGesture(state, gesture);

        // Priority 1: banner visible + single-tap → banner-dismiss
        if (state.bannerVisible && gesture === "single-tap") {
          expect(result.target).toBe("banner-dismiss");
          return;
        }

        // Priority 2: menu visible → menu handler
        if (state.menuVisible) {
          if (gesture === "swipe-up" || gesture === "swipe-down") {
            expect(result.target).toBe("menu-nav");
          } else if (gesture === "single-tap") {
            expect(result.target).toBe("menu-select");
          } else if (gesture === "double-tap") {
            expect(result.target).toBe("menu-dismiss");
          }
          return;
        }

        // Priority 3 & 4: sub-app active
        if (state.subAppActive) {
          if (gesture === "double-tap") {
            expect(result.target).toBe("subapp-deactivate");
          } else {
            expect(result.target).toBe("subapp-forward");
          }
          return;
        }

        // Priority 5: HUD only
        if (gesture === "double-tap") {
          expect(result.target).toBe("open-menu");
        } else {
          expect(result.target).toBe("none");
        }
      }),
      { numRuns: 100 },
    );
  });
});
