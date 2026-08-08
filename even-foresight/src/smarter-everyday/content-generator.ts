import type {
  ShownContentEntry,
  ShownContentLogStore,
  Topic,
} from "../storage/schemas";
import { DEFAULT_SHOWN_CONTENT_LOG, STORAGE_KEYS } from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";

/**
 * Pure Content_Generator primitives for SmarterEveryday.
 *
 * See design.md component 3 (`src/smarter-everyday/content-generator.ts`)
 * for the full contract. The pure functions below were added in task 5.1;
 * the `LlmClient`-backed `createContentGenerator` factory is added in
 * task 5.6.
 */

/** Consecutive-failure count at or above which a Topic is auto-paused. */
export const FAILURE_PAUSE_THRESHOLD = 3;

/**
 * The exact request payload sent to the LLM provider for a single
 * Content_Delivery attempt: the topic's description plus the full
 * Shown_Content_Log, so the model has enough context to avoid repeats.
 */
export interface GenerationRequest {
  topicDescription: string;
  shownContent: ShownContentEntry[];
}

/** Thin adapter over whatever LLM provider Assistant_App has configured. */
export interface LlmClient {
  generate(request: GenerationRequest): Promise<string>;
}

/**
 * Builds the exact request payload sent to the LLM provider: the topic's
 * description and every entry present in the Shown_Content_Log, with no log
 * entries omitted or altered.
 *
 * Validates: Requirements 4.2
 */
export function buildGenerationRequest(
  topic: Topic,
  log: ShownContentEntry[],
): GenerationRequest {
  return {
    topicDescription: topic.description,
    shownContent: [...log],
  };
}

/** Trims content the same way for both storage and duplicate comparison. */
function normalizeContent(content: string): string {
  return content.trim();
}

/**
 * True iff normalized(candidate) matches any normalized entry already in
 * the log. Normalization is a trim only — matching is case-preserved exact
 * match, per design.md Property 9.
 *
 * Validates: Requirements 4.5
 */
export function isDuplicateContent(
  candidate: string,
  log: ShownContentEntry[],
): boolean {
  const normalizedCandidate = normalizeContent(candidate);
  return log.some(
    (entry) => normalizeContent(entry.content) === normalizedCandidate,
  );
}

/**
 * Appends an entry to the Shown_Content_Log; returns a new array. The log
 * has no maximum size (Requirement 6.2).
 *
 * Validates: Requirements 4.4, 6.1, 6.2
 */
export function appendToLog(
  log: ShownContentEntry[],
  entry: ShownContentEntry,
): ShownContentEntry[] {
  return [...log, entry];
}

/**
 * Pure failure-counter transition: increments by one on "failure", resets
 * to 0 on "success".
 *
 * Validates: Requirements 5.1, 5.2
 */
export function nextFailureState(
  consecutiveFailures: number,
  outcome: "success" | "failure",
): number {
  return outcome === "failure" ? consecutiveFailures + 1 : 0;
}

/**
 * True iff consecutiveFailures has reached the auto-pause threshold.
 *
 * Validates: Requirements 5.1, 5.2
 */
export function shouldPause(consecutiveFailures: number): boolean {
  return consecutiveFailures >= FAILURE_PAUSE_THRESHOLD;
}

/** Additional generation attempts allowed when the LLM returns duplicate content (3 total attempts). */
const DUPLICATE_RETRY_BUDGET = 2;

/** Maximum attempts for the (append log + push notification) pair before logging a persistent failure. */
const APPEND_AND_NOTIFY_MAX_ATTEMPTS = 5;

export interface ContentGenerator {
  /**
   * Runs one Content_Delivery attempt for a topic. See design.md component 3
   * for the full contract.
   */
  deliver(topic: Topic): Promise<"delivered" | "failed" | "no-provider">;
}

/**
 * Read/write accessor for a single Topic's Shown_Content_Log, keyed by
 * topic id. Mirrors `StorageManager`'s get/set shape (see
 * `storage/storage-manager.ts`) but is scoped to one topic's log entries so
 * `ContentGenerator` doesn't need to know the `ShownContentLogStore`'s
 * overall keying/serialization details.
 */
