/**
 * SmarterEveryday SubApp.
 *
 * Implements the `SubApp` interface (`src/sub-app/types.ts`) so the app can
 * be registered with `SubAppRegistry`/`SubAppContainer` like any other
 * sub-app (design.md component 4, Requirement 12.1).
 *
 * Unlike the Scheduler (which runs independently of activation — see
 * design.md's "Key design decision 1"), this SubApp is only concerned with
 * the on-glasses view a wearer sees when they open SmarterEveryday from the
 * menu: a scrollable summary of their configured Topics.
 */

import type { Topic } from "../storage/schemas";
import type { TopicManager } from "./topic-manager";
import type { GestureEvent, SubApp, SubAppContext } from "../sub-app/types";
import { TEXT_LINE_HEIGHT } from "../constants";

/**
 * Single container is requested for the topic list, in line with how
 * `menu-system.ts` renders a multi-entry list as newline-separated content
 * within one container rather than one container per entry.
 */
const TOPIC_LIST_CONTAINER_COUNT = 1;

/** How many topic lines fit in the SubApp's fixed 173px-tall render area. */
const VISIBLE_LINES = Math.floor(173 / TEXT_LINE_HEIGHT);

/** Formats one Topic as a single summary line: description + interval + quiet-hours status. */
export function formatTopicLine(topic: Topic): string {
  const quietSuffix = topic.quietHours.enabled ? ", quiet hours on" : "";
  const pausedSuffix = topic.paused ? " [paused]" : "";
  return `${topic.description} (every ${topic.notificationIntervalMinutes}m${quietSuffix})${pausedSuffix}`;
}

/**
 * Builds the visible window of topic lines starting at `scrollOffset`,
 * clamped so the window never scrolls past the end of the list.
 */
export function buildTopicListContent(
  topics: Topic[],
  scrollOffset: number,
): string {
  if (topics.length === 0) {
    return "No topics yet";
  }

  const maxOffset = Math.max(0, topics.length - VISIBLE_LINES);
  const clampedOffset = Math.min(Math.max(scrollOffset, 0), maxOffset);

  return topics
    .slice(clampedOffset, clampedOffset + VISIBLE_LINES)
    .map(formatTopicLine)
    .join("\n");
}

/**
 * Creates the SmarterEveryday SubApp.
 *
 * - `activate`: requests a container from `SubAppContext`, reads the
 *   current Topic list via `topicManager.list()`, and renders a summary.
 * - `handleGesture`: swipe-up/swipe-down scroll the list by one line and
 *   re-render; every other gesture type (including `"hold"`) is ignored.
 * - `cleanup`: clears the rendered container(s), mirroring how
 *   `menu-system.ts`'s `clearMenu()` writes an empty string rather than
 *   tearing down the container itself.
 *
 * Validates: Requirement 12.1
 */
export function createSmarterEverydayApp(topicManager: TopicManager): SubApp {
  let context: SubAppContext | null = null;
  let containerIds: number[] = [];
  let scrollOffset = 0;

  async function render(): Promise<void> {
    if (context === null || containerIds.length === 0) return;
    const topics = topicManager.list();
    const content = buildTopicListContent(topics, scrollOffset);
    await context.updateContent(containerIds[0], content);
  }

  return {
    id: "smarter-everyday",
    name: "SmarterEveryday",

    async activate(ctx: SubAppContext): Promise<void> {
      context = ctx;
      containerIds = ctx.requestContainers(TOPIC_LIST_CONTAINER_COUNT);
      scrollOffset = 0;
      await render();
    },

    handleGesture(event: GestureEvent): void {
      if (context === null) return;

      if (event.type === "swipe-down") {
        scrollOffset += 1;
        void render();
        return;
      }

      if (event.type === "swipe-up") {
        scrollOffset = Math.max(0, scrollOffset - 1);
        void render();
        return;
      }

      // "single-tap", "double-tap", and "hold" are not handled by this
      // SubApp's view and are ignored.
    },

    async cleanup(): Promise<void> {
      if (context !== null) {
        for (const containerId of containerIds) {
          await context.updateContent(containerId, "");
        }
      }
      context = null;
      containerIds = [];
      scrollOffset = 0;
    },
  };
}
