/**
 * Home screen — the glasses runtime.
 *
 * Owns the one and only page layout: five HUD column containers, a menu
 * container, and a banner container, all allocated by a single
 * `rebuildPageContainer` call. Nothing below this module may rebuild the
 * page; a rebuild replaces every container and would wipe the HUD.
 *
 * Also owns input routing and the inactivity timer that puts the HUD to
 * sleep so it is not permanently in the wearer's field of view.
 */

import {
  RebuildPageContainer,
  TextContainerProperty,
} from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { createHudManager } from "../hud/hud-manager";
import { createMenuSystem } from "../menu/menu-system";
import { createBannerSystem } from "../banner/banner-system";
import type { HudManager } from "../hud/types";
import type { MenuSystem, MenuEntry } from "../menu/types";
import type { BannerSystem } from "../banner/types";
import type { StorageManager } from "../storage/storage-manager";
import { STORAGE_KEYS, type HudLayoutConfig } from "../storage/schemas";
import {
  hudGridToLayoutConfig,
  readSleepSettings,
  type HudGridPlacement,
} from "./layout";
import {
  CONTAINER,
  CONTAINER_NAME,
  HOME_CONTAINER_COUNT,
  HUD_COLS,
  HUD_SLOT_WIDTH,
  HUD_HEIGHT,
  HUD_Y,
  OVERLAY_Y,
  OVERLAY_WIDTH,
  OVERLAY_HEIGHT,
} from "../constants";

export interface HomeScreenDeps {
  bridge: EvenAppBridge;
  storage: StorageManager;
  /** Extra menu entries appended after the built-in ones. */
  extraMenuEntries?: MenuEntry[];
  /** Diagnostic sink mirrored to the phone's debug log. */
  log?: (message: string) => void;
}

export interface HomeScreen {
  start(): Promise<void>;
  /** Route a classified gesture. Returns true when it was consumed. */
  handleTap(): void;
  handleDoubleTap(): void;
  handleScrollUp(): void;
  handleScrollDown(): void;
  /** Re-read a config key that the phone webapp just changed. */
  applyConfigChange(key: string, value: unknown): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  // Exposed for tests and diagnostics.
  readonly isMenuOpen: boolean;
  readonly isHudAwake: boolean;
}

/**
 * Builds the page container set.
 *
 * `isEventCapture` sits on the menu container: exactly one container may
 * carry it, and the menu is the only surface long enough to need the
 * firmware's overflow scrolling.
 */
function buildPageContainers(): InstanceType<typeof TextContainerProperty>[] {
  const containers: InstanceType<typeof TextContainerProperty>[] = [];

  for (let col = 0; col < HUD_COLS; col++) {
    containers.push(
      new TextContainerProperty({
        containerID: CONTAINER.HUD_COL_BASE + col,
        containerName: CONTAINER_NAME.hudCol(col),
        xPosition: col * HUD_SLOT_WIDTH,
        yPosition: HUD_Y,
        width: HUD_SLOT_WIDTH,
        height: HUD_HEIGHT,
        paddingLength: 0,
        borderWidth: 0,
        content: "",
        isEventCapture: 0,
      }),
    );
  }

  containers.push(
    new TextContainerProperty({
      containerID: CONTAINER.MENU,
      containerName: CONTAINER_NAME.MENU,
      xPosition: 0,
      yPosition: OVERLAY_Y,
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      paddingLength: 0,
      borderWidth: 0,
      content: "",
      isEventCapture: 1,
    }),
  );

  // Declared last so it draws on top of the HUD band it overlaps.
  containers.push(
    new TextContainerProperty({
      containerID: CONTAINER.BANNER,
      containerName: CONTAINER_NAME.BANNER,
      xPosition: 0,
      yPosition: HUD_Y,
      width: OVERLAY_WIDTH,
      height: HUD_HEIGHT,
      paddingLength: 0,
      borderWidth: 0,
      content: "",
      isEventCapture: 0,
    }),
  );

  return containers;
}

