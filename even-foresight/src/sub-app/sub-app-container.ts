import { SubApp, SubAppContainer, SubAppContext, GestureEvent } from "./types";
import { SUBAPP_WIDTH, SUBAPP_HEIGHT, SUBAPP_Y_OFFSET } from "../constants";

/** Container ID shared between menu and sub-app (via rebuildPageContainer) */
const SHARED_CONTAINER_ID = 0;

/** Maximum time (ms) to wait for sub-app cleanup before force-releasing */
const CLEANUP_TIMEOUT_MS = 1000;

export interface EvenAppBridge {
  rebuildPageContainer(containerIndex: number, config: unknown): Promise<void>;
  textContainerUpgrade(containerIndex: number, content: string): Promise<void>;
}

export interface SubAppContainerInstance extends SubAppContainer {
  handleGesture(event: GestureEvent): void;
}

/**
 * Factory function to create a SubAppContainer.
 * Manages sub-app lifecycle: activation, deactivation, gesture forwarding.
 * Uses container 11 shared with the menu system via rebuildPageContainer.
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
        await bridge.textContainerUpgrade(containerIndex, content);
      },
      requestContainers(count: number): number[] {
        // Sub-app gets container 11 as its primary; for now allocate sequential IDs starting from 11
        const containers: number[] = [];
        for (let i = 0; i < count; i++) {
          containers.push(SHARED_CONTAINER_ID + i);
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
    try {
      await Promise.race([
        appToCleanup.cleanup(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Cleanup timeout")),
            CLEANUP_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch {
      // Force-release: cleanup timed out or errored, proceed with deactivation
    }
  }

  function handleGesture(event: GestureEvent): void {
    if (activeApp === null) {
      return;
    }

    // Intercept double-tap — do NOT forward to sub-app
    if (event.type === "double-tap") {
      return;
    }

    // Forward single-tap, swipe-up, swipe-down to active sub-app
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
