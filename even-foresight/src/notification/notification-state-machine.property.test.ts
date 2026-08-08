import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { transition, type NotificationState } from "./notification-state-machine";
import type { NotificationEntry } from "../storage/schemas";
import { BANNER_QUEUE_MAX } from "../constants";

/**
 * Queue invariants for the Notification_System.
 *
 * These restore the two properties that `banner/banner-system.property.test.ts`
 * guarded before `BannerSystem` was replaced (Property 16: Banner Queue
 * Processing, Property 17: Banner Queue Capacity Invariant). The queue logic
 * they cover did not go away with that module — it moved into
 * `notification-state-machine.ts`'s `enqueue`/dismiss-advance handling, which
 * still caps the queue at `BANNER_QUEUE_MAX` and drops the oldest entry on
 * overflow. `enqueue` is private, so these drive it through the exported
 * `transition()` (the module's documented PBT entry point) instead.
 */

const entryArb = (idPrefix: string) =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${idPrefix}-${s}`),
    sourceAppId: fc.constant("test"),
    sourceAppName: fc.constant("Test"),
    text: fc.string({ minLength: 1, maxLength: 80 }),
    timestamp: fc.integer({ min: 0, max: 2 ** 40 }),
  });

function stateWith(
  active: NotificationEntry | null,
  queue: NotificationEntry[],
): NotificationState {
  return {
    phase: active === null ? "idle" : "banner",
    active,
    queue,
    priorPhase: "idle",
    centerIndex: 0,
    history: [],
    historyMax: 10,
  };
}

describe("Property 16: Banner queue processing", () => {
  it("non-empty queue: dismissing the active banner promotes the first queued entry and keeps the rest in order", () => {
    fc.assert(
      fc.property(
        entryArb("active"),
        fc.array(entryArb("queued"), { minLength: 1, maxLength: BANNER_QUEUE_MAX }),
        (active, queue) => {
          const result = transition(stateWith(active, queue), {
            type: "swipe-dismiss",
          });

          expect(result.state.phase).toBe("banner");
          expect(result.state.active).toEqual(queue[0]);
          expect(result.state.queue).toEqual(queue.slice(1));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("empty queue: dismissing the active banner leaves nothing active and an empty queue", () => {
    fc.assert(
      fc.property(entryArb("active"), (active) => {
        const result = transition(stateWith(active, []), {
          type: "swipe-dismiss",
        });

        expect(result.state.phase).toBe("idle");
        expect(result.state.active).toBeNull();
        expect(result.state.queue).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 17: Banner queue capacity invariant", () => {
  it("below capacity: a push while a banner is active appends and grows the queue by one", () => {
    fc.assert(
      fc.property(
        entryArb("active"),
        fc.array(entryArb("queued"), {
          minLength: 0,
          maxLength: BANNER_QUEUE_MAX - 1,
        }),
        entryArb("new"),
        (active, queue, incoming) => {
          const result = transition(stateWith(active, queue), {
            type: "push",
            entry: incoming,
          });

          // The on-screen banner is never displaced by a later push.
          expect(result.state.active).toEqual(active);
          expect(result.state.queue).toHaveLength(queue.length + 1);
          expect(result.state.queue.at(-1)).toEqual(incoming);
          expect(result.state.queue.slice(0, -1)).toEqual(queue);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("at capacity: a push drops the oldest queued entry and the length stays capped", () => {
    fc.assert(
      fc.property(
        entryArb("active"),
        fc.array(entryArb("queued"), {
          minLength: BANNER_QUEUE_MAX,
          maxLength: BANNER_QUEUE_MAX,
        }),
        entryArb("new"),
        (active, queue, incoming) => {
          const result = transition(stateWith(active, queue), {
            type: "push",
            entry: incoming,
          });

          expect(result.state.queue).toHaveLength(BANNER_QUEUE_MAX);
          expect(result.state.queue.at(-1)).toEqual(incoming);
          expect(result.state.queue).toEqual([...queue.slice(1), incoming]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
