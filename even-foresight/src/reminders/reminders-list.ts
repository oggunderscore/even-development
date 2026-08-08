/**
 * Pure logic for the on-glasses Reminders list (`reminders-app.ts`).
 *
 * The list shows every reminder in chronological order. Tapping the
 * highlighted one marks it completed — rendered with a simulated
 * strikethrough, since G2 text containers have no rich-text/style fields
 * (`TextContainerProperty` is position/border/content only; see
 * `../../even-realities-docs/build/display.md`). Tapping it again within
 * `REMINDER_UNDO_WINDOW_MS` undoes that; otherwise it is deleted once the
 * window elapses. `completedAt` (set here and by the HUD's own due-time
 * check in `hud/components/reminders.ts`) is what the window is measured
 * against, so both paths — manual tap and automatic trigger — converge on
 * the same disappearing-after-5s behavior.
 */

import type { Reminder } from "../storage/schemas";
import { formatReminderTime } from "../hud/components/reminders";
import { truncateText } from "../menu/menu-system";
import { REMINDER_UNDO_WINDOW_MS } from "../constants";

/**
 * Combining long stroke overlay (U+0336) interleaved after every character.
 * The closest a plain-text-only display can get to real strikethrough
 * styling. Exported for property testing.
 */
export function strikethroughText(text: string): string {
  return Array.from(text)
    .map((ch) => `${ch}̶`)
    .join("");
}

/**
 * Sorts reminders earliest-target-time first. Stable: reminders with equal
 * `targetTime` keep their relative input order. Returns a new array.
 */
export function sortRemindersChronologically(
  reminders: Reminder[],
): Reminder[] {
  return [...reminders].sort((a, b) => a.targetTime - b.targetTime);
}

/**
 * Whether a reminder should still appear in the list: every uncompleted
 * reminder, plus a completed one still inside its undo window. A completed
 * reminder with no `completedAt` (should not happen, but a defensive
 * default) is treated as already expired — never shown.
 */
export function isReminderVisible(
  reminder: Reminder,
  now: number,
  undoWindowMs: number = REMINDER_UNDO_WINDOW_MS,
): boolean {
  if (!reminder.completed) return true;
  if (reminder.completedAt === undefined) return false;
  return now - reminder.completedAt < undoWindowMs;
}

/**
 * The chronologically-sorted list filtered down to what should currently be
 * on screen (see `isReminderVisible`).
 */
export function visibleReminders(
  reminders: Reminder[],
  now: number,
  undoWindowMs: number = REMINDER_UNDO_WINDOW_MS,
): Reminder[] {
  return sortRemindersChronologically(reminders).filter((r) =>
    isReminderVisible(r, now, undoWindowMs),
  );
}

/**
 * Drops reminders whose undo window has fully elapsed. This is the function
 * that actually deletes a completed reminder from the stored list — call it
 * with the *unsorted* full store before persisting.
 */
export function pruneExpiredCompleted(
  reminders: Reminder[],
  now: number,
  undoWindowMs: number = REMINDER_UNDO_WINDOW_MS,
): Reminder[] {
  return reminders.filter((r) => isReminderVisible(r, now, undoWindowMs));
}

/**
 * Toggles one reminder's completion state, returning a new array (all other
 * reminders unchanged by reference). No-ops (returns the input array as-is)
 * if `id` is not found, or if the reminder is completed but its undo window
 * has already elapsed — at that point it should have been pruned already,
 * so there is nothing left for a tap to act on.
 */
export function toggleReminderCompletion(
  reminders: Reminder[],
  id: string,
  now: number,
  undoWindowMs: number = REMINDER_UNDO_WINDOW_MS,
): Reminder[] {
  return reminders.map((r) => {
    if (r.id !== id) return r;

    if (!r.completed) {
      return { ...r, completed: true, completedAt: now };
    }

    if (!isReminderVisible(r, now, undoWindowMs)) {
      return r;
    }

    // Undo: back to not-completed.
    const { completedAt: _completedAt, ...rest } = r;
    return { ...rest, completed: false };
  });
}

/**
 * Clamps a highlight index into `[0, length - 1]` (or 0 for an empty list).
 */
export function clampHighlightIndex(
  highlightIndex: number,
  length: number,
): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(highlightIndex, 0), length - 1);
}

/**
 * Recomputes the scroll offset so the highlighted row stays inside the
 * visible window — scrolling up the minimum amount if the highlight moved
 * above it, or down the minimum amount if it moved below it. Never scrolls
 * when the highlight is already visible.
 */
export function clampScrollToHighlight(
  highlightIndex: number,
  scrollOffset: number,
  visibleLines: number,
): number {
  if (highlightIndex < scrollOffset) return highlightIndex;
  if (highlightIndex >= scrollOffset + visibleLines) {
    return highlightIndex - visibleLines + 1;
  }
  return scrollOffset;
}

/**
 * Formats one reminder as a single display line: `HH:MM  Title`, struck
 * through when completed (i.e. currently inside its undo window — a
 * reminder outside it has already been filtered out upstream). Truncated to
 * `maxLength` characters, matching how `menu-system.ts` truncates entries
 * rather than pixel-measuring this wider overlay region.
 */
export function formatReminderLine(
  reminder: Reminder,
  format: "12h" | "24h",
  maxLength: number,
): string {
  const time = formatReminderTime(reminder.targetTime, format);
  const title = reminder.completed
    ? strikethroughText(reminder.title)
    : reminder.title;
  return truncateText(`${time}  ${title}`, maxLength);
}

/**
 * Builds the full multi-line content for the Reminders list container: the
 * visible window of `visibleLines` rows starting at `scrollOffset`, with a
 * "> " highlight prefix on `highlightIndex`. Mirrors
 * `menu-system.ts#buildMenuContent`.
 */
export function buildReminderListContent(
  reminders: Reminder[],
  highlightIndex: number,
  scrollOffset: number,
  format: "12h" | "24h",
  visibleLines: number,
  lineMaxLength: number,
): string {
  if (reminders.length === 0) {
    return "No reminders";
  }

  const window = reminders.slice(scrollOffset, scrollOffset + visibleLines);
  return window
    .map((reminder, i) => {
      const index = scrollOffset + i;
      const prefix = index === highlightIndex ? "> " : "  ";
      return `${prefix}${formatReminderLine(reminder, format, lineMaxLength)}`;
    })
    .join("\n");
}
