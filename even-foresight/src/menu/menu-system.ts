import {
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { MenuEntry, MenuSystem } from "./types";
import {
  MENU_MAX_ENTRIES,
  MENU_ENTRY_TRUNCATE,
  MENU_TIMEOUT_MS,
  SCROLL_DEBOUNCE_MS,
  SUBAPP_Y_OFFSET,
  SUBAPP_HEIGHT,
  SUBAPP_WIDTH,
} from "../constants";

// ─── Pure Functions (exported for PBT) ────────────────────────────────────────

/**
 * Truncates text to the given maxLength.
 * If text.length > maxLength, returns text.slice(0, maxLength - 3) + "..."
 * Otherwise returns the original string unchanged.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Calculates the next index when navigating down in the menu.
 * Clamps to the last entry (totalEntries - 1).
 */
export function navigateDown(
  currentIndex: number,
  totalEntries: number,
): number {
  return Math.min(currentIndex + 1, totalEntries - 1);
}

/**
 * Calculates the next index when navigating up in the menu.
 * Clamps to the first entry (0).
 */
export function navigateUp(currentIndex: number): number {
  return Math.max(currentIndex - 1, 0);
}

// ─── Menu System Options ──────────────────────────────────────────────────────

export interface MenuSystemOptions {
  /** Callback invoked when no sub-apps are registered and show() is called. */
  onNoApps?: () => void;
}

// ─── Menu Container Constants ─────────────────────────────────────────────────

const MENU_CONTAINER_ID = 0;
const MENU_CONTAINER_NAME = "menu-system";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a MenuSystem instance that manages the app launcher menu.
 *
 * @param bridge - The Even App bridge for SDK calls
 * @param entries - Array of menu entries (sub-apps), max 10
 * @param options - Optional configuration (onNoApps callback)
 */
export function createMenuSystem(
  bridge: EvenAppBridge,
  entries: MenuEntry[],
  options?: MenuSystemOptions,
): MenuSystem {
  // Limit entries to max
  const menuEntries = entries.slice(0, MENU_MAX_ENTRIES);

  let visible = false;
  let highlightIndex = 0;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastScrollTime = 0;

  /**
   * Resets the auto-dismiss timeout.
   * Called on show() and any user input (moveUp, moveDown, select).
   */
  function resetTimeout(): void {
    clearTimeout(timeoutTimer!);
    timeoutTimer = setTimeout(() => {
      if (visible) {
        menu.hide();
      }
    }, MENU_TIMEOUT_MS);
  }

  /**
   * Clears the auto-dismiss timeout.
   */
  function clearTimeoutTimer(): void {
    if (timeoutTimer !== null) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  /**
   * Builds the text content for the menu display.
   * Shows a vertical list with a highlight indicator (">") on the selected entry.
   */
  function buildMenuContent(): string {
    const lines: string[] = [];
    for (let i = 0; i < menuEntries.length; i++) {
      const prefix = i === highlightIndex ? "> " : "  ";
      const name = truncateText(menuEntries[i].name, MENU_ENTRY_TRUNCATE);
      lines.push(`${prefix}${name}`);
    }
    return lines.join("\n");
  }

  /**
   * Renders the menu list into container 11 using rebuildPageContainer.
   */
  async function renderMenu(): Promise<void> {
    const content = buildMenuContent();

    // Rebuild container 11 to show the menu
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            containerID: MENU_CONTAINER_ID,
            containerName: MENU_CONTAINER_NAME,
            xPosition: 0,
            yPosition: SUBAPP_Y_OFFSET,
            width: SUBAPP_WIDTH,
            height: SUBAPP_HEIGHT,
            content,
            isEventCapture: 1,
          }),
        ],
      }),
    );
  }

  /**
   * Updates the menu display in-place using textContainerUpgrade (flicker-free).
   */
  async function updateMenuDisplay(): Promise<void> {
    const content = buildMenuContent();

    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: MENU_CONTAINER_ID,
        containerName: MENU_CONTAINER_NAME,
        content,
      }),
    );
  }

  /**
   * Clears container 11 by rebuilding with empty content.
   */
  async function clearMenu(): Promise<void> {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            containerID: MENU_CONTAINER_ID,
            containerName: MENU_CONTAINER_NAME,
            xPosition: 0,
            yPosition: SUBAPP_Y_OFFSET,
            width: SUBAPP_WIDTH,
            height: SUBAPP_HEIGHT,
            content: "",
            isEventCapture: 1,
          }),
        ],
      }),
    );
  }

  /**
   * Checks the scroll debounce. Returns true if the event should be accepted.
   */
  function shouldAcceptScroll(): boolean {
    const now = Date.now();
    if (now - lastScrollTime < SCROLL_DEBOUNCE_MS) {
      return false;
    }
    lastScrollTime = now;
    return true;
  }

  const menu: MenuSystem = {
    async show(): Promise<void> {
      // Do not show if zero entries registered
      if (menuEntries.length === 0) {
        options?.onNoApps?.();
        return;
      }

      if (visible) return;

      visible = true;
      highlightIndex = 0;
      lastScrollTime = 0;

      await renderMenu();
      resetTimeout();
    },

    async hide(): Promise<void> {
      if (!visible) return;

      visible = false;
      highlightIndex = 0;
      clearTimeoutTimer();

      await clearMenu();
    },

    moveDown(): void {
      if (!visible) return;
      if (!shouldAcceptScroll()) return;

      highlightIndex = navigateDown(highlightIndex, menuEntries.length);
      resetTimeout();

      // Fire-and-forget display update
      updateMenuDisplay();
    },

    moveUp(): void {
      if (!visible) return;
      if (!shouldAcceptScroll()) return;

      highlightIndex = navigateUp(highlightIndex);
      resetTimeout();

      // Fire-and-forget display update
      updateMenuDisplay();
    },

    async select(): Promise<void> {
      if (!visible) return;
      if (menuEntries.length === 0) return;

      const entry = menuEntries[highlightIndex];

      // Hide menu first, then activate the selected app
      await menu.hide();
      await entry.activate();
    },

    get isVisible(): boolean {
      return visible;
    },
  };

  return menu;
}
