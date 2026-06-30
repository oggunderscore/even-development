import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  findNearestUpcoming,
  validateReminder,
  isReminderTriggered,
  canAddReminder,
  deleteReminder,
} from "./reminders";
import type { Reminder } from "../../storage/schemas";
import { REMINDERS_MAX, REMINDER_TITLE_MAX_LENGTH } from "../../constants";

/**
 * Feature: even-hub, Property 6: Nearest Reminder Selection
 * Feature: even-hub, Property 7: Reminder Validation
 * Feature: even-hub, Property 8: Reminder Trigger Condition
 * Feature: even-hub, Property 9: Reminder Capacity Enforcement
 * Feature: even-hub, Property 10: Reminder Deletion Correctness
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.8
 */

// --- Arbitraries ---

const arbReminder: fc.Arbitrary<Reminder> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: REMINDER_TITLE_MAX_LENGTH }),
  targetTime: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  completed: fc.boolean(),
});

const arbReminderList = fc.array(arbReminder, { minLength: 0, maxLength: 20 });

const arbCurrentTime = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

// --- Property 6: Nearest Reminder Selection ---

describe("Feature: even-hub, Property 6: Nearest Reminder Selection", () => {
  it("returns null if no uncompleted reminder with targetTime > currentTime exists", () => {
    fc.assert(
      fc.property(arbReminderList, arbCurrentTime, (reminders, currentTime) => {
        const hasEligible = reminders.some(
          (r) => !r.completed && r.targetTime > currentTime,
        );

        if (!hasEligible) {
          expect(findNearestUpcoming(reminders, currentTime)).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("returns the reminder with the smallest future targetTime among uncompleted ones", () => {
    fc.assert(
      fc.property(arbReminderList, arbCurrentTime, (reminders, currentTime) => {
        const result = findNearestUpcoming(reminders, currentTime);

        // Filter eligible reminders manually
        const eligible = reminders.filter(
          (r) => !r.completed && r.targetTime > currentTime,
        );

        if (eligible.length === 0) {
          expect(result).toBeNull();
        } else {
          // Find the minimum targetTime among eligible
          const minTime = Math.min(...eligible.map((r) => r.targetTime));
          expect(result).not.toBeNull();
          expect(result!.targetTime).toBe(minTime);
          expect(result!.completed).toBe(false);
          expect(result!.targetTime).toBeGreaterThan(currentTime);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 7: Reminder Validation ---

describe("Feature: even-hub, Property 7: Reminder Validation", () => {
  it("accepts iff title.length ∈ [1, 30] AND targetTime > currentTime", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 60 }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (title, targetTime, currentTime) => {
          const result = validateReminder(title, targetTime, currentTime);

          const titleValid =
            title.length >= 1 && title.length <= REMINDER_TITLE_MAX_LENGTH;
          const timeValid = targetTime > currentTime;
          const expected = titleValid && timeValid;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 8: Reminder Trigger Condition ---

describe("Feature: even-hub, Property 8: Reminder Trigger Condition", () => {
  it("fires iff currentTime >= targetTime for uncompleted reminders", () => {
    // Generate reminder with completed=false
    const arbUncompletedReminder: fc.Arbitrary<Reminder> = fc.record({
      id: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: REMINDER_TITLE_MAX_LENGTH }),
      targetTime: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      completed: fc.constant(false),
    });

    fc.assert(
      fc.property(
        arbUncompletedReminder,
        arbCurrentTime,
        (reminder, currentTime) => {
          const result = isReminderTriggered(reminder, currentTime);
          const expected = currentTime >= reminder.targetTime;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 9: Reminder Capacity Enforcement ---

describe("Feature: even-hub, Property 9: Reminder Capacity Enforcement", () => {
  it("rejects addition when list has exactly 20 reminders", () => {
    const arbFullList = fc.array(arbReminder, {
      minLength: REMINDERS_MAX,
      maxLength: REMINDERS_MAX,
    });

    fc.assert(
      fc.property(arbFullList, (reminders) => {
        expect(reminders).toHaveLength(REMINDERS_MAX);
        expect(canAddReminder(reminders)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 10: Reminder Deletion Correctness ---

describe("Feature: even-hub, Property 10: Reminder Deletion Correctness", () => {
  it("produces list of N-1 preserving all others when deleting a valid ID", () => {
    // Generate a non-empty list with unique IDs, then pick one to delete
    const arbNonEmptyRemindersWithTarget = fc
      .array(arbReminder, { minLength: 1, maxLength: 20 })
      .chain((reminders) => {
        // Ensure unique IDs by assigning them
        const uniqueReminders = reminders.map((r, i) => ({
          ...r,
          id: `id-${i}`,
        }));
        // Pick a random index to delete
        return fc
          .integer({ min: 0, max: uniqueReminders.length - 1 })
          .map((idx) => ({
            reminders: uniqueReminders,
            targetId: uniqueReminders[idx].id,
            targetIdx: idx,
          }));
      });

    fc.assert(
      fc.property(arbNonEmptyRemindersWithTarget, ({ reminders, targetId }) => {
        const originalLength = reminders.length;
        const result = deleteReminder(reminders, targetId);

        // Length is N - 1
        expect(result).toHaveLength(originalLength - 1);

        // Deleted ID is not in result
        expect(result.find((r) => r.id === targetId)).toBeUndefined();

        // All other reminders are preserved
        const expected = reminders.filter((r) => r.id !== targetId);
        expect(result).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});
