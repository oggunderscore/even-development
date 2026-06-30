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
   */
  async function renderAll(): Promise<void> {
    const r = renderer;
    if (!r) return;

    for (const slot of activeSlots) {
      const content = slot.component.render();
      await r.renderSlot(slot.row, slot.col, content);
    }
  }

  /**
   * Clears all 10 HUD slot containers.
   */
  async function clearAllSlots(): Promise<void> {
    const r = renderer;
    if (!r) return;

    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 5; col++) {
        await r.clearSlot(row as 0 | 1, col as 0 | 1 | 2 | 3 | 4);
      }
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
