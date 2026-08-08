import type {
  QuietHoursConfig,
  SmarterEverydayTopicsStore,
  Topic,
} from "../storage/schemas";
import {
  DEFAULT_SMARTER_EVERYDAY_TOPICS,
  STORAGE_KEYS,
} from "../storage/schemas";
import type { TopicManager } from "./topic-manager";
import type { StorageManager } from "../storage/storage-manager";
import { SCHEDULER_TICK_INTERVAL_MS } from "../constants";

/**
 * The three possible outcomes of a single scheduler decision for a Topic at
 * a single instant. See `decideSchedulerAction`.
 */
export type SchedulerAction =
  | { kind: "deliver" }
  | { kind: "suppress" }
  | { kind: "wait" };

/**
 * True iff (now - lastDeliveryAt) >= intervalMinutes * 60_000, or
 * `lastDeliveryAt` is null (a Topic that has never delivered has always had
 * its interval elapse). Exported for PBT.
 */
export function isIntervalElapsed(
  lastDeliveryAt: number | null,
  intervalMinutes: number,
  now: number,
): boolean {
  if (lastDeliveryAt === null) return true;
  return now - lastDeliveryAt >= intervalMinutes * 60_000;
}

/**
 * True iff `minuteOfDay` falls within the configured quiet-hours window.
 * Handles overnight wraparound: when `startMinuteOfDay > endMinuteOfDay`,
 * the window crosses midnight, so membership is "at or after start OR
 * before end" rather than "at or after start AND before end". Disabled
 * quiet hours never match. Exported for PBT.
 */
export function isWithinQuietHours(
  minuteOfDay: number,
  quietHours: QuietHoursConfig,
): boolean {
  if (!quietHours.enabled) return false;

  const { startMinuteOfDay: start, endMinuteOfDay: end } = quietHours;

  if (start === end) {
    // Zero-width or full-day window: a start equal to end never matches a
    // real window boundary case, so treat it as "never within quiet hours"
    // rather than ambiguously "always within".
    return false;
  }

  if (start < end) {
    // Normal same-day window: [start, end).
    return minuteOfDay >= start && minuteOfDay < end;
  }

  // Overnight window crossing midnight: [start, 1440) U [0, end).
  return minuteOfDay >= start || minuteOfDay < end;
}

/**
 * Derives the minute-of-day (0–1439) for a given epoch timestamp, in the
 * local timezone.
 */
