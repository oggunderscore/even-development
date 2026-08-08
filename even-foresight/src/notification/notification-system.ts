import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  transition,
  historyForDisplay,
  isCenterPhase,
  type NotificationState,
  type NotificationEvent,
  type NotificationEffect,
} from "./notification-state-machine";
import type { StorageManager } from "../storage/storage-manager";
import {
  STORAGE_KEYS,
  DEFAULT_NOTIFICATION_HISTORY,
  DEFAULT_SMARTER_EVERYDAY_SETTINGS,
  type BannerConfig,
  type NotificationEntry,
  type NotificationHistoryStore,
  type SmarterEverydaySettings,
} from "../storage/schemas";
import {
  BANNER_DEFAULT_DURATION_S,
  BANNER_MAX_DURATION_S,
  BANNER_MAX_TEXT_LENGTH,
  BANNER_MIN_DURATION_S,
  MENU_ENTRY_TRUNCATE,
  CONTAINER,
  CONTAINER_NAME,
} from "../constants";

// === Local rendering helpers ===
//
// Container allocation is owned exclusively by `glasses/home-screen.ts`
// (see CLAUDE.md's "Container allocation" rule — only it may call
// `rebuildPageContainer`). No dedicated Notification_Center container has
// been allocated yet, so this factory reuses the two containers that
// already exist and are already sized for overlay content: `BANNER` for
// the brief popup/expanded phases (exactly what `banner-system.ts` already
// draws into), and `MENU` for the three full-screen Notification_Center
// sub-phases (it's the only other container sized for a full-screen
// overlay — `OVERLAY_Y`/`OVERLAY_WIDTH`/`OVERLAY_HEIGHT`). Wiring these two
// systems together so they never draw at the same time is a `main.ts`/
// `home-screen.ts` concern for task 13.2, not this factory.

/**
 * Truncates text to `max` characters with a trailing ellipsis, mirroring
 * `banner-system.ts`'s `truncateBannerText`/`menu-system.ts`'s
 * `truncateText`. Kept local (rather than imported from `banner-system.ts`,
 * the module this factory replaces) so this file has no dependency on it.
 */
function truncateText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max - 3) + "...";
}

/**
 * Clamps a duration (seconds) to [BANNER_MIN_DURATION_S,
 * BANNER_MAX_DURATION_S]. Kept local for the same reason as `truncateText`:
 * no dependency on `banner-system.ts`, the module this factory replaces.
 */
