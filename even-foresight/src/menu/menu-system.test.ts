import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  truncateText,
  navigateDown,
  navigateUp,
  createMenuSystem,
} from "./menu-system";
import type { MenuEntry } from "./types";

// ─── Pure Function Tests ──────────────────────────────────────────────────────

describe("truncateText", () => {
  it("returns original string when length <= maxLength", () => {
    expect(truncateText("Hello", 20)).toBe("Hello");
  });

  it("returns original string when length equals maxLength exactly", () => {
    expect(truncateText("12345678901234567890", 20)).toBe(
      "12345678901234567890",
    );
  });

  it("truncates and adds ellipsis when length > maxLength", () => {
    expect(truncateText("This is a very long app name!", 20)).toBe(
      "This is a very lo...",
    );
  });

  it("produces string of exactly maxLength when truncating", () => {
    const result = truncateText("A string that exceeds the limit", 20);
    expect(result.length).toBe(20);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncateText("", 20)).toBe("");
  });

  it("handles maxLength of 3 (minimum to show ellipsis)", () => {
    expect(truncateText("ABCD", 3)).toBe("...");
  });

  it("handles single character under limit", () => {
    expect(truncateText("A", 20)).toBe("A");
  });
});

describe("navigateDown", () => {
  it("increments index by 1", () => {
    expect(navigateDown(0, 5)).toBe(1);
    expect(navigateDown(2, 5)).toBe(3);
  });

  it("clamps to last entry when at the end", () => {
    expect(navigateDown(4, 5)).toBe(4);
  });

  it("stays at last entry when already at last", () => {
    expect(navigateDown(9, 10)).toBe(9);
  });

  it("handles single entry list", () => {
    expect(navigateDown(0, 1)).toBe(0);
  });
});

describe("navigateUp", () => {
  it("decrements index by 1", () => {
    expect(navigateUp(3)).toBe(2);
    expect(navigateUp(1)).toBe(0);
  });

  it("clamps to 0 when at the first entry", () => {
    expect(navigateUp(0)).toBe(0);
  });

  it("stays at 0 when already at 0", () => {
    expect(navigateUp(0)).toBe(0);
  });
});

// ─── MenuSystem Integration Tests ────────────────────────────────────────────

function createMockBridge() {
  return {
    rebuildPageContainer: vi.fn().mockResolvedValue(true),
    textContainerUpgrade: vi.fn().mockResolvedValue(true),
  } as any;
}

function createMockEntries(count: number): MenuEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `app-${i}`,
    name: `App ${i}`,
    activate: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  }));
}