function minuteOfDayFor(now: number): number {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Pure scheduler decision for a single topic at a single instant.
 * - paused topics always "wait"
 * - if interval has not elapsed, "wait"
 * - if interval elapsed and within quiet hours, "suppress" (caller must
 *   record suppression)
 * - if interval elapsed and NOT within quiet hours, "deliver" — this covers
 *   both the normal per-interval case (Requirement 2.5, 3.5) and the
 *   "exactly one delivery on quiet-hours exit" case (Requirement 3.3),
 *   because exiting quiet hours while the interval has already elapsed
 *   produces "deliver" on the very next tick.
 * Exported for PBT.
 */
export function decideSchedulerAction(
  topic: Topic,
  now: number,
): SchedulerAction {
  if (topic.paused) {
    return { kind: "wait" };
  }

  if (
    !isIntervalElapsed(
      topic.lastDeliveryAt,
      topic.notificationIntervalMinutes,
      now,
    )
  ) {
    return { kind: "wait" };
  }

  const minuteOfDay = minuteOfDayFor(now);
  if (isWithinQuietHours(minuteOfDay, topic.quietHours)) {
    return { kind: "suppress" };
  }

  return { kind: "deliver" };
}

/**
 * `Scheduler` interface (design.md component 2). `start`/`stop` manage the
 * 60-second tick loop; `tick` is also exposed directly so tests/callers can
 * run a tick immediately instead of waiting for the interval timer.
 */
export interface Scheduler {
  start(onDeliver: (topic: Topic) => Promise<void>): void;
  stop(): void;
  tick(now: number): Promise<void>;
}

/**
 * Creates a `Scheduler` that ticks every `SCHEDULER_TICK_INTERVAL_MS`
 * (60 seconds), evaluating every topic independently via
 * `decideSchedulerAction` (Requirement 2.5's "measured independently per
 * Topic") and dispatching:
 *
 * - `"deliver"` → awaits `onDeliver(topic)`, then persists
 *   `lastDeliveryAt: now` and `suppressedDuringQuietHours: false`.
 * - `"suppress"` → persists `suppressedDuringQuietHours: true` without
 *   calling `onDeliver`.
 * - `"wait"` → no-op.
 *
 * Design choice — persisting scheduler-owned fields (option (b) from the
 * task notes): `lastDeliveryAt` and `suppressedDuringQuietHours` are
 * scheduler-owned bookkeeping, not user-edit state. `TopicManager.update`
 * goes through the pure `editTopic` reducer, which always resets
 * `paused`/`consecutiveFailures` on every call (Requirement 5.3 — that reset
 * is specifically about a *user* editing a Topic's config resuming a paused
 * Topic). Routing scheduler ticks through `editTopic` would silently reset
 * `consecutiveFailures` on every successful delivery, which happens to be
 * consistent with "success" but would also incorrectly reset it on every
 * `"suppress"`/`"wait"` tick if a caller weren't careful, and more
 * importantly would conflate scheduler bookkeeping with user-edit semantics
 * long-term. So the scheduler instead reads/writes the
 * `SmarterEverydayTopicsStore` directly via `StorageManager`, bypassing
 * `topicManager.update`/`editTopic` entirely for these fields. `TopicManager`
 * is still used for `list()` (the read path all callers share).
 *
 * Per-tick failure-counter bookkeeping (`nextFailureState`/`shouldPause`
 * from `content-generator.ts`) is OUT OF SCOPE here: `onDeliver`'s signature
 * (`(topic: Topic) => Promise<void>`) returns void, not a delivery outcome,
 * so the scheduler has no success/failure signal to act on. That wiring is
 * left as a follow-up for whichever task connects `ContentGenerator.deliver`
 * (which *does* return `"delivered" | "failed" | "no-provider"`) to this
 * `onDeliver` callback.
 */
export function createScheduler(
  topicManager: TopicManager,
  storage: StorageManager,
): Scheduler {
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let onDeliver: ((topic: Topic) => Promise<void>) | null = null;

  function readTopicsStore(): SmarterEverydayTopicsStore {
    return (
      storage.get<SmarterEverydayTopicsStore>(
        STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      ) ?? DEFAULT_SMARTER_EVERYDAY_TOPICS
    );
  }

  /**
   * Persists scheduler-owned fields for a single topic by id, re-reading
   * the store immediately before the write so a tick's persistence doesn't
   * clobber changes made by a different topic's write earlier in the same
   * tick (each topic write is independently read-modify-written).
   */
  async function persistTopicFields(
    id: string,
    fields: Pick<Topic, "lastDeliveryAt" | "suppressedDuringQuietHours">,
  ): Promise<void> {
    const store = readTopicsStore();
    const topics = store.topics.map((topic) =>
      topic.id === id ? { ...topic, ...fields } : topic,
    );
    await storage.set<SmarterEverydayTopicsStore>(
      STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      { topics },
    );
  }

  async function tick(now: number): Promise<void> {
    const topics = topicManager.list();

    for (const topic of topics) {
      const action = decideSchedulerAction(topic, now);

      switch (action.kind) {
        case "deliver": {
          if (onDeliver) {
            await onDeliver(topic);
          }
          await persistTopicFields(topic.id, {
            lastDeliveryAt: now,
            suppressedDuringQuietHours: false,
          });
          break;
        }
        case "suppress": {
          await persistTopicFields(topic.id, {
            lastDeliveryAt: topic.lastDeliveryAt,
            suppressedDuringQuietHours: true,
          });
          break;
        }
        case "wait":
          // No-op.
          break;
      }
    }
  }

  return {
    start(deliverCallback: (topic: Topic) => Promise<void>): void {
      onDeliver = deliverCallback;
      if (intervalTimer !== null) {
        clearInterval(intervalTimer);
      }
      intervalTimer = setInterval(() => {
        void tick(Date.now());
      }, SCHEDULER_TICK_INTERVAL_MS);
    },

    stop(): void {
      if (intervalTimer !== null) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
    },

    tick,
  };
}