export interface ShownContentLogAccessor {
  get(topicId: string): Promise<ShownContentEntry[]>;
  set(topicId: string, entries: ShownContentEntry[]): Promise<void>;
}

/**
 * Storage-backed `ShownContentLogAccessor`: reads/writes a single Topic's
 * Shown_Content_Log entries within the shared `ShownContentLogStore`
 * (`STORAGE_KEYS.SMARTER_EVERYDAY_LOGS`), keyed by topic id. Mirrors
 * `topic-manager.ts`'s own `readLogs`/`writeLogs` helpers, which read/write
 * this exact same store for the deletion cascade (task 3.8) — this factory
 * gives `ContentGenerator` a narrower read/write surface onto that same
 * data so it doesn't need to know the store's overall shape.
 *
 * Added in task 13.1 to wire `createContentGenerator` up to real storage at
 * boot; no prior task created this factory.
 */
export function createStorageShownContentLogAccessor(
  storage: StorageManager,
): ShownContentLogAccessor {
  function readLogs(): ShownContentLogStore {
    return (
      storage.get<ShownContentLogStore>(STORAGE_KEYS.SMARTER_EVERYDAY_LOGS) ??
      DEFAULT_SHOWN_CONTENT_LOG
    );
  }

  return {
    async get(topicId: string): Promise<ShownContentEntry[]> {
      return readLogs()[topicId] ?? [];
    },

    async set(topicId: string, entries: ShownContentEntry[]): Promise<void> {
      const logs = readLogs();
      await storage.set<ShownContentLogStore>(
        STORAGE_KEYS.SMARTER_EVERYDAY_LOGS,
        { ...logs, [topicId]: entries },
      );
    },
  };
}

/**
 * What gets pushed to the Notification_System when a Content_Delivery
 * succeeds. `ContentGenerator.deliver` only ever calls `onNotify` for the
 * successful (append-log + push-notification) pair described in
 * Requirement 4.4 — the "no-provider" and duplicate-exhausted "failed"
 * outcomes are surfaced by the Scheduler instead (see design.md's Error
 * Handling section: the Scheduler pushes the one-time no-provider
 * notification and the 3rd-consecutive-failure notification), since those
 * are decisions tied to the failure counter/pause state that this module
 * intentionally does not own.
 */
export interface DeliveryNotification {
  topicId: string;
  topicDescription: string;
  content: string;
}

/**
 * Minimal shape read from Assistant_App's config store. Mirrors
 * `AssistantConfig` in `webapp/types.ts`, duplicated narrowly here (rather
 * than importing the webapp module from this glasses-side module) the same
 * way `hud/components/weather.ts` reads the webapp-owned weather-location
 * record with an inline shape instead of importing `webapp/types.ts`.
 */
interface AssistantLlmConfig {
  llmProvider?: "anthropic" | "openai" | null;
}

/**
 * True iff Assistant_App has an LLM provider configured. Reads the same
 * `STORAGE_KEYS.ASSISTANT_CONFIG` key and `llmProvider` field that
 * `webapp/assistant-config-form.ts` writes (see `DEFAULT_ASSISTANT_CONFIG`
 * in `webapp/types.ts`), so SmarterEveryday and Assistant_App agree on what
 * "configured" means without SmarterEveryday owning or duplicating that
 * schema.
 *
 * Validates: Requirements 4.3
 */
function hasAssistantLlmProvider(storage: StorageManager): boolean {
  const config = storage.get<AssistantLlmConfig>(STORAGE_KEYS.ASSISTANT_CONFIG);
  return (
    config?.llmProvider === "anthropic" || config?.llmProvider === "openai"
  );
}

