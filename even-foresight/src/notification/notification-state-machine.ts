import type { NotificationEntry } from "../storage/schemas";
import { BANNER_DEFAULT_DURATION_S, BANNER_QUEUE_MAX } from "../constants";

// === Types (design.md component 5) ===

export type NotificationPhase =
  | "idle"
  | "banner"
  | "expanded"
  | "center-list"
  | "center-detail"
  | "center-confirm-clear";

export interface NotificationState {
  phase: NotificationPhase;
  /** The banner/expanded notification currently on screen (phase "banner" | "expanded"). */
  active: NotificationEntry | null;
  /**
   * Notifications pushed while another is active/expanded, awaiting display
   * in FIFO order. Not part of the design.md interface listing verbatim, but
   * required by Property 13/16/17's "next queued entry" behavior — this is
   * the pure-state-machine equivalent of banner-system.ts's internal `queue`
   * array, now threaded through `transition()` since the state machine is
   * pure and has no closure state of its own.
   */
  queue: NotificationEntry[];
  /** Prior phase to restore to when the center closes (always "idle" today, kept explicit for future). */
  priorPhase: NotificationPhase;
  /** Selected index within history while the center is open. */
  centerIndex: number;
  history: NotificationEntry[];
  historyMax: number;
}

export type NotificationEvent =
  | { type: "push"; entry: NotificationEntry }
  | { type: "tap" }
  | { type: "swipe-dismiss" }
  | { type: "duration-elapsed" }
  | { type: "open-center" }
  | { type: "center-nav"; direction: "up" | "down" }
  | { type: "center-select" }
  | { type: "center-close" }
  | { type: "hold" }
  | { type: "confirm-clear" };

export interface TransitionResult {
  state: NotificationState;
  /** Side effects the caller (factory) must perform: archive-to-history, cancel-timer, etc. */
  effects: NotificationEffect[];
}

export type NotificationEffect =
  | { kind: "archive"; entry: NotificationEntry }
  | { kind: "cancel-timer" }
  | { kind: "start-timer"; durationMs: number }
  | { kind: "clear-history" };

// === Pure helpers ===

/** True for the three Notification_Center sub-phases. */
export function isCenterPhase(phase: NotificationPhase): boolean {
  return (
    phase === "center-list" ||
    phase === "center-detail" ||
    phase === "center-confirm-clear"
  );
}

/**
 * Where a dismissal returns to, and the `priorPhase` to carry forward.
 *
 * A banner pushed while the Notification_Center is open interrupts it, and
 * `handlePush` stashes the interrupted center sub-phase in `priorPhase` so
 * dismissing that banner puts the wearer back where they were instead of
 * silently closing their center (`handleOpenCenter` records `"idle"`, so
 * without the stash the center would be lost the moment the Scheduler's 60s
 * tick delivered anything).
 *
 * When the restore target *is* a center phase, `priorPhase` was standing in
 * for "the center this banner interrupted" and has to be reset — leaving it
 * pointing at the center would make a later `center-close` restore the center
 * onto itself, and the wearer could never get out.
 */
function restoreTarget(state: NotificationState): {
  phase: NotificationPhase;
  priorPhase: NotificationPhase;
} {
  const phase = state.priorPhase;
  return {
    phase,
    priorPhase: isCenterPhase(phase) ? "idle" : state.priorPhase,
  };
}

/**
 * FIFO-with-cap enqueue used by `transition` when a push arrives while a
 * banner is already active/expanded. Mirrors `banner-system.ts`'s
 * `processQueue`: appends while under the cap, otherwise drops the oldest
 * queued entry before appending the new one.
 */
function enqueue(
  queue: NotificationEntry[],
  entry: NotificationEntry,
): NotificationEntry[] {
  if (queue.length < BANNER_QUEUE_MAX) {
    return [...queue, entry];
  }
  return [...queue.slice(1), entry];
}

/**
 * Resolves the auto-dismiss duration (ms) for a newly-displayed entry.
 * Prefers the per-entry override (seconds), falling back to the same
 * default `banner-system.ts` uses today when none is set. The factory layer
 * (task 9.2) is responsible for populating `entry.duration` from the
 * SmarterEveryday/banner config before pushing; this pure function only
 * needs a sensible fallback for callers that omit it.
 */
function resolveDurationMs(entry: NotificationEntry): number {
  const seconds = entry.duration ?? BANNER_DEFAULT_DURATION_S;
  return seconds * 1000;
}