describe("createMenuSystem", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("show()", () => {
    it("sets isVisible to true when entries exist", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      expect(menu.isVisible).toBe(false);
      await menu.show();
      expect(menu.isVisible).toBe(true);
    });

    it("calls rebuildPageContainer with container 2", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();

      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
      const call = bridge.rebuildPageContainer.mock.calls[0][0];
      expect(call.containerTotalNum).toBe(1);
    });

    it("does not show menu when zero entries and calls onNoApps", async () => {
      const bridge = createMockBridge();
      const onNoApps = vi.fn();
      const menu = createMenuSystem(bridge, [], { onNoApps });

      await menu.show();

      expect(menu.isVisible).toBe(false);
      expect(onNoApps).toHaveBeenCalledTimes(1);
      expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    });

    it("does nothing if already visible", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      await menu.show();

      // Only one rebuildPageContainer call
      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    });

    it("limits entries to 10 maximum", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(15);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();

      // Should have been rendered with only 10 entries
      const call = bridge.rebuildPageContainer.mock.calls[0][0];
      const content = call.textObject[0].content;
      const lines = content.split("\n");
      expect(lines.length).toBe(10);
    });
  });

  describe("hide()", () => {
    it("sets isVisible to false", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      expect(menu.isVisible).toBe(true);

      await menu.hide();
      expect(menu.isVisible).toBe(false);
    });

    it("clears the menu container", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      await menu.hide();

      // 2 calls: one for show (render menu), one for hide (clear)
      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(2);
    });

    it("does nothing if not visible", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.hide();

      expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    });

    it("resets highlight to 0", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(5);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      menu.moveDown();
      menu.moveDown();
      await menu.hide();

      // Re-show should start at index 0
      await menu.show();
      const call =
        bridge.rebuildPageContainer.mock.calls[
          bridge.rebuildPageContainer.mock.calls.length - 1
        ][0];
      const content = call.textObject[0].content;
      expect(content.startsWith("> ")).toBe(true);
    });
  });

  describe("moveDown()", () => {
    it("moves highlight to the next entry", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      menu.moveDown();

      expect(bridge.textContainerUpgrade).toHaveBeenCalled();
      const call =
        bridge.textContainerUpgrade.mock.calls[
          bridge.textContainerUpgrade.mock.calls.length - 1
        ][0];
      const lines = call.content.split("\n");
      expect(lines[0]).toMatch(/^\s{2}/); // first entry not highlighted
      expect(lines[1]).toMatch(/^> /); // second entry highlighted
    });

    it("does not move past the last entry", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(2);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();

      // Move down past end
      vi.advanceTimersByTime(400); // pass debounce
      menu.moveDown();
      vi.advanceTimersByTime(400);
      menu.moveDown();
      vi.advanceTimersByTime(400);
      menu.moveDown(); // should stay at index 1

      const lastCall =
        bridge.textContainerUpgrade.mock.calls[
          bridge.textContainerUpgrade.mock.calls.length - 1
        ][0];
      const lines = lastCall.content.split("\n");
      expect(lines[1]).toMatch(/^> /); // still on last entry
    });

    it("does nothing if menu is not visible", () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      menu.moveDown();

      expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    });
  });

  describe("moveUp()", () => {
    it("moves highlight to the previous entry", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      menu.moveDown();
      vi.advanceTimersByTime(400); // pass debounce
      menu.moveUp();

      const lastCall =
        bridge.textContainerUpgrade.mock.calls[
          bridge.textContainerUpgrade.mock.calls.length - 1
        ][0];
      const lines = lastCall.content.split("\n");
      expect(lines[0]).toMatch(/^> /); // back to first
    });

    it("does not move before the first entry", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      menu.moveUp(); // already at 0

      // Should update display but stay at 0
      const lastCall =
        bridge.textContainerUpgrade.mock.calls[
          bridge.textContainerUpgrade.mock.calls.length - 1
        ][0];
      const lines = lastCall.content.split("\n");
      expect(lines[0]).toMatch(/^> /); // still on first
    });
  });

  describe("select()", () => {
    it("activates the highlighted entry and hides the menu", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      await menu.select();

      expect(entries[0].activate).toHaveBeenCalledTimes(1);
      expect(menu.isVisible).toBe(false);
    });

    it("activates the correct entry after navigating", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(5);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      menu.moveDown(); // index 1
      vi.advanceTimersByTime(400);
      menu.moveDown(); // index 2
      await menu.select();

      expect(entries[2].activate).toHaveBeenCalledTimes(1);
      expect(menu.isVisible).toBe(false);
    });

    it("does nothing if not visible", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.select();

      expect(entries[0].activate).not.toHaveBeenCalled();
    });
  });

  describe("auto-dismiss", () => {
    it("hides menu after 30 seconds of no input", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      expect(menu.isVisible).toBe(true);

      vi.advanceTimersByTime(30_000);

      expect(menu.isVisible).toBe(false);
    });

    it("resets timeout on moveDown", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();

      // Advance 25 seconds, then interact
      vi.advanceTimersByTime(25_000);
      menu.moveDown();

      // Advance another 25 seconds (would have timed out at 30s without reset)
      vi.advanceTimersByTime(25_000);
      expect(menu.isVisible).toBe(true);

      // Now wait the full 30s from last interaction
      vi.advanceTimersByTime(5_000);
      expect(menu.isVisible).toBe(false);
    });

    it("resets timeout on moveUp", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      menu.moveDown(); // move down first so moveUp has somewhere to go

      vi.advanceTimersByTime(25_000);
      menu.moveUp(); // reset timer

      vi.advanceTimersByTime(25_000);
      expect(menu.isVisible).toBe(true);

      vi.advanceTimersByTime(5_000);
      expect(menu.isVisible).toBe(false);
    });

    it("clears timeout on hide()", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(3);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();
      await menu.hide();

      // Advancing time should not cause issues
      vi.advanceTimersByTime(30_000);
      expect(menu.isVisible).toBe(false);
    });
  });

  describe("scroll debounce", () => {
    it("rejects scroll events within 300ms of each other", async () => {
      const bridge = createMockBridge();
      const entries = createMockEntries(5);
      const menu = createMenuSystem(bridge, entries);

      await menu.show();

      // First scroll should work (lastScrollTime is 0 initially)
      menu.moveDown(); // index 0 -> 1
      const callCount1 = bridge.textContainerUpgrade.mock.calls.length;

      // Immediate second scroll should be rejected
      menu.moveDown();
      const callCount2 = bridge.textContainerUpgrade.mock.calls.length;
      expect(callCount2).toBe(callCount1); // no new call

      // After 300ms, should work
      vi.advanceTimersByTime(300);
      menu.moveDown(); // index 1 -> 2
      const callCount3 = bridge.textContainerUpgrade.mock.calls.length;
      expect(callCount3).toBe(callCount1 + 1);
    });
  });

  describe("text truncation in display", () => {
    it("truncates app names longer than 20 characters", async () => {
      const bridge = createMockBridge();
      const entries: MenuEntry[] = [
        {
          id: "long-name",
          name: "A Very Long Application Name That Exceeds Limit",
          activate: vi.fn().mockResolvedValue(undefined),
          cleanup: vi.fn().mockResolvedValue(undefined),
        },
      ];
      const menu = createMenuSystem(bridge, entries);

      await menu.show();

      const call = bridge.rebuildPageContainer.mock.calls[0][0];
      const content = call.textObject[0].content;
      // "> " prefix + truncated name
      expect(content).toBe("> A Very Long Appli...");
    });
  });
});
