import { describe, it, expect, vi } from "vitest";
import {
  calculateSlotPosition,
  isSlotPositionValid,
  isSlotInBounds,
  colToContainerId,
  fitToColumn,
  HudSlotRenderer,
} from "./hud-slot";
import { getTextWidth } from "@evenrealities/pretext";
import {
  CONTAINER,
  CONTAINER_NAME,
  DISPLAY_WIDTH,
  HUD_COLS,
  HUD_HEIGHT,
  HUD_SLOT_WIDTH,
} from "../constants";

describe("calculateSlotPosition", () => {
  it("places each column at its pixel offset", () => {
    for (let col = 0; col < HUD_COLS; col++) {
      expect(calculateSlotPosition(col)).toEqual({
        x: col * HUD_SLOT_WIDTH,
        y: 0,
        width: HUD_SLOT_WIDTH,
        height: HUD_HEIGHT,
      });
    }
  });

  it("keeps every column inside the display width", () => {
    const last = calculateSlotPosition(HUD_COLS - 1);
    expect(last.x + last.width).toBeLessThanOrEqual(DISPLAY_WIDTH);
  });
});

describe("isSlotPositionValid", () => {
  it("accepts every real column position", () => {
    for (let col = 0; col < HUD_COLS; col++) {
      expect(isSlotPositionValid(calculateSlotPosition(col))).toBe(true);
    }
  });

  it("rejects positions that run past the right edge", () => {
    expect(
      isSlotPositionValid({
        x: DISPLAY_WIDTH - 10,
        y: 0,
        width: 50,
        height: 20,
      }),
    ).toBe(false);
  });

  it("rejects negative and zero-sized rectangles", () => {
    expect(isSlotPositionValid({ x: -1, y: 0, width: 10, height: 10 })).toBe(
      false,
    );
    expect(isSlotPositionValid({ x: 0, y: 0, width: 0, height: 10 })).toBe(
      false,
    );
  });
});

describe("isSlotInBounds", () => {
  it("accepts every cell of the 2x5 grid", () => {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < HUD_COLS; col++) {
        expect(isSlotInBounds(row, col)).toBe(true);
      }
    }
  });

  it("rejects out-of-range and non-integer cells", () => {
    expect(isSlotInBounds(2, 0)).toBe(false);
    expect(isSlotInBounds(0, 5)).toBe(false);
    expect(isSlotInBounds(-1, 0)).toBe(false);
    expect(isSlotInBounds(0.5, 0)).toBe(false);
    expect(isSlotInBounds(0, NaN)).toBe(false);
  });
});

describe("colToContainerId", () => {
  it("maps columns onto the reserved HUD container IDs", () => {
    expect(colToContainerId(0)).toBe(CONTAINER.HUD_COL_BASE);
    expect(colToContainerId(4)).toBe(CONTAINER.HUD_COL_BASE + 4);
  });

  it("never collides with the menu or banner containers", () => {
    for (let col = 0; col < HUD_COLS; col++) {
      expect(colToContainerId(col)).not.toBe(CONTAINER.MENU);
      expect(colToContainerId(col)).not.toBe(CONTAINER.BANNER);
    }
  });
});

function createMockBridge() {
  return {
    textContainerUpgrade: vi.fn(async () => true),
  } as any;
}

describe("HudSlotRenderer", () => {
  it("writes content to the matching container ID and name", async () => {
    const bridge = createMockBridge();
    const renderer = new HudSlotRenderer(bridge);

    await renderer.renderColumn(2, "12:30");

    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(1);
    const upgrade = bridge.textContainerUpgrade.mock.calls[0][0];
    expect(upgrade.containerID).toBe(colToContainerId(2));
    expect(upgrade.containerName).toBe(CONTAINER_NAME.hudCol(2));
    expect(upgrade.content).toBe("12:30");
  });

  it("skips the bridge call when content is unchanged", async () => {
    const bridge = createMockBridge();
    const renderer = new HudSlotRenderer(bridge);

    expect(await renderer.renderColumn(0, "72F")).toBe(true);
    expect(await renderer.renderColumn(0, "72F")).toBe(false);
    expect(await renderer.renderColumn(0, "73F")).toBe(true);

    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(2);
  });

  it("memoizes per column, not globally", async () => {
    const bridge = createMockBridge();
    const renderer = new HudSlotRenderer(bridge);

    await renderer.renderColumn(0, "same");
    await renderer.renderColumn(1, "same");

    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(2);
  });

  it("writes through again after reset()", async () => {
    const bridge = createMockBridge();
    const renderer = new HudSlotRenderer(bridge);

    await renderer.renderColumn(0, "x");
    renderer.reset();
    await renderer.renderColumn(0, "x");

    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(2);
  });

  it("clearAll blanks every column exactly once", async () => {
    const bridge = createMockBridge();
    const renderer = new HudSlotRenderer(bridge);

    // Prime each column so the clear is an actual change.
    for (let col = 0; col < HUD_COLS; col++) {
      await renderer.renderColumn(col, `c${col}`);
    }
    bridge.textContainerUpgrade.mockClear();

    await renderer.clearAll();
    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(HUD_COLS);

    // A second clear is a no-op — the columns are already blank.
    bridge.textContainerUpgrade.mockClear();
    await renderer.clearAll();
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
  });
});

describe("fitToColumn", () => {
  it("leaves content that already fits unchanged", () => {
    expect(fitToColumn("10:40")).toBe("10:40");
    expect(fitToColumn("72°F Clear")).toBe("72°F Clear");
    expect(fitToColumn("No reminders")).toBe("No reminders");
  });

  it("truncates content wider than a column", () => {
    const result = fitToColumn("A reminder title that is far too long");
    expect(result.endsWith("...")).toBe(true);
    expect(getTextWidth(result)).toBeLessThanOrEqual(HUD_SLOT_WIDTH);
  });

  it("collapses newlines so one slot cannot claim the other row's line", () => {
    expect(fitToColumn("a\nb")).toBe("a b");
    expect(fitToColumn("a\n  b  ")).toBe("a b");
  });

  it("returns an empty string for blank content", () => {
    expect(fitToColumn("")).toBe("");
    expect(fitToColumn("   ")).toBe("");
    expect(fitToColumn("\n")).toBe("");
  });

  it("never exceeds the column width for any component output", () => {
    // Every string the built-in components can produce must fit on one line.
    const samples = [
      "12:30 AM",
      "23:59",
      "--:--",
      "-40°C Storm",
      "100°F PtCldy",
      "Set location",
      "-- °F",
      "No reminders",
    ];
    for (const sample of samples) {
      expect(getTextWidth(fitToColumn(sample))).toBeLessThanOrEqual(
        HUD_SLOT_WIDTH,
      );
    }
  });
});
