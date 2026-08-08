import type {
  QuietHoursConfig,
  ShownContentLogStore,
  SmarterEverydayTopicsStore,
  Topic,
} from "../storage/schemas";
import {
  DEFAULT_SHOWN_CONTENT_LOG,
  DEFAULT_SMARTER_EVERYDAY_TOPICS,
  STORAGE_KEYS,
} from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";

/**
 * Pure validation and CRUD primitives for SmarterEveryday Topics.
 *
 * See design.md component 1 (`src/smarter-everyday/topic-manager.ts`) for the
 * full contract. This file implements the validation primitives (task 3.1),
 * the pure reducers `addTopic`/`removeTopic`/`editTopic` (task 3.4), and the
 * `createTopicManager` factory (task 3.8).
 */

export const TOPIC_DESCRIPTION_MIN = 1;
export const TOPIC_DESCRIPTION_MAX = 200;
export const TOPICS_MAX = 5;

export const INTERVAL_PRESETS_MIN = [15, 30, 45, 60] as const;
export const INTERVAL_CUSTOM_MIN = 10;
export const INTERVAL_CUSTOM_MAX = 360;
export const INTERVAL_DEFAULT_MIN = 60;

/**
 * Trims and checks 1–200 non-whitespace-inclusive length. A string composed
 * entirely of whitespace is treated as length 0 (invalid).
 *
 * Validates: Requirements 1.2, 1.3
 */
export function isValidTopicDescription(description: string): boolean {
  const trimmed = description.trim();
  return (
    trimmed.length >= TOPIC_DESCRIPTION_MIN &&
    trimmed.length <= TOPIC_DESCRIPTION_MAX
  );
}

/**
 * Clamps a value to the inclusive range [min, max]. Values already within
 * range pass through unchanged.
 *
 * Validates: Requirements 2.2, 2.3
 */
export function clampToRange(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * True iff the given topic list has room for another topic (fewer than
 * TOPICS_MAX topics).
 *
 * Validates: Requirements 1.4, 2.1, 2.4
 */
export function canAddTopic(topics: Topic[]): boolean {
  return topics.length < TOPICS_MAX;
}

/**
 * Thrown by `addTopic` when the list is at capacity or the submitted
 * description is invalid.
 */
export class TopicValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicValidationError";
  }
}

/** Input accepted by `addTopic`. */
export interface NewTopicInput {
  description: string;
  notificationIntervalMinutes?: number;
  quietHours?: QuietHoursConfig;
}

/** Partial edit accepted by `editTopic`. */
export type TopicEdit = Partial<
  Pick<Topic, "description" | "notificationIntervalMinutes" | "quietHours">
>;

const DEFAULT_TOPIC_QUIET_HOURS: QuietHoursConfig = {
  enabled: false,
  startMinuteOfDay: 22 * 60,
  endMinuteOfDay: 7 * 60,
};

/**
 * Pure reducer: adds a new Topic to the list if the list has room
 * (`canAddTopic`) and the description is valid (`isValidTopicDescription`).
 * Throws `TopicValidationError` otherwise. The new Topic gets a generated
 * id, `createdAt: now`, `paused: false`, `consecutiveFailures: 0`,
 * `lastDeliveryAt: null`, `suppressedDuringQuietHours: false`, and an
 * interval defaulting to `INTERVAL_DEFAULT_MIN` (clamped if provided).
 *
 * Validates: Requirements 1.1, 1.4
 */
export function addTopic(
  topics: Topic[],
  input: NewTopicInput,
  now: number,
): Topic[] {
  if (!canAddTopic(topics)) {
    throw new TopicValidationError(
      `Cannot add topic: maximum of ${TOPICS_MAX} topics reached`,
    );
  }
  if (!isValidTopicDescription(input.description)) {
    throw new TopicValidationError(
      "Topic description must be between 1 and 200 characters",
    );
  }

  const notificationIntervalMinutes =
    input.notificationIntervalMinutes === undefined
      ? INTERVAL_DEFAULT_MIN
      : clampToRange(
          input.notificationIntervalMinutes,
          INTERVAL_CUSTOM_MIN,
          INTERVAL_CUSTOM_MAX,
        );

  const newTopic: Topic = {
    id: crypto.randomUUID(),
    description: input.description,
    notificationIntervalMinutes,
    quietHours: input.quietHours ?? DEFAULT_TOPIC_QUIET_HOURS,
    createdAt: now,
    paused: false,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    suppressedDuringQuietHours: false,
  };

  return [...topics, newTopic];
}