/**
 * Pure FIFO-with-cap reducer used by `transition` for "archive" effects
 * (design.md component 5, Property 18; Requirement 9.1, 9.2).
 *
 * Appends `entry` to `history` (stored oldest-first). If the resulting
 * length exceeds `max`, discards the oldest entry(ies) so the length is
 * capped at `max`, preserving the relative order of all retained entries.
 * A non-positive `max` sensibly caps the history at empty rather than
 * throwing or returning a negative-length slice.
 */
export function appendToHistory(
  history: NotificationEntry[],
  entry: NotificationEntry,
  max: number,
): NotificationEntry[] {
  if (max <= 0) {
    return [];
  }
  return [...history, entry].slice(-max);
}

/**
 * Returns `history` (stored oldest-first per design.md's
 * `NotificationHistoryStore.entries` comment) reordered for display in the
 * Notification_Center: most-recently-archived entry first (Requirement 9.4,
 * Property 19).
 *
 * Pure and non-mutating — returns a new array via `[...history].reverse()`
 * rather than reversing in place, so callers holding a reference to the
 * original `history` array (e.g. `NotificationState.history`) are
 * unaffected.
 */
export function historyForDisplay(
  history: NotificationEntry[],
): NotificationEntry[] {
  return [...history].reverse();
}

/**
 * Pure index clamp used for center navigation (design.md component 5,
 * Property 20; Requirement 9.5). Mirrors `menu-system.ts`'s
 * `navigateUp`/`navigateDown` clamp pattern — no wraparound, just clamped
 * to the valid index range — but combines both directions into a single
 * `delta`-based function since the state machine's "center-nav" event
 * carries a direction rather than calling separate up/down handlers.
 *
 * Applies `delta` (-1 for "up", +1 for "down") to `index` and clamps the
 * result to `[0, length - 1]`, exactly like `navigateUp`/`navigateDown`
 * clamp to `0`/`totalEntries - 1` respectively. If `length <= 0` (an empty
 * list has no valid index), returns `0` rather than a negative bound.
 */
export function clampCenterIndex(
  index: number,
  delta: -1 | 1,
  length: number,
): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index + delta, 0), length - 1);
}

function handlePush(
  state: NotificationState,
  entry: NotificationEntry,
): TransitionResult {
  const bannerActive = state.phase === "banner" || state.phase === "expanded";

  if (!bannerActive) {
    return {
      state: {
        ...state,
        phase: "banner",
        active: entry,
        // Interrupting an open Notification_Center: remember which sub-phase
        // to restore once this banner is dismissed. See `restoreTarget`.
        priorPhase: isCenterPhase(state.phase) ? state.phase : state.priorPhase,
      },
      effects: [{ kind: "start-timer", durationMs: resolveDurationMs(entry) }],
    };
  }

  // A banner (or its expanded view) is already on screen — queue the new
  // entry for display once the current one finishes. The active banner and
  // every other field are left untouched.
  return {
    state: {
      ...state,
      queue: enqueue(state.queue, entry),
    },
    effects: [],
  };
}

/**
 * Handles the "duration-elapsed" event (Requirement 7.4, Property 13):
 * the currently active banner's display duration timer fired without the
 * user tapping or swiping it. Archives the active entry and advances to the
 * next queued entry (still "banner") or "idle" if the queue is empty.
 *
 * No-op (state unchanged, no effects) if there is no active banner — this
 * event only has meaning while `phase === "banner"`.
 *
 * Division of responsibility for the "keep the banner visible if archiving
 * fails" half of Requirement 7.4: this pure function always optimistically
 * returns the archive effect plus the advanced state, assuming the archive
 * will succeed. It has no knowledge of whether `storage.set` actually
 * succeeds. The factory (`createNotificationSystem`, task 9.2) is
 * responsible for executing the "archive" effect first and only committing
 * this returned state (advancing away from the current banner) if that
 * write succeeds; on failure it must keep rendering the current
 * banner/expanded view and can retry archiving on the next dismiss trigger.
 *
 * Design decision (see task 8.1 discussion): `state.history` is updated
 * synchronously here, via `appendToHistory`, in the same `TransitionResult`
 * that carries the `"archive"` effect — it is NOT left for the factory to
 * apply separately. This keeps the returned `state` and the emitted effect
 * always in sync, which is what makes the "commit atomically, or not at
 * all" contract described above actually work: since the factory commits
 * this *entire* returned state only after the archive write succeeds (and
 * otherwise keeps rendering the pre-transition state unchanged), a rejected
 * commit also leaves `history` at its pre-transition value. The next
 * dismiss trigger then re-runs `transition()` from that same
 * pre-transition state, re-appending the same entry to the same
 * (still-unmodified) history exactly once — never double-appending and
 * never losing the pending entry. If `appendToHistory` were applied by the
 * factory independently of `transition()`'s returned state, the factory
 * would need to track its own separate "last persisted history" outside
 * this pure state machine, duplicating the FIFO-cap logic's source of
 * truth; keeping it here instead matches design.md's phrasing that
 * `appendToHistory` is "used by `transition`'s `archive` effects".
 */
