import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { processQueue, processAfterDismiss } from "./banner-system";
import type { BannerNotification } from "./types";

/**
 * Feature: even-hub, Property 16: Banner Queue Processing
 *
 * For any banner queue state after the current banner is dismissed:
 * if the queue is non-empty, the next item SHALL be dequeued and become
 * the active banner; if the queue is empty, no banner SHALL be active.
 *
 * Validates: Requirements 8.3
 */

/**
 * Feature: even-hub, Property 17: Banner Queue Capacity Invariant
 *
 * For any banner queue and a new notification: if queue.length < 5, the new
 * notification SHALL be appended and queue.length SHALL increase by 1; if
 * queue.length = 5, the oldest entry SHALL be removed and the new notification
 * SHALL be appended, resulting in queue.length = 5 with the new notification at the end.
 *
 * Validates: Requirements 8.5, 8.6
 */

// --- Arbitraries ---

const arbBannerNotification: fc.Arbitrary<BannerNotification> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 1, maxLength: 50 }),
  duration: fc.option(fc.integer({ min: 3, max: 15 }), { nil: undefined }),
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
});

// Defined for future use when testing queue ordering properties
// const arbBannerQueue = fc.array(arbBannerNotification, {
//   minLength: 0,
//   maxLength: 5,
// });

// --- Property Tests ---

describe("Feature: even-hub, Property 16: Banner Queue Processing", () => {
  it("non-empty queue: after dismiss, first item becomes active and rest is remaining queue", () => {
    fc.assert(
      fc.property(
        fc.array(arbBannerNotification, { minLength: 1, maxLength: 5 }),
        (queue) => {
          const result = processAfterDismiss(queue);

          // The active banner should be the first item in the queue
          expect(result.active).toEqual(queue[0]);

          // The remaining queue should be queue.slice(1)
          expect(result.remainingQueue).toEqual(queue.slice(1));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("empty queue: after dismiss, no banner is active and remaining queue is empty", () => {
    fc.assert(
      fc.property(
        fc.constant([] as BannerNotification[]),
        (queue: BannerNotification[]) => {
          const result = processAfterDismiss(queue);

          expect(result.active).toBeNull();
          expect(result.remainingQueue).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Feature: even-hub, Property 17: Banner Queue Capacity Invariant", () => {
  it("queue below capacity: append increases length by 1 and new notification is last", () => {
    fc.assert(
      fc.property(
        fc.array(arbBannerNotification, { minLength: 0, maxLength: 4 }),
        arbBannerNotification,
        (queue, newNotif) => {
          const result = processQueue(queue, newNotif);

          // Length increases by 1
          expect(result.length).toBe(queue.length + 1);

          // Last item is the new notification
          expect(result[result.length - 1]).toEqual(newNotif);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("queue at capacity (5): oldest removed, new appended, length stays 5", () => {
    fc.assert(
      fc.property(
        fc.array(arbBannerNotification, { minLength: 5, maxLength: 5 }),
        arbBannerNotification,
        (queue, newNotif) => {
          const result = processQueue(queue, newNotif);

          // Length stays 5
          expect(result.length).toBe(5);

          // Oldest (index 0) is dropped — result starts from queue[1]
          expect(result.slice(0, 4)).toEqual(queue.slice(1));

          // Last item is the new notification
          expect(result[4]).toEqual(newNotif);
        },
      ),
      { numRuns: 100 },
    );
  });
});
