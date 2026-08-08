/**
 * Press/release signal adapter — spike (Task 2.3).
 *
 * Hold gesture classification (`classifyPress`, `src/gesture-router.ts`,
 * task 2.1) is a pure function over abstract `pressStartMs` / `releaseMs` /
 * `nowMs` timestamps, deliberately decoupled from the raw SDK event shape
 * (see design.md, Architecture decision 3). This module is the other half:
 * it attempts to *produce* those two signals from the currently-documented
 * SDK touchpad event surface.
 *
 * That surface — `CLICK_EVENT`, `DOUBLE_CLICK_EVENT`, `SCROLL_TOP_EVENT`,
 * `SCROLL_BOTTOM_EVENT` — does not currently expose a distinct touch-down
 * event ahead of the gesture it reports (see
 * `reference/sdk/sdk-capabilities.md`, "Limitations: No long-press
 * detection"). Each of those four events is itself the complete, atomic
 * notification for a gesture that has *already finished* by the time it
 * arrives — there is no earlier "finger went down" moment to anchor a
 * `pressStartMs` on. So the honest signal this adapter can derive today
 * collapses press-start and press-end onto the same instant (the event's
 * arrival time), which always yields a 0ms hold duration.
 *
 * That is the explicit fallback described in Requirements 10.1–10.3: since
 * no distinguishable press-start signal exists yet, this adapter always
 * resolves `"released"` and never `"hold"`, so the rest of the system
 * degrades gracefully to the existing tap/double-tap classification path
 * until real press/release hardware signals become available (see the
 * Error Handling / integration-risk note in design.md).
 *
 * Requirements: 10.1, 10.2, 10.3
 */

import { classifyEvent, type RawInput } from "./glasses/input-router";
import { classifyPress } from "./gesture-router";

/**
 * The `pressStartMs` / `releaseMs` / `nowMs` shape `classifyPress`
 * (`src/gesture-router.ts`, task 2.1) is designed to consume. Kept as a
 * standalone type here (rather than imported) because task 2.1 may not be
 * implemented yet when this spike runs — see the TODO in
 * `resolvePressState` below for the intended integration point.
 */
export interface PressReleaseSignal {
  pressStartMs: number;
  releaseMs: number | null;
  nowMs: number;
}

/** Mirrors the three-way return shape `classifyPress` will produce. */
export type PressResolution =
  | { classification: "hold" }
  | { classification: "pending" }
  | { classification: "released"; heldMs: number };

export interface PressAdapterHandlers {
  /** Fired for every recognised touchpad event once resolved. */
  onResolution(resolution: PressResolution, rawInput: RawInput): void;
  /** Optional diagnostic sink, e.g. wired to the phone debug log. */
  onDiagnostic?(message: string): void;
}

export interface PressAdapter {
  /** Feed one raw `onEvenHubEvent` payload. */
  handleEvent(event: unknown, nowMs?: number): void;
}

/**
 * Attempts to derive a press-start/press-end signal pair from a single raw
 * SDK touchpad event.
 *
 * Returns `null` when the event isn't a touchpad gesture at all (exit
 * events, unrecognised payloads) — there is nothing press-like to report.
 * Otherwise returns a signal whose `pressStartMs` and `releaseMs` are the
 * same instant, per the module-level fallback rationale above.
 *
 * Exported standalone (rather than inlined in `resolvePressState`) so a
 * later hardware/firmware update that *does* expose a real touch-down event
 * only needs to change this function's body, not its callers.
 */
export function deriveSignalFromEvent(
  event: unknown,
  nowMs: number,
): { signal: PressReleaseSignal; rawInput: RawInput } | null {
  const rawInput = classifyEvent(event);
  if (rawInput === "exit" || rawInput === "unknown") return null;

  return {
    signal: { pressStartMs: nowMs, releaseMs: nowMs, nowMs },
    rawInput,
  };
}

/**
 * Resolves a derived signal into the same three-way shape `classifyPress`
 * returns.
 *
 * (Task 13.3) Now calls the real `classifyPress` from `src/gesture-router.ts`
 * (task 2.1), which did not exist yet when this spike (task 2.3) was written
 * — see the git history of this function for the inline fallback it used to
 * carry. This keeps `HOLD_THRESHOLD_MS` defined in exactly one place.
 *
 * Explicit fallback (Requirements 10.1–10.3) still applies, unchanged: it
 * is now a property of the *input* rather than this function's logic.
 * `deriveSignalFromEvent` always sets `pressStartMs === releaseMs` (both the
 * event's arrival time), since the currently-documented SDK event surface
 * gives no earlier touch-down signal to anchor a real press-start on. Fed
 * through `classifyPress`, that always yields `heldMs: 0` — always below
 * `HOLD_THRESHOLD_MS` (600ms per design.md) — so this still always resolves
 * `"released"`, never `"hold"` or `"pending"`, despite now going through the
 * real classification function instead of a hardcoded stand-in.
 */
export function resolvePressState(signal: PressReleaseSignal): PressResolution {
  return classifyPress(signal.pressStartMs, signal.releaseMs, signal.nowMs);
}

/**
 * Creates the press/release adapter.
 *
 * Feeds every raw SDK event through `deriveSignalFromEvent` /
 * `resolvePressState` and reports the result via `handlers.onResolution`.
 * Logs the raw event first, matching `weather.ts`'s `console.log(...)`
 * instrumentation style, so real touchpad behavior can be checked against
 * the simulator before any Hold-gesture UI is wired up to depend on it.
 */
export function createPressAdapter(
  handlers: PressAdapterHandlers,
): PressAdapter {
  return {
    handleEvent(event: unknown, nowMs: number = Date.now()): void {
      console.log("[PressAdapter] raw event:", event);

      const derived = deriveSignalFromEvent(event, nowMs);
      if (derived === null) {
        handlers.onDiagnostic?.("PRESS ADAPTER: non-touchpad event, ignored");
        return;
      }

      const resolution = resolvePressState(derived.signal);
      console.log(
        "[PressAdapter] resolved:",
        derived.rawInput,
        "->",
        resolution,
      );
      handlers.onDiagnostic?.(
        `PRESS ADAPTER: ${derived.rawInput} -> ${resolution.classification}`,
      );
      handlers.onResolution(resolution, derived.rawInput);
    },
  };
}