function handleDurationElapsed(state: NotificationState): TransitionResult {
  if (state.phase !== "banner" || state.active === null) {
    return { state, effects: [] };
  }

  const archiveEffect: NotificationEffect = {
    kind: "archive",
    entry: state.active,
  };
  const history = appendToHistory(
    state.history,
    state.active,
    state.historyMax,
  );

  if (state.queue.length === 0) {
    return {
      state: {
        ...state,
        ...restoreTarget(state),
        active: null,
        history,
      },
      effects: [archiveEffect],
    };
  }

  const [next, ...rest] = state.queue;
  return {
    state: {
      ...state,
      phase: "banner",
      active: next,
      queue: rest,
      history,
    },
    effects: [
      archiveEffect,
      { kind: "start-timer", durationMs: resolveDurationMs(next) },
    ],
  };
}

/**
 * Handles the "tap" event while a banner is visible (Requirement 8.1, 8.2;
 * Property 14): a single tap on a visible Banner_Notification transitions
 * it to the Expanded_Notification_View. `active` is preserved exactly as-is
 * — `NotificationEntry` already carries the full untruncated text, source,
 * and timestamp needed by the expanded view (design.md Data Models), so no
 * field changes are needed beyond `phase`.
 *
 * Per Requirement 8.2, the expanded view has no auto-dismiss timer: it
 * cancels the original display duration timer ("cancel-timer") and does
 * NOT start a new one, staying visible until the user explicitly dismisses
 * it (the "tap"-while-"expanded" handling below).
 *
 * Also handles the "tap" event while the Expanded_Notification_View is open
 * (Requirement 8.4, Property 17): archives the active entry and closes the
 * view, returning to `priorPhase` — or, if another notification was queued
 * up while this one was active/expanded, advancing to display that queued
 * entry as the next "banner" instead (same "a queued banner takes priority"
 * semantics as `handleDurationElapsed`/`handleSwipeDismiss`). No
 * "cancel-timer" effect is needed here since the expanded view never had a
 * running timer to begin with (Requirement 8.2).
 *
 * No-op for any other phase — falls through to the caller's default no-op
 * case, which later tasks (8.7/8.10 for center phases) will implement.
 */
function handleTap(state: NotificationState): TransitionResult {
  if (state.phase === "banner") {
    return {
      state: {
        ...state,
        phase: "expanded",
      },
      effects: [{ kind: "cancel-timer" }],
    };
  }

  if (state.phase === "expanded") {
    if (state.active === null) {
      return { state, effects: [] };
    }

    const archiveEffect: NotificationEffect = {
      kind: "archive",
      entry: state.active,
    };
    // See the design-decision comment on `handleDurationElapsed` above:
    // `history` is updated synchronously here too, in the same
    // `TransitionResult` as the "archive" effect, for the same
    // atomic-commit-or-retry-from-pre-transition-state reasoning.
    const history = appendToHistory(
      state.history,
      state.active,
      state.historyMax,
    );

    if (state.queue.length === 0) {
      return {
        state: {
          ...state,
          ...restoreTarget(state),
          active: null,
          history,
        },
        effects: [archiveEffect],
      };
    }

    const [next, ...rest] = state.queue;
    return {
      state: {
        ...state,
        phase: "banner",
        active: next,
        queue: rest,
        history,
      },
      effects: [
        archiveEffect,
        { kind: "start-timer", durationMs: resolveDurationMs(next) },
      ],
    };
  }

  return { state, effects: [] };
}

/**
 * Handles the "swipe-dismiss" event while a banner is visible (Requirement
 * 8.3, Property 16): immediately archives the active entry and advances to
 * "idle" or the next queued banner — the same archive+advance semantics as
 * `handleDurationElapsed`, just triggered by a swipe interaction instead of
 * the display duration timer elapsing. Also includes a "cancel-timer"
 * effect (Requirement 7.5) since this is a user interaction with the
 * visible banner that must preempt the elapse-driven dismissal.
 *
 * No-op if there is no visible banner (`phase !== "banner"`).
 */