/**
 * Pure reducer: removes exactly the topic with the matching id, leaving all
 * others unchanged. Only touches the topics array — the Shown_Content_Log
 * cascade (Requirement 1.5, 6.3) is performed by the `createTopicManager`
 * factory (task 3.8), not by this pure reducer.
 *
 * Validates: Requirements 1.5, 6.3
 */
export function removeTopic(topics: Topic[], id: string): Topic[] {
  return topics.filter((topic) => topic.id !== id);
}

/**
 * Pure reducer: applies a partial edit to only the targeted topic; all
 * other topics remain byte-for-byte unchanged. Clamps
 * `notificationIntervalMinutes` if present in the edit, and resets `paused`
 * to false and `consecutiveFailures` to 0 on the edited topic (editing
 * resumes a paused topic per Requirement 5.3).
 *
 * Validates: Requirements 1.6, 5.3
 */
export function editTopic(
  topics: Topic[],
  id: string,
  edit: TopicEdit,
): Topic[] {
  return topics.map((topic) => {
    if (topic.id !== id) return topic;

    const notificationIntervalMinutes =
      edit.notificationIntervalMinutes === undefined
        ? topic.notificationIntervalMinutes
        : clampToRange(
            edit.notificationIntervalMinutes,
            INTERVAL_CUSTOM_MIN,
            INTERVAL_CUSTOM_MAX,
          );

    return {
      ...topic,
      ...edit,
      notificationIntervalMinutes,
      paused: false,
      consecutiveFailures: 0,
    };
  });
}

/** Thin, `StorageManager`-backed CRUD surface over the pure reducers above. */
export interface TopicManager {
  list(): Topic[];
  create(
    input: NewTopicInput,
  ): { ok: true; topic: Topic } | { ok: false; error: string };
  update(id: string, edit: TopicEdit): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Creates a `TopicManager` that wraps `StorageManager` reads/writes around
 * the pure `addTopic`/`removeTopic`/`editTopic` reducers.
 *
 * `remove` atomically deletes the topic and its `ShownContentLogStore`
 * entry: both the updated topics store and the updated log store are read
 * and persisted together within the same call, so a caller never observes
 * a topic deleted without its log (or vice versa).
 *
 * Validates: Requirements 1.1, 1.5, 1.6, 6.3
 */
export function createTopicManager(storage: StorageManager): TopicManager {
  function readTopics(): Topic[] {
    return (
      storage.get<SmarterEverydayTopicsStore>(
        STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      ) ?? DEFAULT_SMARTER_EVERYDAY_TOPICS
    ).topics;
  }

  async function writeTopics(topics: Topic[]): Promise<void> {
    await storage.set<SmarterEverydayTopicsStore>(
      STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      { topics },
    );
  }

  function readLogs(): ShownContentLogStore {
    return (
      storage.get<ShownContentLogStore>(STORAGE_KEYS.SMARTER_EVERYDAY_LOGS) ??
      DEFAULT_SHOWN_CONTENT_LOG
    );
  }

  async function writeLogs(logs: ShownContentLogStore): Promise<void> {
    await storage.set<ShownContentLogStore>(
      STORAGE_KEYS.SMARTER_EVERYDAY_LOGS,
      logs,
    );
  }

  return {
    list(): Topic[] {
      return readTopics();
    },

    create(
      input: NewTopicInput,
    ): { ok: true; topic: Topic } | { ok: false; error: string } {
      const topics = readTopics();
      let newTopics: Topic[];
      try {
        newTopics = addTopic(topics, input, Date.now());
      } catch (error) {
        if (error instanceof TopicValidationError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }

      // The newly added topic is always the last entry — addTopic only ever
      // appends.
      const topic = newTopics[newTopics.length - 1];
      // Fire-and-forget from the caller's perspective (create() is
      // synchronous per the design's `TopicManager` interface); the write
      // still goes through `StorageManager.set`, which keeps the in-memory
      // cache authoritative even if the underlying bridge write is delayed.
      void writeTopics(newTopics);
      return { ok: true, topic };
    },

    async update(id: string, edit: TopicEdit): Promise<void> {
      const topics = readTopics();
      const newTopics = editTopic(topics, id, edit);
      await writeTopics(newTopics);
    },

    async remove(id: string): Promise<void> {
      const topics = readTopics();
      const newTopics = removeTopic(topics, id);

      const logs = readLogs();
      const { [id]: _removed, ...newLogs } = logs;

      await Promise.all([writeTopics(newTopics), writeLogs(newLogs)]);
    },
  };
}
