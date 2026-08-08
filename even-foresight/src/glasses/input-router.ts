/**
 * Classifies raw `onEvenHubEvent` payloads into the four gestures Foresight
 * understands, and synthesises double-taps the firmware does not send.
 */

import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import {
  DOUBLE_TAP_DEFAULT_MS,
  DOUBLE_TAP_MIN_MS,
  DOUBLE_TAP_MAX_MS,
} from "../constants";

export type Gesture = "tap" | "double-tap" | "scroll-up" | "scroll-down";

/** What a raw event maps to before double-tap synthesis. */
export type RawInput = Gesture | "exit" | "unknown";

/**
 * Compact, bounded dump of a raw event's `sysEvent`/`textEvent`/`listEvent`/
 * `audioEvent` payload, for the "unrecognised" diagnostic. Real-hardware taps
 * were observed classifying as "unknown" with no way to see *why* from the
 * phone's debug log alone (only the native WebView console had the raw
 * object, via `press-adapter.ts`'s `console.log`) — this surfaces the actual
 * shape in the same in-app log the phone UI already shows.
 */
function describeEvent(event: unknown): string {
  try {
    const obj = event as Record<string, unknown> | null | undefined;
    const keys = ["sysEvent", "textEvent", "listEvent", "audioEvent"] as const;
    const present = keys.filter((k) => obj?.[k] !== undefined);
    const body =
      present.length > 0
        ? present.map((k) => `${k}=${JSON.stringify(obj?.[k])}`).join(" ")
        : JSON.stringify(obj);
    return body.length > 160 ? `${body.slice(0, 160)}…` : body;
  } catch {
    return "<unserializable>";
  }
}

/**
 * Classifies one raw SDK event.
 *
 * CLICK_EVENT is 0, and protobuf omits zero-valued fields, so a tap arrives
 * as `eventType: undefined` on `textEvent`. Anything that carries a
 * `textEvent` at all but no recognised type is therefore a tap.
 */
export function classifyEvent(event: any): RawInput {
  const sysType = event?.sysEvent?.eventType ?? -1;
  const textType = event?.textEvent?.eventType ?? -1;

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    return "exit";
  }

  if (
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    return "double-tap";
  }

  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) return "scroll-up";
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return "scroll-down";

  const hasTextEvent = event?.textEvent !== undefined;
  if (
    textType === OsEventTypeList.CLICK_EVENT ||
    (hasTextEvent && event.textEvent?.eventType === undefined)
  ) {
    return "tap";
  }

  return "unknown";
}

/**
 * Clamps a user-configured double-tap window to the supported range.
 */
export function clampDoubleTapWindow(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DOUBLE_TAP_DEFAULT_MS;
  }
  return Math.min(DOUBLE_TAP_MAX_MS, Math.max(DOUBLE_TAP_MIN_MS, value));
}

export interface InputRouterHandlers {
  onGesture(gesture: Gesture): void;
  onExit(): void;
  /** Optional diagnostic sink. */
  onDiagnostic?(message: string): void;
}

export interface InputRouter {
  /** Feed a raw SDK event. */
  handleEvent(event: unknown): void;
  /** Update the software double-tap window (milliseconds). */
  setDoubleTapWindow(ms: unknown): void;
  /** Cancel the pending single-tap timer. */
  dispose(): void;
}

/**
 * Creates the input router.
 *
 * The firmware does not reliably emit DOUBLE_CLICK_EVENT, so a tap is held
 * for `doubleTapWindow` before being reported as a single tap. A hardware
 * double-tap, when it does arrive, cancels that pending single tap so the
 * gesture is never delivered twice.
 */
export function createInputRouter(handlers: InputRouterHandlers): InputRouter {
  let doubleTapWindow = DOUBLE_TAP_DEFAULT_MS;
  let pendingTap: ReturnType<typeof setTimeout> | null = null;
  let lastTapAt = 0;

  function cancelPendingTap(): void {
    if (pendingTap !== null) {
      clearTimeout(pendingTap);
      pendingTap = null;
    }
  }

  function emitDoubleTap(): void {
    cancelPendingTap();
    // Reset so a third tap starts a fresh pair rather than chaining into
    // another double-tap.
    lastTapAt = 0;
    handlers.onGesture("double-tap");
  }

  function handleTap(): void {
    const now = Date.now();
    const elapsed = now - lastTapAt;
    lastTapAt = now;

    if (elapsed < doubleTapWindow) {
      handlers.onDiagnostic?.("DOUBLE TAP (sw)");
      emitDoubleTap();
      return;
    }

    cancelPendingTap();
    pendingTap = setTimeout(() => {
      pendingTap = null;
      handlers.onDiagnostic?.("TAP");
      handlers.onGesture("tap");
    }, doubleTapWindow);
  }

  return {
    handleEvent(event: unknown): void {
      const input = classifyEvent(event);

      switch (input) {
        case "exit":
          cancelPendingTap();
          handlers.onExit();
          return;
        case "double-tap":
          handlers.onDiagnostic?.("DOUBLE TAP (hw)");
          emitDoubleTap();
          return;
        case "tap":
          handleTap();
          return;
        case "scroll-up":
        case "scroll-down":
          // A scroll ends any tap sequence in progress.
          cancelPendingTap();
          lastTapAt = 0;
          handlers.onDiagnostic?.(
            input === "scroll-up" ? "SWIPE UP" : "SWIPE DOWN",
          );
          handlers.onGesture(input);
          return;
        default:
          handlers.onDiagnostic?.(`UNK: ${describeEvent(event)}`);
      }
    },

    setDoubleTapWindow(ms: unknown): void {
      doubleTapWindow = clampDoubleTapWindow(ms);
    },

    dispose(): void {
      cancelPendingTap();
    },
  };
}
