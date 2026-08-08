/**
 * Gesture routing for the glasses runtime.
 *
 * Built incrementally per the SmarterEveryday design (see
 * `.kiro/specs/smarter-everyday/design.md`, "Architecture decision 3" and
 * component section 7):
 *
 *   - Task 2.1: `classifyPress`/`HOLD_THRESHOLD_MS` — pure Hold
 *     classification from abstract press timestamps, decoupled from the SDK
 *     event shape.
 *   - Task 10.1 (this): `routeGesture`/`AppState`/`GestureType`/
 *     `GestureRouteTarget`/`GestureRouteResult` — the pure gesture-priority
 *     router.
 */

// ─── Pure Functions (exported for PBT) ────────────────────────────────────────

/**
 * Minimum sustained-press duration, in milliseconds, classified as a Hold.
 */
export const HOLD_THRESHOLD_MS = 600;

/**
 * Classifies a press from abstract `press-start`/`press-end` timestamps.
 *
 * Operates purely on timestamps so it is independent of the SDK's raw event
 * shape — the caller (a press/release signal adapter, see Task 2.3) is
 * responsible for deriving `pressStartMs`/`releaseMs` from whatever the
 * runtime firmware/bridge exposes.
 *
 * - `releaseMs === null` and `nowMs - pressStartMs >= HOLD_THRESHOLD_MS` →
 *   `"hold"`: the press has been sustained past the threshold and has not
 *   yet been released.
 * - `releaseMs === null` and `nowMs - pressStartMs < HOLD_THRESHOLD_MS` →
 *   `"pending"`: still within the threshold window, not yet released.
 * - `releaseMs !== null` and `releaseMs - pressStartMs < HOLD_THRESHOLD_MS` →
 *   `"released"`: released before the threshold elapsed, so the caller
 *   should fall through to tap/double-tap classification.
 */
export function classifyPress(
  pressStartMs: number,
  releaseMs: number | null,
  nowMs: number,
):
  | { classification: "hold" }
  | { classification: "pending" }
  | { classification: "released"; heldMs: number } {
  if (releaseMs === null) {
    const elapsed = nowMs - pressStartMs;
    return elapsed >= HOLD_THRESHOLD_MS
      ? { classification: "hold" }
      : { classification: "pending" };
  }

  const heldMs = releaseMs - pressStartMs;
  if (heldMs >= HOLD_THRESHOLD_MS) {
    return { classification: "hold" };
  }
  return { classification: "released", heldMs };
}

// ─── routeGesture (Task 10.1) ──────────────────────────────────────────────

/**
 * The five gesture types Gesture_Router classifies input into. `"hold"` is
 * new for the SmarterEveryday feature (Requirement 10.1), produced by
 * `classifyPress` above (via a press/release signal adapter, see
 * `src/press-adapter.ts`).
 */
export type GestureType =
  | "single-tap"
  | "double-tap"
  | "swipe-up"
  | "swipe-down"
  | "hold";

/**
 * The subset of glasses-runtime state `routeGesture` needs to decide where
 * a classified gesture goes. Each flag corresponds to a mutually-exclusive
 * (or nested) UI surface; see the priority order on `routeGesture` below for
 * how overlapping flags are resolved.
 */
export interface AppState {
  bannerVisible: boolean;
  menuVisible: boolean;
  subAppActive: boolean;
  notificationCenterVisible: boolean;
}

/**
 * Every destination a gesture can be routed to. `"none"` means the gesture
 * was classified but there is nothing listening for it in the current state.
 */
export type GestureRouteTarget =
  | "banner-dismiss"
  | "banner-forward"
  | "notification-center-nav"
  | "notification-center-select"
  | "notification-center-close"
  | "notification-center-hold"
  | "menu-nav"
  | "menu-select"
  | "menu-dismiss"
  | "subapp-deactivate"
  | "subapp-forward"
  | "open-menu"
  | "open-notification-center"
  | "none";

export interface GestureRouteResult {
  target: GestureRouteTarget;
}

/**
 * Pure gesture-priority router.
 *
 * Priority order (design.md component section 7, "Updated priority order in
 * `routeGesture`"):
 *
 * 1. `bannerVisible` + `single-tap` → `"banner-dismiss"` (legacy target kept
 *    for callers that have not migrated to the Notification_System's
 *    tap-to-expand/swipe-to-dismiss split; the notification-system factory
 *    is the caller that actually decides tap=expand vs swipe=dismiss).
 * 2. `bannerVisible` + (`swipe-up` | `swipe-down`) → `"banner-forward"`
 *    (Requirement 8.1, 8.3): forwards the gesture into the notification
 *    system's own state machine, which handles tap-to-expand and
 *    swipe-to-dismiss internally.
 * 3. `notificationCenterVisible` → forwards `swipe-up`/`swipe-down` to
 *    `"notification-center-nav"`, `single-tap` to
 *    `"notification-center-select"`, `double-tap` to
 *    `"notification-center-close"`, and `hold` to
 *    `"notification-center-hold"` (Requirements 9.4, 9.5, 9.6, 9.8, 9.9).
 * 4. `menuVisible` → existing menu routing: `swipe-up`/`swipe-down` to
 *    `"menu-nav"`, `single-tap` to `"menu-select"`, `double-tap` to
 *    `"menu-dismiss"`.
 * 5. `subAppActive` → existing sub-app routing: `double-tap` deactivates the
 *    sub-app (`"subapp-deactivate"`); every other gesture type (including
 *    the new `hold`) is forwarded as-is via `"subapp-forward"`.
 * 6. HUD-only (none of the above visible/active): `swipe-down` opens the
 *    Notification_Center (`"open-notification-center"`, Requirement 10.1);
 *    `double-tap` opens the menu (`"open-menu"`); everything else → `"none"`.
 */
export function routeGesture(
  state: AppState,
  gestureType: GestureType,
): GestureRouteResult {
  // 1. Banner: single-tap dismiss (unchanged legacy target).
  if (state.bannerVisible) {
    if (gestureType === "single-tap") {
      return { target: "banner-dismiss" };
    }
    if (gestureType === "swipe-up" || gestureType === "swipe-down") {
      return { target: "banner-forward" };
    }
  }

  // 2. Notification_Center forwarding.
  if (state.notificationCenterVisible) {
    switch (gestureType) {
      case "swipe-up":
      case "swipe-down":
        return { target: "notification-center-nav" };
      case "single-tap":
        return { target: "notification-center-select" };
      case "double-tap":
        return { target: "notification-center-close" };
      case "hold":
        return { target: "notification-center-hold" };
    }
  }

  // 3. Existing menu routing.
  if (state.menuVisible) {
    switch (gestureType) {
      case "swipe-up":
      case "swipe-down":
        return { target: "menu-nav" };
      case "single-tap":
        return { target: "menu-select" };
      case "double-tap":
        return { target: "menu-dismiss" };
    }
  }

  // 4. Existing sub-app routing.
  if (state.subAppActive) {
    if (gestureType === "double-tap") {
      return { target: "subapp-deactivate" };
    }
    return { target: "subapp-forward" };
  }

  // 5. HUD-only.
  if (gestureType === "swipe-down") {
    return { target: "open-notification-center" };
  }
  if (gestureType === "double-tap") {
    return { target: "open-menu" };
  }

  return { target: "none" };
}
