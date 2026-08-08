/**
 * SubApp container — owns the lifecycle of the one active sub-app.
 *
 * Recreated from git history alongside `types.ts`/`sub-app-registry.ts`
 * (introduced in "Rework Foresight", deleted in "Stabilize Foresight" as dead
 * code), with two corrections the deleted version needed before it could be
 * wired up for real (task 13.2):
 *
 *   - It declared its own local `EvenAppBridge` interface with positional
 *     arguments (`textContainerUpgrade(id, content)`), which is not the real
 *     SDK surface. This version takes the SDK's `EvenAppBridge` and builds a
 *     `TextContainerUpgrade` message, like every other renderer here.
 *   - Its `requestContainers()` handed out IDs starting at 0 — the HUD
 *     columns — so a sub-app would have overwritten the HUD. It now hands out
 *     `CONTAINER.SUBAPP`, the container the home screen allocates for exactly
 *     this purpose, and never calls `rebuildPageContainer` (see CLAUDE.md:
 *     only `home-screen.ts` may build the page).
 */

import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type {
  GestureEvent,
  SubApp,
  SubAppContainer,
  SubAppContext,
} from "./types";
import {
  CONTAINER,
  CONTAINER_NAME,
  SUBAPP_CONTAINER_COUNT,
  SUBAPP_HEIGHT,
  SUBAPP_WIDTH,
  SUBAPP_Y_OFFSET,
} from "../constants";

/** Maximum time (ms) to wait for sub-app cleanup before force-releasing. */
const CLEANUP_TIMEOUT_MS = 1000;

export interface SubAppContainerInstance extends SubAppContainer {
  handleGesture(event: GestureEvent): void;
}

/**
 * Factory function to create a SubAppContainer.
 * Manages sub-app lifecycle: activation, deactivation, gesture forwarding.
 * Renders into `CONTAINER.SUBAPP`, allocated by the home screen.
 */
export function createSubAppContainer(
  bridge: EvenAppBridge,
): SubAppContainerInstance {
  let activeApp: SubApp | null = null;

  function createSubAppContext(): SubAppContext {
    return {
      width: SUBAPP_WIDTH as 576,
      height: SUBAPP_HEIGHT as 173,
      yOffset: SUBAPP_Y_OFFSET as 115,
      async updateContent(
        containerIndex: number,
        content: string,
      ): Promise<void> {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: containerIndex,
            containerName: CONTAINER_NAME.SUBAPP,
            content,
          }),
        );
      },
      requestContainers(count: number): number[] {
        // Only `SUBAPP_CONTAINER_COUNT` containers exist on the page. Requests
        // beyond that are dropped rather than satisfied with IDs for
        // containers that were never allocated — the same
        // silently-drop-the-excess rule `createMenuSystem` applies to entries
        // past `MENU_MAX_ENTRIES`.
        const granted = Math.max(0, Math.min(count, SUBAPP_CONTAINER_COUNT));
        const containers: number[] = [];
        for (let i = 0; i < granted; i++) {
          containers.push(CONTAINER.SUBAPP + i);
        }
        return containers;
      },
    };
  }

  async function activate(app: SubApp): Promise<void> {
    // Deactivate current app if one is active
    if (activeApp !== null) {
      await deactivate();
    }

    activeApp = app;
    const context = createSubAppContext();
    await app.activate(context);
  }

  async function deactivate(): Promise<void> {
    if (activeApp === null) {
      return;
    }

    const appToCleanup = activeApp;
    activeApp = null;

    // Call cleanup with a 1-second timeout; force-release on timeout
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        appToCleanup.cleanup(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Cleanup timeout")),
            CLEANUP_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      // Force-release: cleanup timed out or errored, proceed with deactivation
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  function handleGesture(event: GestureEvent): void {
    if (activeApp === null) {
      return;
    }

    // Intercept double-tap — do NOT forward to sub-app. The caller
    // deactivates on double-tap instead (see `home-screen.ts`).
    if (event.type === "double-tap") {
      return;
    }

    // Forward single-tap, swipe-up, swipe-down, and hold to the active sub-app
    activeApp.handleGesture(event);
  }

  return {
    activate,
    deactivate,
    handleGesture,
    get activeApp(): SubApp | null {
      return activeApp;
    },
  };
}
