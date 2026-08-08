/**
 * Pure reordering logic for the app-launcher menu, driven by the wearer's
 * saved preference (`STORAGE_KEYS.MENU_ORDER`, `src/storage/schemas.ts`).
 */

import type { MenuOrder } from "../storage/schemas";

/**
 * Reorders `entries` to match `order` (a list of entry ids). Entries whose
 * id appears in `order` come first, in that order; any entry not mentioned
 * is appended afterward in its original position. Ids in `order` that don't
 * match any current entry are silently ignored — covers both a stale saved
 * order (an app was removed) and one saved before a new built-in app
 * existed, without either producing an error.
 *
 * Generic over anything with an `id`, so both `home-screen.ts` (reordering
 * live `MenuEntry` objects) and the phone's Menu Order editor (reordering
 * plain `{ id, name }` display entries) share this one implementation.
 */
export function applyMenuOrder<T extends { id: string }>(
  entries: T[],
  order: MenuOrder,
): T[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered: T[] = [];

  for (const id of order) {
    const entry = byId.get(id);
    if (entry) {
      ordered.push(entry);
      byId.delete(id);
    }
  }

  for (const entry of entries) {
    if (byId.has(entry.id)) {
      ordered.push(entry);
    }
  }

  return ordered;
}
