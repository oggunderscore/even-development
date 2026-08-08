/**
 * Reminders SubApp — the on-glasses scrollable reminders list.
 *
 * Registered with `SubAppRegistry` like SmarterEveryday
 * (`smarter-everyday-app.ts`), so it gets a menu entry and renders into
 * `CONTAINER.SUBAPP` for free. Swipe up/down moves a highlight cursor
 * (`"> "` prefix, same convention as `menu-system.ts`); a single tap on the
 * highlighted reminder marks it completed. A completed reminder is rendered
 * struck through and stays in the list for `REMINDER_UNDO_WINDOW_MS` — a
 * second tap in that window undoes it, otherwise it is deleted from storage
 * once the window elapses.
 *
 * The undo/delete timer is created once per `createRemindersApp()` call
 * (i.e. at boot, alongside the SubApp's registration) rather than per
 * `activate()`, so it keeps running — and still deletes the reminder — even
 * if the wearer navigates away before it fires. Foresight is one JS context
 * with no IPC (see CLAUDE.md), so a bare `setTimeout` here is exactly as
 * durable as anywhere else in the app for as long as the page is open.
 */

import type { Reminder, RemindersStore, ClockConfig } from "../storage/schemas";
import {
  STORAGE_KEYS,
  emptyRemindersStore,
  DEFAULT_CLOCK_CONFIG,
} from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";
import type { GestureEvent, SubApp, SubAppContext } from "../sub-app/types";
import { REMINDER_UNDO_WINDOW_MS, TEXT_LINE_HEIGHT } from "../constants";
import {
  visibleReminders,
  pruneExpiredCompleted,
  toggleReminderCompletion,
  buildReminderListContent,
  clampHighlightIndex,
  clampScrollToHighlight,
} from "./reminders-list";

/** Single container is requested, mirroring `smarter-everyday-app.ts`. */
const REMINDER_LIST_CONTAINER_COUNT = 1;

/** How many reminder lines fit in the SubApp's fixed 173px-tall render area. */
const VISIBLE_LINES = Math.floor(173 / TEXT_LINE_HEIGHT);

/**
 * Character budget per line. `"HH:MM  " (7) + REMINDER_TITLE_MAX_LENGTH (30)`
 * fits comfortably under this, so truncation only ever bites pathological
 * input — matching how `menu-system.ts`/`smarter-everyday-app.ts` size this
 * 576px-wide overlay region by character count rather than pixel-measuring
 * it (unlike the fixed 115px HUD columns, where that would be unsafe).
 */
const LINE_MAX_LENGTH = 40;

/**
 * Creates the Reminders SubApp.
 *
 * - `activate`: requests a container, resets the highlight to the top, and
 *   renders the current visible list.
 * - `handleGesture`: swipe-up/swipe-down move the highlight (auto-scrolling
 *   the window); a single tap toggles the highlighted reminder's completion.
 *   "double-tap" and "hold" are not handled — `SubAppContainer` intercepts
 *   double-tap to close the app before it ever reaches here.
 * - `cleanup`: clears the rendered container. Pending undo/delete timers are
 *   deliberately left running — see the module doc above.
 */
export function createRemindersApp(storage: StorageManager): SubApp {
  let context: SubAppContext | null = null;
  let containerIds: number[] = [];
  let highlightIndex = 0;
  let scrollOffset = 0;

  const pendingDeletion = new Map<string, ReturnType<typeof setTimeout>>();

  function getClockFormat(): "12h" | "24h" {
    const config = storage.get<ClockConfig>(STORAGE_KEYS.CLOCK_CONFIG);
    return config?.format ?? DEFAULT_CLOCK_CONFIG.format;
  }

  function getStore(): RemindersStore {
    const stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS);
    if (!stored || !Array.isArray(stored.reminders)) {
      return emptyRemindersStore();
    }
    return stored;
  }

  function currentList(): Reminder[] {
    return visibleReminders(getStore().reminders, Date.now());
  }

  async function render(): Promise<void> {
    if (context === null || containerIds.length === 0) return;

    const list = currentList();
    highlightIndex = clampHighlightIndex(highlightIndex, list.length);
    scrollOffset = clampScrollToHighlight(
      highlightIndex,
      scrollOffset,
      VISIBLE_LINES,
    );

    const content = buildReminderListContent(
      list,
      highlightIndex,
      scrollOffset,
      getClockFormat(),
      VISIBLE_LINES,
      LINE_MAX_LENGTH,
    );
    await context.updateContent(containerIds[0], content);
  }

  function clearPendingDeletion(id: string): void {
    const timer = pendingDeletion.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingDeletion.delete(id);
    }
  }

  /**
   * Deletes `id` from storage once its undo window elapses, then re-renders
   * if the list is still the active view. Runs regardless of `context` —
   * the deletion itself must not depend on whether the wearer is still
   * looking at the list.
   */
  function scheduleDeletion(id: string): void {
    clearPendingDeletion(id);
    const timer = setTimeout(() => {
      pendingDeletion.delete(id);
      const store = getStore();
      const now = Date.now();
      const pruned = pruneExpiredCompleted(store.reminders, now);
      if (pruned.length !== store.reminders.length) {
        void storage.set<RemindersStore>(STORAGE_KEYS.REMINDERS, {
          reminders: pruned,
        });
      }
      void render();
    }, REMINDER_UNDO_WINDOW_MS);
    pendingDeletion.set(id, timer);
  }

  async function handleTap(): Promise<void> {
    const list = currentList();
    if (list.length === 0) return;

    const index = clampHighlightIndex(highlightIndex, list.length);
    const target = list[index];
    const now = Date.now();

    const store = getStore();
    const updated = toggleReminderCompletion(store.reminders, target.id, now);
    await storage.set<RemindersStore>(STORAGE_KEYS.REMINDERS, {
      reminders: updated,
    });

    const updatedTarget = updated.find((r) => r.id === target.id);
    if (updatedTarget?.completed) {
      scheduleDeletion(target.id);
    } else {
      // Undone within the window — no longer pending deletion.
      clearPendingDeletion(target.id);
    }

    await render();
  }

  return {
    id: "reminders",
    name: "Reminders",

    async activate(ctx: SubAppContext): Promise<void> {
      context = ctx;
      containerIds = ctx.requestContainers(REMINDER_LIST_CONTAINER_COUNT);
      highlightIndex = 0;
      scrollOffset = 0;
      await render();
    },

    handleGesture(event: GestureEvent): void {
      if (context === null) return;

      if (event.type === "swipe-down") {
        const list = currentList();
        highlightIndex = clampHighlightIndex(highlightIndex + 1, list.length);
        void render();
        return;
      }

      if (event.type === "swipe-up") {
        highlightIndex = Math.max(0, highlightIndex - 1);
        void render();
        return;
      }

      if (event.type === "single-tap") {
        void handleTap();
        return;
      }

      // "double-tap" and "hold" are not handled by this SubApp's view.
    },

    async cleanup(): Promise<void> {
      if (context !== null) {
        for (const containerId of containerIds) {
          await context.updateContent(containerId, "");
        }
      }
      context = null;
      containerIds = [];
      highlightIndex = 0;
      scrollOffset = 0;
    },
  };
}
