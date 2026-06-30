import { SubApp } from "./types";
import { MENU_MAX_ENTRIES } from "../constants";

export interface SubAppRegistry {
  register(app: SubApp): boolean;
  unregister(id: string): void;
  getAll(): SubApp[];
  getById(id: string): SubApp | null;
  readonly count: number;
}

/**
 * Pure function: checks if registration is possible given current count.
 * Max sub-apps is same as max menu entries (10).
 */
export function canRegister(currentCount: number): boolean {
  return currentCount < MENU_MAX_ENTRIES;
}

/**
 * Factory function to create a SubAppRegistry instance.
 * Manages registration, lookup, and ordering of sub-apps (max 10).
 */
export function createSubAppRegistry(): SubAppRegistry {
  const apps: SubApp[] = [];

  return {
    register(app: SubApp): boolean {
      if (!canRegister(apps.length)) {
        return false;
      }
      // Prevent duplicate registration
      if (apps.some((a) => a.id === app.id)) {
        return false;
      }
      apps.push(app);
      return true;
    },

    unregister(id: string): void {
      const index = apps.findIndex((a) => a.id === id);
      if (index !== -1) {
        apps.splice(index, 1);
      }
    },

    getAll(): SubApp[] {
      return [...apps];
    },

    getById(id: string): SubApp | null {
      return apps.find((a) => a.id === id) ?? null;
    },

    get count(): number {
      return apps.length;
    },
  };
}