export function createHomeScreen(deps: HomeScreenDeps): HomeScreen {
  const { bridge, storage } = deps;
  const log = deps.log ?? (() => {});

  let hud: HudManager | null = null;
  let menu: MenuSystem | null = null;
  let banner: BannerSystem | null = null;

  /** HUD asleep because the inactivity timer expired. */
  let hudAsleep = false;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let sleepDelayMs: number | null = null; // null = never sleep
  let disposed = false;

  function currentLayout(): HudLayoutConfig {
    return hudGridToLayoutConfig(
      storage.get<HudGridPlacement[]>(STORAGE_KEYS.HUD_LAYOUT) ?? [],
    );
  }

  // ── Inactivity sleep ────────────────────────────────────────────────────

  function clearSleepTimer(): void {
    if (sleepTimer !== null) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
  }

  /**
   * Restarts the countdown to sleep. Called on every input and whenever the
   * HUD becomes visible again. A null delay means "never sleep".
   */
  function armSleepTimer(): void {
    clearSleepTimer();
    if (disposed || sleepDelayMs === null) return;
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      void sleepHud();
    }, sleepDelayMs);
  }

  async function sleepHud(): Promise<void> {
    if (hudAsleep || !hud) return;
    hudAsleep = true;
    clearSleepTimer();
    await hud.setVisible(false);
    log("HUD: SLEEP");
  }

  async function wakeHud(): Promise<void> {
    if (!hud) return;
    if (hudAsleep) {
      hudAsleep = false;
      await hud.setVisible(true);
      log("HUD: WAKE");
    }
    armSleepTimer();
  }

  /** Any user input postpones sleep. */
  function noteActivity(): void {
    if (!hudAsleep) armSleepTimer();
  }

  function applySleepSettings(): void {
    sleepDelayMs = readSleepSettings(storage);
    if (sleepDelayMs === null) {
      // "Never sleep" — cancel any pending sleep and restore the HUD.
      clearSleepTimer();
      void wakeHud();
    } else {
      armSleepTimer();
    }
  }

  // ── Input routing ───────────────────────────────────────────────────────

  function handleTap(): void {
    noteActivity();

    if (banner?.isVisible) {
      banner.dismiss();
      log("BANNER: DISMISS");
      return;
    }

    if (menu?.isVisible) {
      void menu.select();
      log("MENU: SELECT");
      return;
    }

    // A sleeping HUD wakes on a single tap too — cheaper than a double-tap
    // and the gesture is otherwise unused on the home screen.
    if (hudAsleep) {
      void wakeHud();
    }
  }

  function handleDoubleTap(): void {
    noteActivity();

    if (banner?.isVisible) {
      banner.dismiss();
    }

    // While asleep, a double-tap only wakes the display. Opening the menu on
    // a screen the wearer cannot see would be disorienting; the second
    // double-tap, now against a visible HUD, opens it.
    if (hudAsleep) {
      void wakeHud();
      return;
    }

    if (menu?.isVisible) {
      void menu.hide();
      log("MENU: CLOSE");
    } else {
      void menu?.show();
      log("MENU: OPEN");
    }
  }

  function handleScrollUp(): void {
    noteActivity();
    if (hudAsleep) {
      void wakeHud();
      return;
    }
    menu?.moveUp();
  }

  function handleScrollDown(): void {
    noteActivity();
    if (hudAsleep) {
      void wakeHud();
      return;
    }
    menu?.moveDown();
  }

  // ── Config changes pushed from the phone webapp ─────────────────────────

  function applyConfigChange(key: string, value: unknown): void {
    // The webapp already persisted this through the bridge; mirror it into
    // the synchronous read cache so components see it on their next render.
    storage.setCached(key, value);

    switch (key) {
      case STORAGE_KEYS.HUD_LAYOUT:
        // Rebuild even while asleep: the components must exist so the next
        // wake shows the new layout instead of the old one.
        void hud?.rebuild(currentLayout());
        break;

      case STORAGE_KEYS.HUD_SLEEP:
      case STORAGE_KEYS.HUD_SLEEP_DELAY:
        applySleepSettings();
        break;

      case STORAGE_KEYS.WEATHER_CONFIG:
      case STORAGE_KEYS.WEATHER_LOCATION:
      case STORAGE_KEYS.CLOCK_CONFIG:
      case STORAGE_KEYS.REMINDERS:
        void hud?.refreshAll();
        break;
    }
  }

  return {
    async start(): Promise<void> {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: HOME_CONTAINER_COUNT,
          textObject: buildPageContainers(),
        }),
      );

      banner = createBannerSystem(bridge, storage, {
        // The banner overlaps the HUD band. Rather than rely on unspecified
        // overlap compositing, blank the HUD while a banner is up and paint
        // it back when the queue drains.
        onVisibilityChange: (visible) => {
          if (visible) {
            void hud?.setVisible(false);
          } else if (!hudAsleep) {
            void hud?.setVisible(true);
          }
        },
      });

      hud = createHudManager(storage, (title: string) => {
        banner?.push({
          id: `reminder-${Date.now()}`,
          text: title,
          timestamp: Date.now(),
        });
        // A notification is worth waking for.
        void wakeHud();
      });

      // The page was just rebuilt, so any memoized container content is stale.
      hud.invalidate();
      await hud.init(bridge, currentLayout());

      menu = createMenuSystem(bridge, [
        ...(deps.extraMenuEntries ?? []),
        {
          id: "exit",
          name: "Exit Foresight",
          // Mode 1 shows the system exit-confirmation dialog, which the
          // platform requires for any user-initiated exit from the root page.
          activate: async () => {
            await bridge.shutDownPageContainer(1);
          },
          cleanup: async () => {},
        },
      ]);

      applySleepSettings();
      log("HOME: READY");
    },

    handleTap,
    handleDoubleTap,
    handleScrollUp,
    handleScrollDown,
    applyConfigChange,

    pause(): void {
      clearSleepTimer();
      hud?.pause();
    },

    resume(): void {
      hud?.resume();
      if (!hudAsleep) armSleepTimer();
    },

    dispose(): void {
      disposed = true;
      clearSleepTimer();
      menu?.dispose();
      banner?.dispose();
      hud?.dispose();
      menu = null;
      banner = null;
      hud = null;
    },

    get isMenuOpen(): boolean {
      return menu?.isVisible ?? false;
    },

    get isHudAwake(): boolean {
      return !hudAsleep;
    },
  };
}
