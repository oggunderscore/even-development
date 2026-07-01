// Feature: foresight-webapp-ui
// ViewRouter — lightweight view manager for post-auth tab navigation.
// Manages mount/unmount lifecycle of ViewRoute modules into a shared container.

import type { ViewRoute } from "./types";

export interface ViewRouter {
  register(route: ViewRoute): void;
  navigate(id: string): void;
  getActiveId(): string;
}

/**
 * Creates a ViewRouter that manages view switching within the given container element.
 * Only one view is active (mounted) at a time.
 */
export function createViewRouter(container: HTMLElement): ViewRouter {
  const routes = new Map<string, ViewRoute>();
  let activeId = "";

  return {
    register(route: ViewRoute): void {
      routes.set(route.id, route);
    },

    navigate(id: string): void {
      // No-op if already on the requested view
      if (id === activeId) return;

      const target = routes.get(id);
      if (!target) {
        console.warn(`[ViewRouter] Unknown route: "${id}"`);
        return;
      }

      // Unmount current view if one is active
      if (activeId) {
        const current = routes.get(activeId);
        current?.unmount();
      }

      // Mount the new view
      activeId = id;
      target.mount(container);
    },

    getActiveId(): string {
      return activeId;
    },
  };
}
