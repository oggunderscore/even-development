import type { HudComponent, HudComponentType, HudManager } from "./types";
import type { HudLayoutConfig } from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";
import { HudSlotRenderer } from "./hud-slot";
import { createClockComponent } from "./components/clock";
import { createWeatherComponent } from "./components/weather";
import {
  createRemindersComponent,
  type NotificationCallback,
} from "./components/reminders";
import { HUD_REFRESH_INTERVAL_MS } from "../constants";

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
  let bridge: any = null;
  let renderer: HudSlotRenderer | null = null;
  let activeSlots: ActiveSlot[] = [];
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let paused = false;

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
   * Renders all active slots to the display.
   * Composes all slot content into a single string since we use one container.
   * Column positions determine spacing — empty columns between components
   * are filled with padding to preserve the grid layout.
   */
  async function renderAll(): Promise<void> {
    const r = renderer;
    if (!r) return;

    // Build a map of col → content for each column container.
    // Each slot renders into its own container (one per column, IDs 0–4).
    const colContent: Map<number, string> = new Map();

    for (const slot of activeSlots) {
      const content = slot.component.render();
      const existing = colContent.get(slot.col) || "";
      if (slot.row === 0) {
        colContent.set(
          slot.col,
          existing ? `${existing}\n${content}` : content,
        );
      } else {
        // Row 1: append with newline under any row 0 content
        const base = colContent.get(slot.col) || "";
        colContent.set(slot.col, base ? `${base}\n${content}` : `\n${content}`);
      }
    }

    // Render each column container — clear empty ones, fill active ones
    for (let col = 0; col < 5; col++) {
      const content = colContent.get(col) || "";
      await r.renderToContainer(col, `hud-col-${col}`, content);
    }
  }

  /**
   * Clears all 5 HUD column containers.
   */
  async function clearAllSlots(): Promise<void> {
    const r = renderer;
    if (!r) return;

    for (let col = 0; col < 5; col++) {
      await r.renderToContainer(col, `hud-col-${col}`, "");
    }
  }

  /**
   * Starts the 60-second refresh interval timer.
   */
  function startRefreshTimer(): void {
    stopRefreshTimer();
    refreshTimer = setInterval(async () => {
      if (!paused) {
        await manager.refreshAll();
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
      bridge = appBridge;
      renderer = new HudSlotRenderer(bridge);
      paused = false;

      await manager.rebuild(config);
      startRefreshTimer();

      // Trigger an immediate refresh to fetch live data (e.g. weather)
      manager.refreshAll();
    },

    async rebuild(config: HudLayoutConfig): Promise<void> {
      // Dispose existing components
      for (const slot of activeSlots) {
        slot.component.dispose();
      }
      activeSlots = [];

      // Instantiate components for configured slots
      for (const slotConfig of config.slots) {
        if (slotConfig.componentType !== null) {
          const component = createComponent(slotConfig.componentType);
          activeSlots.push({
            row: slotConfig.row,
            col: slotConfig.col,
            component,
          });
        }
      }

      // Clear all slots first (handles slots that are now empty)
      await clearAllSlots();

      // Render all active components immediately
      await renderAll();
    },

    async refreshAll(): Promise<void> {
      // Refresh all active components (fetch fresh data)
      for (const slot of activeSlots) {
        await slot.component.refresh();
      }

      // Re-render all active components
      await renderAll();
    },

    pause(): void {
      paused = true;
      stopRefreshTimer();
    },

    resume(): void {
      paused = false;
      startRefreshTimer();

      // Trigger an immediate refresh
      manager.refreshAll();
    },

    dispose(): void {
      stopRefreshTimer();

      // Dispose all components
      for (const slot of activeSlots) {
        slot.component.dispose();
      }
      activeSlots = [];

      // Clear display synchronously by nulling references
      // (renderer is no longer usable after dispose)
      renderer = null;
      bridge = null;
    },
  };

  return manager;
}
