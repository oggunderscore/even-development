import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { Reminder } from "../storage/schemas";
import { REMINDER_TITLE_MAX_LENGTH } from "../constants";
import {
  strikethroughText,
  sortRemindersChronologically,
  isReminderVisible,
  visibleReminders,
  pruneExpiredCompleted,
  toggleReminderCompletion,
  clampHighlightIndex,
  clampScrollToHighlight,
} from "./reminders-list";

const UNDO_WINDOW_MS = 5_000;

const arbReminder: fc.Arbitrary<Reminder> = fc
  .record({
    id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: REMINDER_TITLE_MAX_LENGTH }),
    targetTime: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    completed: fc.boolean(),
    completedAt: fc.option(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      { nil: undefined },
    ),
  })
  // A completed reminder with no completedAt is a defensive edge case
  // covered explicitly in the unit tests, not generated at random here.
  .filter((r) => !r.completed || r.completedAt !== undefined);

const arbReminderList = fc.array(arbReminder, { minLength: 0, maxLength: 20 });

describe("Feature: foresight-reminders-list, strikethroughText", () => {
  it("preserves every character and doubles the length by inserting the combining stroke after each one", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 30 }), (text) => {
        const chars = Array.from(text);
        const result = strikethroughText(text);
        expect(Array.from(result).length).toBe(chars.length * 2);
        // Every original character still appears, in order, at even offsets.
        expect(result.replace(/̶/g, "")).toBe(text);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-reminders-list, sortRemindersChronologically", () => {
  it("returns reminders in non-decreasing targetTime order", () => {
    fc.assert(
      fc.property(arbReminderList, (reminders) => {
        const sorted = sortRemindersChronologically(reminders);
        expect(sorted).toHaveLength(reminders.length);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].targetTime).toBeGreaterThanOrEqual(
            sorted[i - 1].targetTime,
          );
        }
        // Same multiset of ids, none dropped or duplicated.
        expect(new Set(sorted.map((r) => r.id))).toEqual(
          new Set(reminders.map((r) => r.id)),
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-reminders-list, isReminderVisible / visibleReminders", () => {
  it("is true for every uncompleted reminder regardless of time", () => {
    fc.assert(
      fc.property(
        arbReminder,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (reminder, now) => {
          fc.pre(!reminder.completed);
          expect(isReminderVisible(reminder, now, UNDO_WINDOW_MS)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for a completed reminder, is true iff now - completedAt < undoWindowMs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER - UNDO_WINDOW_MS }),
        fc.integer({ min: 0, max: UNDO_WINDOW_MS * 3 }),
        (completedAt, elapsed) => {
          const now = completedAt + elapsed;
          const reminder: Reminder = {
            id: "x",
            title: "t",
            targetTime: 0,
            completed: true,
            completedAt,
          };
          const expected = elapsed < UNDO_WINDOW_MS;
          expect(isReminderVisible(reminder, now, UNDO_WINDOW_MS)).toBe(
            expected,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("visibleReminders is exactly the sorted list filtered by isReminderVisible", () => {
    fc.assert(
      fc.property(
        arbReminderList,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (reminders, now) => {
          const result = visibleReminders(reminders, now, UNDO_WINDOW_MS);
          const expected = sortRemindersChronologically(reminders).filter(
            (r) => isReminderVisible(r, now, UNDO_WINDOW_MS),
          );
          expect(result).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-reminders-list, pruneExpiredCompleted", () => {
  it("keeps a reminder iff isReminderVisible is true, preserving input order", () => {
    fc.assert(
      fc.property(
        arbReminderList,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (reminders, now) => {
          const result = pruneExpiredCompleted(reminders, now, UNDO_WINDOW_MS);
          const expected = reminders.filter((r) =>
            isReminderVisible(r, now, UNDO_WINDOW_MS),
          );
          expect(result).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-reminders-list, toggleReminderCompletion", () => {
  it("marking an uncompleted reminder complete sets completed=true and completedAt=now, others unchanged", () => {
    fc.assert(
      fc.property(
        arbReminderList,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (reminders, now) => {
          const uncompleted = reminders.filter((r) => !r.completed);
          fc.pre(uncompleted.length > 0);
          const target = uncompleted[0];

          const result = toggleReminderCompletion(
            reminders,
            target.id,
            now,
            UNDO_WINDOW_MS,
          );

          const updated = result.find((r) => r.id === target.id)!;
          expect(updated.completed).toBe(true);
          expect(updated.completedAt).toBe(now);

          for (const r of reminders) {
            if (r.id === target.id) continue;
            expect(result.find((x) => x.id === r.id)).toEqual(r);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("tapping a reminder still inside its undo window undoes completion", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER - UNDO_WINDOW_MS }),
        fc.integer({ min: 0, max: UNDO_WINDOW_MS - 1 }),
        (completedAt, elapsed) => {
          const now = completedAt + elapsed;
          const reminders: Reminder[] = [
            { id: "x", title: "t", targetTime: 0, completed: true, completedAt },
          ];
          const result = toggleReminderCompletion(
            reminders,
            "x",
            now,
            UNDO_WINDOW_MS,
          );
          expect(result[0].completed).toBe(false);
          expect(result[0].completedAt).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is a no-op when id is not found", () => {
    fc.assert(
      fc.property(
        arbReminderList,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (reminders, now) => {
          fc.pre(reminders.every((r) => r.id !== "missing"));
          const result = toggleReminderCompletion(
            reminders,
            "missing",
            now,
            UNDO_WINDOW_MS,
          );
          expect(result).toEqual(reminders);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-reminders-list, clampHighlightIndex", () => {
  it("clamps into [0, length-1], and returns 0 for an empty list", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 0, max: 30 }),
        (index, length) => {
          const result = clampHighlightIndex(index, length);
          if (length <= 0) {
            expect(result).toBe(0);
          } else {
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(length - 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-reminders-list, clampScrollToHighlight", () => {
  it("keeps the highlighted row within [scrollOffset, scrollOffset + visibleLines)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        (highlightIndex, scrollOffset, visibleLines) => {
          const result = clampScrollToHighlight(
            highlightIndex,
            scrollOffset,
            visibleLines,
          );
          expect(highlightIndex).toBeGreaterThanOrEqual(result);
          expect(highlightIndex).toBeLessThan(result + visibleLines);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not move the offset when the highlight is already visible", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 10 }),
        (scrollOffset, visibleLines) => {
          const highlightIndex =
            scrollOffset + Math.floor(visibleLines / 2);
          expect(
            clampScrollToHighlight(highlightIndex, scrollOffset, visibleLines),
          ).toBe(scrollOffset);
        },
      ),
      { numRuns: 100 },
    );
  });
});