function clampDuration(duration: number): number {
  return Math.max(
    BANNER_MIN_DURATION_S,
    Math.min(BANNER_MAX_DURATION_S, duration),
  );
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildBannerContent(active: NotificationEntry | null): string {
  if (!active) return "";
  return truncateText(active.text, BANNER_MAX_TEXT_LENGTH);
}

function buildExpandedContent(active: NotificationEntry | null): string {
  if (!active) return "";
  return `${active.sourceAppName}  ${formatTimestamp(active.timestamp)}\n${active.text}`;
}

function buildCenterListContent(state: NotificationState): string {
  const displayEntries = historyForDisplay(state.history);
  if (displayEntries.length === 0) {
    return "NOTIFICATIONS\nNo notifications";
  }
  const lines: string[] = ["NOTIFICATIONS"];
  for (let i = 0; i < displayEntries.length; i++) {
    const prefix = i === state.centerIndex ? "> " : "  ";
    lines.push(
      `${prefix}${truncateText(displayEntries[i].text, MENU_ENTRY_TRUNCATE)}`,
    );
  }
  return lines.join("\n");
}

function buildCenterDetailContent(state: NotificationState): string {
  const displayEntries = historyForDisplay(state.history);
  const entry = displayEntries[state.centerIndex] ?? null;
  return buildExpandedContent(entry);
}

function buildConfirmClearContent(): string {
  return "Clear all notifications?\nTap to confirm";
}

/** True while a Banner_Notification or its Expanded_Notification_View is up. */
function isBannerPhase(state: NotificationState): boolean {
  return state.phase === "banner" || state.phase === "expanded";
}

/** True while any of the three Notification_Center sub-phases is up. */
function isCenterState(state: NotificationState): boolean {
  return isCenterPhase(state.phase);
}

// === Factory ===

export interface NotificationSystem {
  push(notification: NotificationEntry): void;
  /** Unchanged signature — existing callers (`reminders.ts`) keep working. */
  dismiss(): void;
  handleTap(): void;
  handleSwipeDismiss(): void;
  openCenter(): void;
  handleCenterNav(direction: "up" | "down"): void;
  handleCenterSelect(): void;
  handleCenterClose(): void;
  handleHold(): void;
  confirmClearHistory(): void;
  /**
   * Self-correcting catch-up for the banner/expanded auto-dismiss timer,
   * mirroring `home-screen.ts#catchUpAfterPossibleThrottling` (call it from
   * the same places — see that method's doc comment for why: real mobile
   * WebViews throttle/suspend `setTimeout` while backgrounded, so the timer
   * `push()` starts to auto-dismiss a banner may simply never fire, leaving
   * an old notification's text stuck over the HUD indefinitely). Recomputes
   * "is the current banner/expanded view overdue to dismiss" from
   * wall-clock elapsed time instead of trusting the scheduled callback, and
   * dispatches the same `"duration-elapsed"` event that callback would
   * have. A no-op when no timer is running (idle, or a phase the timer
   * doesn't apply to).
   */
  checkTimeoutElapsed(): void;
  readonly isVisible: boolean;
  readonly isCenterVisible: boolean;
  readonly state: NotificationState;
  /**
   * Cancels the pending auto-dismiss timer. Call on shutdown.
   *
   * `NotificationSystem` (unlike the `BannerSystem` it replaces) has no
   * queue/visibility flags of its own to reset here — `currentState` is
   * simply dropped along with the rest of this closure when the caller
   * discards its reference — so this only needs to clear the one timer
   * held internally, mirroring `banner-system.ts`'s `dispose()`.
   */
  dispose(): void;
}

export interface NotificationSystemOptions {
  /**
   * Override the banner duration for testing (seconds). If provided, skips
   * the `BANNER_CONFIG` storage read. Same contract as the
   * `BannerSystemOptions.defaultDuration` this replaces.
   */
  defaultDuration?: number;
  /**
   * Called when a banner/expanded notification becomes visible and again when
   * the last one is dismissed — i.e. on every change to `isVisible`. The home
   * screen uses this to clear the HUD underneath, since the banner container
   * overlaps the HUD band and the firmware gives no guarantee about how
   * overlapping containers compose.
   *
   * Not fired for the Notification_Center phases: those draw into the menu
   * container, which sits below the HUD band and overlaps nothing.
   */
  onVisibilityChange?: (visible: boolean) => void;
}

/**
 * Creates a NotificationSystem instance — the factory that wraps the pure
 * `transition()` state machine (`notification-state-machine.ts`) with the
 * SDK bridge calls, timers, and storage persistence, exactly as
 * `banner-system.ts` wraps its own pure helpers today.
 *
 * @param bridge - Even App SDK bridge for display operations
 * @param storage - StorageManager for reading settings and persisting
 *   Notification_History
 * @param options - Optional duration override and visibility callback
 */
export function createNotificationSystem(
  bridge: EvenAppBridge,
  storage: StorageManager,
  options?: NotificationSystemOptions,
): NotificationSystem {
  const settings =
    storage.get<SmarterEverydaySettings>(
      STORAGE_KEYS.SMARTER_EVERYDAY_SETTINGS,
    ) ?? DEFAULT_SMARTER_EVERYDAY_SETTINGS;
  const historyStore =
    storage.get<NotificationHistoryStore>(STORAGE_KEYS.NOTIFICATION_HISTORY) ??
    DEFAULT_NOTIFICATION_HISTORY;

  let currentState: NotificationState = {
    phase: "idle",
    active: null,
    queue: [],
    priorPhase: "idle",
    centerIndex: 0,
    history: historyStore.entries,
    historyMax: settings.notificationHistoryMax,
  };

  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Wall-clock time `dismissTimer` is due to fire, or `null` when no timer
   * is running. Exists so `checkTimeoutElapsed()` can recompute "should this
   * already have dismissed" from elapsed time instead of trusting the
   * `setTimeout` callback to fire on schedule — see that method's doc
   * comment for why.
   */
  let dismissDueAt: number | null = null;

  function clearDismissTimer(): void {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    dismissDueAt = null;
  }

  /**
   * Executes every effect in `effects` EXCEPT `"archive"`/`"clear-history"`
   * (those are persisted, and gate the state commit, before this is ever
   * called — see `dispatch` below). Runs in the same order the state
   * machine returned them.
   */
  function runTimerEffects(effects: NotificationEffect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case "cancel-timer":
          clearDismissTimer();
          break;
        case "start-timer":
          clearDismissTimer();
          dismissDueAt = Date.now() + effect.durationMs;
          dismissTimer = setTimeout(() => {
            void dispatch({ type: "duration-elapsed" });
          }, effect.durationMs);
          break;
        // "archive" / "clear-history" already handled by dispatch's
        // persistence step before state commit.
        default:
          break;
      }
    }
  }

  /**
   * The content each borrowed container should hold in `state`'s phase.
   *
   * `null` means "this phase does not draw here" — as opposed to `""`, which
   * means "this phase draws here, and its content is blank". The distinction
   * matters because `CONTAINER.MENU` is only *borrowed* for the
   * Notification_Center: writing `""` to it on every return to `"idle"` would
   * wipe an open `MenuSystem` list whenever a banner auto-dismissed over it.
   */
  function surfacesFor(state: NotificationState): {
    banner: string | null;
    menu: string | null;
  } {
    switch (state.phase) {
      case "idle":
        return { banner: null, menu: null };
      case "banner":
        return { banner: buildBannerContent(state.active), menu: null };
      case "expanded":
        return { banner: buildExpandedContent(state.active), menu: null };
      case "center-list":
        return { banner: null, menu: buildCenterListContent(state) };
      case "center-detail":
        return { banner: null, menu: buildCenterDetailContent(state) };
      case "center-confirm-clear":
        return { banner: null, menu: buildConfirmClearContent() };
    }
  }

  /**
   * Renders `currentState.phase` to the display. Mirrors how
   * `banner-system.ts`/`menu-system.ts` separate "compute new state" from
   * "render it" — this is called only after a state commit.
   *
   * Writes the diff against `previousState` (what the display currently
   * shows) rather than the new phase alone: a surface the outgoing phase drew
   * into and the incoming one does not is explicitly blanked, and a surface
   * neither phase touches is left alone.
   */
  function render(previousState: NotificationState): void {
    const before = surfacesFor(previousState);
    const after = surfacesFor(currentState);

    const bannerContent = after.banner ?? (before.banner !== null ? "" : null);
    if (bannerContent !== null) {
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER.BANNER,
          containerName: CONTAINER_NAME.BANNER,
          content: bannerContent,
        }),
      );
    }

    const menuContent = after.menu ?? (before.menu !== null ? "" : null);
    if (menuContent !== null) {
      void bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER.MENU,
          containerName: CONTAINER_NAME.MENU,
          content: menuContent,
        }),
      );
    }
  }

  /**
   * Drives every public method: calls the pure `transition()`, then
   * executes the returned `effects` in order.
   *
   * Requirement 7.4 / Error Handling: when the result includes an
   * `"archive"` or `"clear-history"` effect, the corresponding
   * `storage.set(STORAGE_KEYS.NOTIFICATION_HISTORY, ...)` write is awaited
   * FIRST, and `currentState` is only committed to `result.state` (i.e.
   * the visible phase only advances away from the dismissed entry) if that
   * write resolves successfully. On failure, `currentState` is left
   * unchanged — the current banner/expanded view stays visible, no other
   * effect in this result runs, and the next dismiss-triggering event
   * (tap/swipe/duration-elapsed) re-invokes `transition()` from that same
   * unchanged state, naturally retrying the archive.
   *
   * When there is no `"archive"`/`"clear-history"` effect, the new state
   * is committed synchronously and any `"cancel-timer"`/`"start-timer"`
   * effects run immediately.
   *
   * `options.onVisibilityChange` fires after the render, and only when
   * `isVisible` actually flipped — a rejected commit leaves the previous view
   * on screen, so it must not report a visibility change either.
   */
  async function dispatch(event: NotificationEvent): Promise<void> {
    const previousState = currentState;
    const result = transition(currentState, event);
    const hasClearHistory = result.effects.some(
      (effect) => effect.kind === "clear-history",
    );
    const hasArchive = result.effects.some(
      (effect) => effect.kind === "archive",
    );

    if (hasArchive || hasClearHistory) {
      try {
        if (hasClearHistory) {
          await storage.set(STORAGE_KEYS.NOTIFICATION_HISTORY, {
            entries: [],
          });
        } else {
          // The pure transition already computed the updated history
          // synchronously into `result.state.history` (task 8.1's design
          // decision) — persist that, not a separately-derived value.
          await storage.set(STORAGE_KEYS.NOTIFICATION_HISTORY, {
            entries: result.state.history,
          });
        }
      } catch (err) {
        console.log(
          "NotificationSystem: failed to persist notification history, keeping current view visible",
          err,
        );
        return;
      }
    }

    currentState = result.state;
    runTimerEffects(result.effects);
    render(previousState);

    const wasVisible = isBannerPhase(previousState);
    const nowVisible = isBannerPhase(currentState);
    if (wasVisible !== nowVisible) {
      options?.onVisibilityChange?.(nowVisible);
    }
  }

  /**
   * Resolves the display duration for a pushed entry, in seconds.
   *
   * An explicit `entry.duration` wins and is passed through **unclamped**:
   * that is what the field is for — a per-notification override — and
   * SmarterEveryday's `popupDisplayDurationSeconds` legitimately ranges up to
   * 120s (Requirement 7.2/7.3), well past `BANNER_MAX_DURATION_S`. Clamping
   * it to the banner bounds would cap a configured 60s popup at 15s. Callers
   * that expose the value to the user clamp it to their own documented range
   * first (`clampToRange` in the config form); only a nonsensical
   * non-positive/non-finite override is rejected here.
   *
   * With no override this falls back to the framework-wide `BANNER_CONFIG`
   * value, clamped to [3, 15] — the exact behavior `banner-system.ts` gave
   * every caller, so `reminders.ts`-driven banners keep honoring the user's
   * configured banner duration rather than silently reverting to the built-in
   * default.
   */
  function resolveDurationSeconds(entry: NotificationEntry): number {
    if (
      entry.duration !== undefined &&
      Number.isFinite(entry.duration) &&
      entry.duration > 0
    ) {
      return entry.duration;
    }
    if (options?.defaultDuration !== undefined) {
      return clampDuration(options.defaultDuration);
    }
    const config = storage.get<BannerConfig>(STORAGE_KEYS.BANNER_CONFIG);
    if (config && typeof config.displayDurationSeconds === "number") {
      return clampDuration(config.displayDurationSeconds);
    }
    return BANNER_DEFAULT_DURATION_S;
  }

  return {
    push(notification: NotificationEntry): void {
      void dispatch({
        type: "push",
        entry: {
          ...notification,
          duration: resolveDurationSeconds(notification),
        },
      });
    },

    dismiss(): void {
      // Old BannerSystem.dismiss() semantics: immediately archive and
      // advance away from the visible banner. Closest analog under the new
      // state machine is the same archive+advance behavior as a swipe.
      void dispatch({ type: "swipe-dismiss" });
    },

    handleTap(): void {
      void dispatch({ type: "tap" });
    },

    handleSwipeDismiss(): void {
      void dispatch({ type: "swipe-dismiss" });
    },

    openCenter(): void {
      void dispatch({ type: "open-center" });
    },

    handleCenterNav(direction: "up" | "down"): void {
      void dispatch({ type: "center-nav", direction });
    },

    handleCenterSelect(): void {
      void dispatch({ type: "center-select" });
    },

    handleCenterClose(): void {
      void dispatch({ type: "center-close" });
    },

    handleHold(): void {
      void dispatch({ type: "hold" });
    },

    confirmClearHistory(): void {
      void dispatch({ type: "confirm-clear" });
    },

    checkTimeoutElapsed(): void {
      if (dismissDueAt !== null && Date.now() >= dismissDueAt) {
        void dispatch({ type: "duration-elapsed" });
      }
    },

    get isVisible(): boolean {
      return isBannerPhase(currentState);
    },

    get isCenterVisible(): boolean {
      return isCenterState(currentState);
    },

    get state(): NotificationState {
      return currentState;
    },

    dispose(): void {
      clearDismissTimer();
    },
  };
}
