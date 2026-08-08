import { describe, it, expect } from "vitest";
import type { Reminder } from "../storage/schemas";
import {
  strikethroughText,
  formatReminderLine,
  buildReminderListContent,
  isReminderVisible,
} from "./reminders-list";

function reminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: "1",
    title: "Standup",
    targetTime: 0,
    completed: false,
    ...overrides,
  };
}

describe("strikethroughText", () => {
  it("interleaves the combining stroke character after each character", () => {
    expect(strikethroughText("ab")).toBe("a̶b̶");
  });

  it("returns an empty string for empty input", () => {
    expect(strikethroughText("")).toBe("");
  });
});

describe("formatReminderLine", () => {
  it("formats an uncompleted reminder as plain time + title", () => {
    const r = reminder({ title: "Standup", targetTime: Date.UTC(2026, 0, 1, 9, 30) });
    const line = formatReminderLine(r, "24h", 60);
    expect(line).toContain("Standup");
    expect(line).not.toContain("̶");
  });

  it("strikes through a completed reminder's title", () => {
    const r = reminder({
      title: "Standup",
      completed: true,
      completedAt: 0,
      targetTime: Date.UTC(2026, 0, 1, 9, 30),
    });
    const line = formatReminderLine(r, "24h", 60);
    expect(line).toContain("̶");
  });

  it("truncates long lines to maxLength", () => {
    const r = reminder({ title: "A very long reminder title that overflows" });
    const line = formatReminderLine(r, "24h", 20);
    expect(line.length).toBe(20);
    expect(line.endsWith("...")).toBe(true);
  });
});

describe("buildReminderListContent", () => {
  it("returns a placeholder for an empty list", () => {
    expect(buildReminderListContent([], 0, 0, "24h", 6, 40)).toBe(
      "No reminders",
    );
  });

  it("prefixes the highlighted row with '> ' and others with two spaces", () => {
    const reminders = [
      reminder({ id: "a", title: "First", targetTime: 1 }),
      reminder({ id: "b", title: "Second", targetTime: 2 }),
    ];
    const content = buildReminderListContent(reminders, 1, 0, "24h", 6, 40);
    const lines = content.split("\n");
    expect(lines[0].startsWith("  ")).toBe(true);
    expect(lines[1].startsWith("> ")).toBe(true);
  });

  it("only renders the window from scrollOffset to scrollOffset + visibleLines", () => {
    const reminders = Array.from({ length: 5 }, (_, i) =>
      reminder({ id: String(i), title: `R${i}`, targetTime: i }),
    );
    const content = buildReminderListContent(reminders, 3, 2, "24h", 2, 40);
    const lines = content.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("R2");
    expect(lines[1]).toContain("R3");
  });
});

describe("isReminderVisible edge case: completed with no completedAt", () => {
  it("treats a completed reminder missing completedAt as already expired", () => {
    const r = reminder({ completed: true });
    expect(isReminderVisible(r, Date.now(), 5000)).toBe(false);
  });
});
