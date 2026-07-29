import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyEvent,
  clampDoubleTapWindow,
  createInputRouter,
  type Gesture,
} from "./input-router";
import {
  DOUBLE_TAP_DEFAULT_MS,
  DOUBLE_TAP_MIN_MS,
  DOUBLE_TAP_MAX_MS,
} from "../constants";

const CLICK = 0;
const SCROLL_TOP = 1;
const SCROLL_BOTTOM = 2;
const DOUBLE_CLICK = 3;
const ABNORMAL_EXIT = 6;
const SYSTEM_EXIT = 7;

describe("classifyEvent", () => {
  it("treats a textEvent with an omitted eventType as a tap", () => {
    // CLICK_EVENT is 0 and protobuf omits zero-valued fields, so this is the
    // shape a real single tap arrives in.
    expect(classifyEvent({ textEvent: {} })).toBe("tap");
  });

  it("treats an explicit CLICK_EVENT as a tap", () => {
    expect(classifyEvent({ textEvent: { eventType: CLICK } })).toBe("tap");
  });

  it("recognises hardware double-taps from either channel", () => {
    expect(classifyEvent({ textEvent: { eventType: DOUBLE_CLICK } })).toBe(
      "double-tap",
    );
    expect(classifyEvent({ sysEvent: { eventType: DOUBLE_CLICK } })).toBe(
      "double-tap",
    );
  });

  it("maps scroll events to directions", () => {
    expect(classifyEvent({ textEvent: { eventType: SCROLL_TOP } })).toBe(
      "scroll-up",
    );
    expect(classifyEvent({ textEvent: { eventType: SCROLL_BOTTOM } })).toBe(
      "scroll-down",
    );
  });

  it("maps both exit events to exit", () => {
    expect(classifyEvent({ sysEvent: { eventType: SYSTEM_EXIT } })).toBe(
      "exit",
    );
    expect(classifyEvent({ sysEvent: { eventType: ABNORMAL_EXIT } })).toBe(
      "exit",
    );
  });

  it("does not invent a tap from an unrelated sysEvent", () => {
    // Only a textEvent implies touch input; a bare sysEvent must not be
    // misread as a tap or the HUD would react to lifecycle notifications.
    expect(classifyEvent({ sysEvent: { eventType: 4 } })).toBe("unknown");
    expect(classifyEvent({})).toBe("unknown");
    expect(classifyEvent(null)).toBe("unknown");
    expect(classifyEvent(undefined)).toBe("unknown");
  });
});

describe("clampDoubleTapWindow", () => {
  it("clamps to the supported range", () => {
    expect(clampDoubleTapWindow(50)).toBe(DOUBLE_TAP_MIN_MS);
    expect(clampDoubleTapWindow(5000)).toBe(DOUBLE_TAP_MAX_MS);
    expect(clampDoubleTapWindow(350)).toBe(350);
  });

  it("falls back to the default for non-numeric input", () => {
    expect(clampDoubleTapWindow(undefined)).toBe(DOUBLE_TAP_DEFAULT_MS);
    expect(clampDoubleTapWindow("400")).toBe(DOUBLE_TAP_DEFAULT_MS);
    expect(clampDoubleTapWindow(NaN)).toBe(DOUBLE_TAP_DEFAULT_MS);
  });
});

describe("createInputRouter", () => {
  let gestures: Gesture[];
  let onExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    gestures = [];
    onExit = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRouter(windowMs = DOUBLE_TAP_DEFAULT_MS) {
    const router = createInputRouter({
      onGesture: (g) => gestures.push(g),
      onExit,
    });
    router.setDoubleTapWindow(windowMs);
    return router;
  }

  const tap = { textEvent: {} };

  it("reports a lone tap only after the double-tap window closes", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    expect(gestures).toEqual([]);

    vi.advanceTimersByTime(399);
    expect(gestures).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(gestures).toEqual(["tap"]);

    router.dispose();
  });

  it("synthesises a double-tap from two quick taps and suppresses the single", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    vi.advanceTimersByTime(100);
    router.handleEvent(tap);

    expect(gestures).toEqual(["double-tap"]);

    // The pending single tap must not fire afterwards.
    vi.advanceTimersByTime(1000);
    expect(gestures).toEqual(["double-tap"]);

    router.dispose();
  });

  it("reports two slow taps as two single taps", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    vi.advanceTimersByTime(500);
    router.handleEvent(tap);
    vi.advanceTimersByTime(500);

    expect(gestures).toEqual(["tap", "tap"]);

    router.dispose();
  });

  it("does not chain a third tap into a second double-tap", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    vi.advanceTimersByTime(50);
    router.handleEvent(tap); // double-tap
    vi.advanceTimersByTime(50);
    router.handleEvent(tap); // starts a fresh sequence
    vi.advanceTimersByTime(500);

    expect(gestures).toEqual(["double-tap", "tap"]);

    router.dispose();
  });

  it("cancels a pending single tap when hardware reports a double-tap", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    router.handleEvent({ textEvent: { eventType: DOUBLE_CLICK } });
    vi.advanceTimersByTime(1000);

    expect(gestures).toEqual(["double-tap"]);

    router.dispose();
  });

  it("forwards scrolls immediately and abandons a pending tap", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    router.handleEvent({ textEvent: { eventType: SCROLL_BOTTOM } });
    vi.advanceTimersByTime(1000);

    expect(gestures).toEqual(["scroll-down"]);

    router.dispose();
  });

  it("honours an updated double-tap window", () => {
    const router = makeRouter(400);
    router.setDoubleTapWindow(200);

    router.handleEvent(tap);
    vi.advanceTimersByTime(300);
    router.handleEvent(tap);
    vi.advanceTimersByTime(300);

    // 300ms apart is outside a 200ms window — two singles, not a double.
    expect(gestures).toEqual(["tap", "tap"]);

    router.dispose();
  });

  it("calls onExit and drops any pending tap", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    router.handleEvent({ sysEvent: { eventType: SYSTEM_EXIT } });
    vi.advanceTimersByTime(1000);

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(gestures).toEqual([]);

    router.dispose();
  });

  it("dispose cancels a pending tap", () => {
    const router = makeRouter(400);

    router.handleEvent(tap);
    router.dispose();
    vi.advanceTimersByTime(1000);

    expect(gestures).toEqual([]);
  });
});