function handleSwipeDismiss(state: NotificationState): TransitionResult {
  if (state.phase !== "banner" || state.active === null) {
    return { state, effects: [] };
  }

  const archiveEffect: NotificationEffect = {
    kind: "archive",
    entry: state.active,
  };
  // See the design-decision comment on `handleDurationElapsed` above:
  // `history` is updated synchronously here too, in the same
  // `TransitionResult` as the "archive" effect, for the same
  // atomic-commit-or-retry-from-pre-transition-state reasoning.
  const history = appendToHistory(
    state.history,
    state.active,
    state.historyMax,
  );

  if (state.queue.length === 0) {
    return {
      state: {
        ...state,
        ...restoreTarget(state),
        active: null,
        history,
      },
      effects: [archiveEffect, { kind: "cancel-timer" }],
    };
  }

  const [next, ...rest] = state.queue;
  return {
    state: {
      ...state,
      phase: "banner",
      active: next,
      queue: rest,
      history,
    },
    effects: [
      archiveEffect,
      { kind: "cancel-timer" },
      { kind: "start-timer", durationMs: resolveDurationMs(next) },
    ],
  };
}

/**
 * Handles the "open-center" event (Requirement 9.4): a swipe-down on the
 * main HUD opens the Notification_Center. Per `gesture-router.ts`'s
 * priority order, `"open-notification-center"` only fires when the HUD is
 * otherwise idle (no banner, menu, sub-app, or center already active) —
 * `"idle"` is therefore the only phase this event is reachable from in
 * practice. `priorPhase` is set to the current phase (`state.phase`, i.e.
 * `"idle"`) so `handleCenterClose` knows what to restore later, and
 * `centerIndex` resets to `0` so the list opens on its most-recent entry
 * (Requirement 9.4's most-recent-first ordering via `historyForDisplay`).
 *
 * No-op (state unchanged, no effects) for any other phase — defensive only,
 * since the router's priority order shouldn't route this event from a
 * non-idle phase, but keeps `transition()` total.
 */
function handleOpenCenter(state: NotificationState): TransitionResult {
  if (state.phase !== "idle") {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      phase: "center-list",
      priorPhase: state.phase,
      centerIndex: 0,
    },
    effects: [],
  };
}

/**
 * Handles the "center-nav" event (Requirement 9.5, Property 20): while the
 * Notification_Center's list view is open, swipe-up/swipe-down move the
 * selected index by one, clamped to the valid range via
 * `clampCenterIndex`. Only meaningful in `"center-list"` — the detail view
 * shows a single entry, and moving to a different entry there would need
 * to go back through `center-select` per the list/detail round-trip in
 * Requirement 9.6/9.7 — so this is a no-op for `"center-detail"` and every
 * other phase.
 */
function handleCenterNav(
  state: NotificationState,
  direction: "up" | "down",
): TransitionResult {
  if (state.phase !== "center-list") {
    return { state, effects: [] };
  }

  const delta = direction === "up" ? -1 : 1;
  return {
    state: {
      ...state,
      centerIndex: clampCenterIndex(
        state.centerIndex,
        delta,
        state.history.length,
      ),
    },
    effects: [],
  };
}

/**
 * Handles the "center-select" event (Requirement 9.6, 9.7; Property 21):
 * a single tap toggles between the Notification_Center's list and detail
 * views. From `"center-list"`, transitions to `"center-detail"` to show
 * the entry at `centerIndex`. From `"center-detail"`, transitions back to
 * `"center-list"`. `centerIndex` is left unchanged either way, so the round
 * trip lands back on the same list position. No-op for any other phase.
 */
function handleCenterSelect(state: NotificationState): TransitionResult {
  if (state.phase === "center-list") {
    return { state: { ...state, phase: "center-detail" }, effects: [] };
  }

  if (state.phase === "center-detail") {
    return { state: { ...state, phase: "center-list" }, effects: [] };
  }

  return { state, effects: [] };
}