/**
 * Creates a `ContentGenerator` that runs one Content_Delivery attempt per
 * `deliver()` call.
 *
 * Deviation from design.md's listed factory signature
 * (`createContentGenerator(llmClient, logStore, onNotify)`): this
 * implementation adds a fourth `storage: StorageManager` parameter.
 * Requirement 4.3 requires `deliver` to check Assistant_App's LLM provider
 * config before generating, and design.md's Components section 3 doesn't
 * otherwise supply a way to read that config from within this module.
 * `StorageManager` is the existing, established mechanism every other
 * factory in this codebase (`createTopicManager`, `createScheduler`) uses
 * for exactly this kind of read, so it's added here rather than inventing a
 * new config-access abstraction just for this one check.
 */
export function createContentGenerator(
  llmClient: LlmClient,
  logStore: ShownContentLogAccessor,
  onNotify: (notification: DeliveryNotification) => void,
  storage: StorageManager,
): ContentGenerator {
  /**
   * Calls `llmClient.generate`, re-requesting up to `DUPLICATE_RETRY_BUDGET`
   * additional times within this call if `isDuplicateContent` flags the
   * result. Returns `null` if every attempt is a duplicate or the client
   * throws/rejects.
   *
   * Validates: Requirements 4.1, 4.5
   */
  async function generateNonDuplicate(
    topic: Topic,
    log: ShownContentEntry[],
  ): Promise<string | null> {
    const totalAttempts = 1 + DUPLICATE_RETRY_BUDGET;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      let candidate: string;
      try {
        candidate = await llmClient.generate(
          buildGenerationRequest(topic, log),
        );
      } catch {
        return null;
      }
      if (!isDuplicateContent(candidate, log)) {
        return candidate;
      }
      // Duplicate — retry within the same tick, up to the budget above.
    }
    return null;
  }

  /**
   * Retries the (append the new entry to the log + notify) pair together,
   * capped at `APPEND_AND_NOTIFY_MAX_ATTEMPTS` attempts, until both succeed
   * without throwing. Logs via `console.log` (matching `weather.ts`'s
   * error-logging style) if every attempt fails.
   *
   * Validates: Requirements 4.4
   */
  async function appendAndNotify(
    topic: Topic,
    log: ShownContentEntry[],
    content: string,
  ): Promise<void> {
    const entry: ShownContentEntry = { content, deliveredAt: Date.now() };
    const updatedLog = appendToLog(log, entry);

    for (
      let attempt = 1;
      attempt <= APPEND_AND_NOTIFY_MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        await logStore.set(topic.id, updatedLog);
        onNotify({
          topicId: topic.id,
          topicDescription: topic.description,
          content,
        });
        return;
      } catch {
        if (attempt === APPEND_AND_NOTIFY_MAX_ATTEMPTS) {
          console.log(
            `SmarterEveryday: append-and-display failed for topic "${topic.id}" after ${APPEND_AND_NOTIFY_MAX_ATTEMPTS} attempts`,
          );
        }
      }
    }
  }

  return {
    async deliver(
      topic: Topic,
    ): Promise<"delivered" | "failed" | "no-provider"> {
      // Requirement 4.3: an unconfigured provider is a user configuration
      // issue, not a transient failure, so it's checked first and never
      // touches the failure counter — that's the Scheduler's job (see
      // design.md's Error Handling section), not this module's.
      if (!hasAssistantLlmProvider(storage)) {
        return "no-provider";
      }

      const log = await logStore.get(topic.id);
      const content = await generateNonDuplicate(topic, log);
      if (content === null) {
        return "failed";
      }

      // design.md's Error Handling section caps the append-and-display
      // retry loop at 5 attempts and specifies only a `console.log` on
      // persistent failure — it doesn't say what `deliver` should resolve
      // to if the pair never succeeds. Per Requirement 4.4's framing
      // ("whether complete or partial" content generation still triggers
      // the append-and-display obligation), the LLM call succeeding is what
      // makes this a successful Content_Delivery: a persistent
      // append/notify failure is treated as a logged, degraded case rather
      // than a generation failure, so the failure counter (owned by the
      // Scheduler) is not incremented for a healthy LLM_Provider fighting a
      // broken bridge/storage layer.
      await appendAndNotify(topic, log, content);
      return "delivered";
    },
  };
}
