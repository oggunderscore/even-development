import { describe, it, expect } from "vitest";
import {
  calculateSlotPosition,
  isSlotPositionValid,
  slotToContainerId,
} from "./hud-slot";

describe("calculateSlotPosition", () => {
  it("calculates position for top-left slot (0,0)", () => {
    const pos = calculateSlotPosition(0, 0);
    expect(pos).toEqual({ x: 0, y: 0, width: 115, height: 57 });
  });

  it("calculates position for top-right slot (0,4)", () => {
    const pos = calculateSlotPosition(0, 4);
    expect(pos).toEqual({ x: 460, y: 0, width: 115, height: 57 });
  });

  it("calculates position for bottom-left slot (1,0)", () => {
    const pos = calculateSlotPosition(1, 0);
    expect(pos).toEqual({ x: 0, y: 58, width: 115, height: 57 });
  });

  it("calculates position for bottom-right slot (1,4)", () => {
    const pos = calculateSlotPosition(1, 4);
    expect(pos).toEqual({ x: 460, y: 58, width: 115, height: 57 });
  });

  it("calculates position for middle column (0,2)", () => {
    const pos = calculateSlotPosition(0, 2);
    expect(pos).toEqual({ x: 230, y: 0, width: 115, height: 57 });
  });

  it("uses y = row × 58 (57 height + 1 gap)", () => {
    const row0 = calculateSlotPosition(0, 0);
    const row1 = calculateSlotPosition(1, 0);
    expect(row1.y - row0.y).toBe(58);
  });
});

describe("isSlotPositionValid", () => {
  it("returns true for all valid slot positions", () => {
    const rows = [0, 1] as const;
    const cols = [0, 1, 2, 3, 4] as const;

    for (const row of rows) {
      for (const col of cols) {
        const pos = calculateSlotPosition(row, col);
        expect(isSlotPositionValid(pos)).toBe(true);
      }
    }
  });

  it("returns false when x + width exceeds display width", () => {
    expect(isSlotPositionValid({ x: 462, y: 0, width: 115, height: 57 })).toBe(
      false,
    );
  });

  it("returns false when y + height exceeds HUD height", () => {
    expect(isSlotPositionValid({ x: 0, y: 59, width: 115, height: 57 })).toBe(
      false,
    );
  });

  it("returns false for negative x", () => {
    expect(isSlotPositionValid({ x: -1, y: 0, width: 115, height: 57 })).toBe(
      false,
    );
  });

  it("returns false for negative y", () => {
    expect(isSlotPositionValid({ x: 0, y: -1, width: 115, height: 57 })).toBe(
      false,
    );
  });

  it("returns false for zero width", () => {
    expect(isSlotPositionValid({ x: 0, y: 0, width: 0, height: 57 })).toBe(
      false,
    );
  });

  it("returns false for zero height", () => {
    expect(isSlotPositionValid({ x: 0, y: 0, width: 115, height: 0 })).toBe(
      false,
    );
  });

  it("returns true at exact boundary (x + width = 576)", () => {
    // col 4: x = 460, width = 115, 460 + 115 = 575 ≤ 576 ✓
    expect(isSlotPositionValid({ x: 461, y: 0, width: 115, height: 57 })).toBe(
      true,
    );
  });

  it("returns true at exact HUD height boundary (y + height = 115)", () => {
    // row 1: y = 58, height = 57, 58 + 57 = 115 ≤ 115 ✓
    expect(isSlotPositionValid({ x: 0, y: 58, width: 115, height: 57 })).toBe(
      true,
    );
  });
});

describe("slotToContainerId", () => {
  it("maps row 0, col 0 to container ID 1", () => {
    expect(slotToContainerId(0, 0)).toBe(1);
  });

  it("maps row 0, col 4 to container ID 5", () => {
    expect(slotToContainerId(0, 4)).toBe(5);
  });

  it("maps row 1, col 0 to container ID 6", () => {
    expect(slotToContainerId(1, 0)).toBe(6);
  });

  it("maps row 1, col 4 to container ID 10", () => {
    expect(slotToContainerId(1, 4)).toBe(10);
  });

  it("maps all 10 slots to unique IDs 1–10", () => {
    const ids = new Set<number>();
    const rows = [0, 1] as const;
    const cols = [0, 1, 2, 3, 4] as const;

    for (const row of rows) {
      for (const col of cols) {
        ids.add(slotToContainerId(row, col));
      }
    }

    expect(ids.size).toBe(10);
    for (let id = 1; id <= 10; id++) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