/**
 * Handles the "center-close" event (Requirement 9.8, Property 22): a
 * double-tap while the Notification_Center is open — from any of its
 * sub-phases (`"center-list"`, `"center-detail"`, or
 * `"center-confirm-clear"`, the latter added by task 8.10's `handleHold`/
 * `handleConfirmClear`) — closes the center and returns to `priorPhase`,
 * resetting `centerIndex` back to `0`. Per the task's explicit note, this
 * does NOT modify `history` — no archive/clear-history effects are
 * produced, matching Property 22's "without modifying history". No-op for
 * any phase outside the center.
 */
function handleCenterClose(state: NotificationState): TransitionResult {
  if (
    state.phase !== "center-list" &&
    state.phase !== "center-detail" &&
    state.phase !== "center-confirm-clear"
  ) {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      phase: state.priorPhase,
      centerIndex: 0,
    },
    effects: [],
  };
}

/**
 * Handles the "hold" event (Requirement 9.9, Property 23): a Hold gesture
 * while the Notification_Center is open displays the clear-all confirmation
 * prompt. Only meaningful from `"center-list"` or `"center-detail"` (the
 * center's two "browsing" sub-phases) — transitions to
 * `"center-confirm-clear"` with `history` and `centerIndex` left EXACTLY
 * unchanged and no effects at all (no `"clear-history"`, nothing); clearing
 * only happens on explicit confirmation via `handleConfirmClear` below.
 *
 * No-op for any other phase, including `"center-confirm-clear"` itself —
 * Property 23 scopes this transition to `"center-list"`/`"center-detail"`
 * only, so a redundant hold while the confirm-clear prompt is already open
 * is treated the same as holding outside the center: state and effects are
 * both left unchanged (idempotent no-op) rather than re-entering the same
 * phase.
 */
function handleHold(state: NotificationState): TransitionResult {
  if (state.phase !== "center-list" && state.phase !== "center-detail") {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      phase: "center-confirm-clear",
    },
    effects: [],
  };
}

/**
 * Handles the "confirm-clear" event (Requirement 9.10, Property 24): the
 * user confirms the clear-all prompt. Only meaningful from
 * `"center-confirm-clear"` — unconditionally empties `history` (regardless
 * of its length, including already-empty), resets `centerIndex` back to
 * `0`, returns to `"center-list"`, and produces a `"clear-history"` effect.
 * The factory (`createNotificationSystem`, task 9.2) is responsible for
 * persisting the now-empty history via `storage.set` when it executes that
 * effect.
 *
 * No-op for any other phase.
 */
function handleConfirmClear(state: NotificationState): TransitionResult {
  if (state.phase !== "center-confirm-clear") {
    return { state, effects: [] };
  }

  return {
    state: {
      ...state,
      phase: "center-list",
      history: [],
      centerIndex: 0,
    },
    effects: [{ kind: "clear-history" }],
  };
}

// === Core transition ===

/**
 * The single pure transition function driving the whole Notification_System.
 * Exported for PBT — this is where Properties 12–24 are verified.
 *
 * The "push" event (Requirement 7.1, Property 12), "duration-elapsed" event
 * (Requirement 7.4, Property 13), the "tap" → "expanded" transition for the
 * banner phase (Requirement 8.1, 8.2), the "swipe-dismiss" archive+dismiss
 * transition for the banner phase (Requirement 8.3, Property 16), the
 * "tap" → archive+close transition for the expanded phase (Requirement 8.4,
 * Property 17), the "open-center"/"center-nav"/"center-select"/
 * "center-close" transitions for the Notification_Center phases
 * (Requirement 9.4, 9.5, 9.6, 9.7, 9.8; Property 20–22), and the
 * "hold"/"confirm-clear" transitions for the clear-all confirmation prompt
 * (Requirement 9.9, 9.10; Property 23–24) are all implemented here. Every
 * known `NotificationEvent["type"]` now has a dedicated handler; `default`
 * remains only as an exhaustiveness fallback.
 */
export function transition(
  state: NotificationState,
  event: NotificationEvent,
): TransitionResult {
  switch (event.type) {
    case "push":
      return handlePush(state, event.entry);
    case "duration-elapsed":
      return handleDurationElapsed(state);
    case "tap":
      return handleTap(state);
    case "swipe-dismiss":
      return handleSwipeDismiss(state);
    case "open-center":
      return handleOpenCenter(state);
    case "center-nav":
      return handleCenterNav(state, event.direction);
    case "center-select":
      return handleCenterSelect(state);
    case "center-close":
      return handleCenterClose(state);
    case "hold":
      return handleHold(state);
    case "confirm-clear":
      return handleConfirmClear(state);
    default:
      return { state, effects: [] };
  }
}
