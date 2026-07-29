import type { HudComponent, HudComponentType, HudManager } from "./types";
import type { HudLayoutConfig } from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";
import { HudSlotRenderer, isSlotInBounds, fitToColumn } from "./hud-slot";
import { createClockComponent } from "./components/clock";
import { createWeatherComponent } from "./components/weather";
import {
  createRemindersComponent,
  type NotificationCallback,
} from "./components/reminders";
import { HUD_REFRESH_INTERVAL_MS, HUD_COLS } from "../constants";

/**
 * Slot entry tracking a component and its grid position.
 */
interface ActiveSlot {
  row: 0 | 1;
  col: 0 | 1 | 2 | 3 | 4;
  component: HudComponent;
}

/**
 * Factory function to create a HudManager instance.
 *
 * @param storage - StorageManager for reading component configs
 * @param onNotification - Optional callback for reminder notifications (triggers banners)
 */
export function createHudManager(
  storage: StorageManager,
  onNotification?: NotificationCallback,
): HudManager {
  let renderer: HudSlotRenderer | null = null;
  let activeSlots: ActiveSlot[] = [];
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let paused = false;
  /**
   * Whether HUD content may be drawn at all. Distinct from `paused`:
   * `paused` stops the refresh clock (backgrounded app), `visible` controls
   * whether the columns hold content (inactivity sleep, banner takeover).
   */
  let visible = true;

  /**
   * Creates a HUD component instance based on type.
   */
  function createComponent(type: HudComponentType): HudComponent {
    switch (type) {
      case "clock":
        return createClockComponent(storage);
      case "weather":
        return createWeatherComponent({ storage });
      case "reminders":
        return createRemindersComponent(storage, onNotification);
    }
  }

  /**
   * Composes each column's text from the components placed in it.
   *
   * A column container holds up to two lines: row 0 on line 1, row 1 on
   * line 2. A component in row 1 with nothing above it still gets a leading
   * newline so it stays visually on the lower line.
   */
  function composeColumns(): Map<number, string> {
    const rowContent = new Map<number, [string, string]>();

    for (const slot of activeSlots) {
      const lines = rowContent.get(slot.col) ?? ["", ""];
      const rendered = slot.component.render();
      // Two components in the same cell would otherwise silently clobber
      // each other; join them so neither is lost.
      lines[slot.row] = lines[slot.row]
        ? `${lines[slot.row]} ${rendered}`
        : rendered;
      rowContent.set(slot.col, lines);
    }

    const columns = new Map<number, string>();
    for (const [col, [row0, row1]] of rowContent) {
      // Each row must occupy exactly one line, or a wide row-0 value wraps
      // and pushes row 1 out of the container entirely.
      const line0 = fitToColumn(row0);
      const line1 = fitToColumn(row1);
      columns.set(col, line1 ? `${line0}\n${line1}` : line0);
    }
    return columns;
  }

  /**
   * Renders all active slots to their column containers.
   */
  async function renderAll(): Promise<void> {
    const r = renderer;
    if (!r) return;

    if (!visible) {
      await r.clearAll();
      return;
    }

    const columns = composeColumns();
    for (let col = 0; col < HUD_COLS; col++) {
      await r.renderColumn(col, columns.get(col) ?? "");
    }
  }

  /**
   * Starts the refresh interval timer.
   */
  function startRefreshTimer(): void {
    stopRefreshTimer();
    refreshTimer = setInterval(() => {
      if (!paused) {
        void manager.refreshAll();
      }
    }, HUD_REFRESH_INTERVAL_MS);
  }

  /**
   * Stops the refresh interval timer.
   */
  function stopRefreshTimer(): void {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  const manager: HudManager = {
    async init(appBridge: any, config: HudLayoutConfig): Promise<void> {
      renderer = new HudSlotRenderer(appBridge);
      paused = false;

      await manager.rebuild(config);
      startRefreshTimer();

      // Immediate refresh so live data (weather) lands without waiting a
      // full interval. Awaited so callers can rely on the HUD being settled.
      await manager.refreshAll();
    },

    async rebuild(config: HudLayoutConfig): Promise<void> {
      for (const slot of activeSlots) {
        slot.component.dispose();
      }
      activeSlots = [];

      for (const slotConfig of config.slots) {
        if (
          slotConfig.componentType !== null &&
          isSlotInBounds(slotConfig.row, slotConfig.col)
        ) {
          activeSlots.push({
            row: slotConfig.row,
            col: slotConfig.col,
            component: createComponent(slotConfig.componentType),
          });
        }
      }

      // renderAll writes every column, including the ones that just became
      // empty, so no separate clear pass is needed.
      await renderAll();
    },

    async refreshAll(): Promise<void> {
      // Refresh even while invisible: components keep their caches warm
      // (weather fetches, reminder triggers) so waking is instant.
      for (const slot of activeSlots) {
        await slot.component.refresh();
      }
      await renderAll();
    },

    async setVisible(next: boolean): Promise<void> {
      if (visible === next) return;
      visible = next;
      await renderAll();
    },

    isVisible(): boolean {
      return visible;
    },

    /**
     * Drops memoized container content. Call after the page is rebuilt so
     * the next render writes through instead of assuming stale state.
     */
    invalidate(): void {
      renderer?.reset();
    },

    pause(): void {
      paused = true;
      stopRefreshTimer();
    },

    resume(): void {
      if (!paused) return;
      paused = false;
      startRefreshTimer();
      void manager.refreshAll();
    },

    dispose(): void {
      stopRefreshTimer();
      for (const slot of activeSlots) {
        slot.component.dispose();
      }
      activeSlots = [];
      renderer = null;
    },
  };

  return manager;
}
