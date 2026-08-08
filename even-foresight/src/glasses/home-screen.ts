/**
 * Home screen — the glasses runtime.
 *
 * Owns the one and only page layout: five HUD column containers, a menu
 * container, a banner container, and a sub-app container, all allocated by a
 * single `rebuildPageContainer` call. Nothing below this module may rebuild
 * the page; a rebuild replaces every container and would wipe the HUD.
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
import { applyMenuOrder } from "../menu/menu-order";
import { createNotificationSystem } from "../notification/notification-system";
import type { HudManager } from "../hud/types";
import type { MenuSystem, MenuEntry } from "../menu/types";
import type { NotificationSystem } from "../notification/notification-system";
import { createRemindersApp } from "../reminders/reminders-app";
import {
  createSubAppContainer,
  type SubAppContainerInstance,
} from "../sub-app/sub-app-container";
import {
  createSubAppRegistry,
  type SubAppRegistry,
} from "../sub-app/sub-app-registry";
import {
  routeGesture,
  type AppState,
  type GestureType,
} from "../gesture-router";
import type { StorageManager } from "../storage/storage-manager";
import {
  STORAGE_KEYS,
  DEFAULT_SMARTER_EVERYDAY_SETTINGS,
  DEFAULT_MENU_ORDER,
  type HudLayoutConfig,
  type SmarterEverydaySettings,
  type MenuOrder,
} from "../storage/schemas";
import { createTopicManager } from "../smarter-everyday/topic-manager";
import { createScheduler, type Scheduler } from "../smarter-everyday/scheduler";
import {
  createContentGenerator,
  createStorageShownContentLogAccessor,
  type DeliveryNotification,
} from "../smarter-everyday/content-generator";
import { createPlaceholderLlmClient } from "../smarter-everyday/llm-client";
import { createSmarterEverydayApp } from "../smarter-everyday/smarter-everyday-app";
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
  SUBAPP_HEIGHT,
  SUBAPP_WIDTH,
  SUBAPP_Y_OFFSET,
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
  handleHold(): void;
  /** Re-read a config key that the phone webapp just changed. */
  applyConfigChange(key: string, value: unknown): void;
  /** Pushes a banner from the phone's Debug tab, bypassing any real source app. */
  pushDebugNotification(text: string): void;
  /**
   * Self-correcting catch-up for state a throttled/suspended background
   * WebView may have missed (overdue sleep, stale HUD content). Call on
   * every raw SDK event and on `FOREGROUND_ENTER_EVENT`. See the
   * implementation's doc comment for why this exists.
   */
  catchUpAfterPossibleThrottling(): void;
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

  // The surface an activated SubApp draws into. Declared after the menu so it
  // draws on top of the menu region it overlaps; the two are never non-empty
  // at once, since `MenuSystem.select()` hides the menu before activating.
  containers.push(
    new TextContainerProperty({
      containerID: CONTAINER.SUBAPP,
      containerName: CONTAINER_NAME.SUBAPP,
      xPosition: 0,
      yPosition: SUBAPP_Y_OFFSET,
      width: SUBAPP_WIDTH,
      height: SUBAPP_HEIGHT,
      paddingLength: 0,
      borderWidth: 0,
      content: "",
      isEventCapture: 0,
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
  let notifications: NotificationSystem | null = null;
  let scheduler: Scheduler | null = null;
  const subApps: SubAppRegistry = createSubAppRegistry();
  let subAppContainer: SubAppContainerInstance | null = null;
  /** Every menu entry in its natural (registration) order, before the wearer's saved MENU_ORDER is applied. Set once in `start()`. */
  let allMenuEntries: MenuEntry[] = [];

  /** HUD asleep because the inactivity timer expired. */
  let hudAsleep = false;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let sleepDelayMs: number | null = null; // null = never sleep
  let disposed = false;
  /** Wall-clock time of the last input/notification activity. See `catchUpAfterPossibleThrottling`. */
  let lastActivityAt = Date.now();

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

  /**
   * Clears `hudAsleep` and restarts the inactivity countdown, WITHOUT
   * calling `hud.setVisible(true)` — unlike `wakeHud()`. Use this (not
   * `wakeHud()`) from any notification-push site.
   *
   * `NotificationSystem`'s own `onVisibilityChange(true)` already calls
   * `hud.setVisible(false)` synchronously as part of `push()` (to blank the
   * HUD band the banner overlaps). `wakeHud()` calling `setVisible(true)`
   * right after that — both fire-and-forget, both mutating the same
   * `HudManager` `visible` flag — raced the two calls: `setVisible(true)`
   * could flip `visible` back and start re-drawing real HUD content
   * (clock, weather) into the very columns `setVisible(false)` was still in
   * the middle of blanking, while the banner text stayed up throughout in
   * its own separate container. That's what produced notification text
   * rendered directly on top of the clock. `onVisibilityChange(false)`
   * (banner dismissed) already re-lights the HUD correctly, gated on
   * `!hudAsleep` — so clearing the flag here is enough; the repaint happens
   * there, after the banner is actually gone, instead of racing it.
   */
  function noteHudActivityForNotification(): void {
    hudAsleep = false;
    lastActivityAt = Date.now();
    armSleepTimer();
  }

  /** Any user input postpones sleep. */
  function noteActivity(): void {
    lastActivityAt = Date.now();
    if (!hudAsleep) armSleepTimer();
  }

  /**
   * Self-correcting catch-up for state a throttled/suspended background
   * WebView may have missed, called wherever we're guaranteed to be
   * running un-throttled: every raw SDK event (proves the JS context is
   * alive right now, whatever it is) and explicitly on
   * `FOREGROUND_ENTER_EVENT` (`runtime.ts`).
   *
   * Real mobile WebViews (Android in particular) suspend or heavily
   * throttle `setInterval`/`setTimeout` while the phone is locked or the
   * host app is backgrounded — per `even-realities-docs/build/
   * background-lifecycle.md` this is documented platform behavior, not a
   * bug, and for a glasses wearer it's the *normal* operating condition
   * (phone in a pocket), not an edge case. That silently broke two things
   * that only ever trusted a scheduled callback to fire on time: the
   * inactivity-sleep `setTimeout` (`armSleepTimer`) and the HUD's 60s
   * refresh `setInterval` (`hud-manager.ts`) — matching reports of "Sleep
   * After 15s" never engaging, and the HUD (clock, weather, a pushed
   * notification's aftermath) appearing to update only once every several
   * minutes instead of continuously. `reference/community/pomodoro-even-g2`
   * hits the identical problem and fixes it the same way: never trust
   * timer cadence, recompute from wall-clock elapsed time, and force a
   * catch-up the moment the page is known to be running again.
   *
   * Both actions here are safe to run unconditionally and often: a sleep
   * check that finds nothing overdue is a no-op, and `hud.refreshAll()`
   * costs zero BLE traffic when nothing actually changed
   * (`HudSlotRenderer` memoizes per-container writes).
   */
  function catchUpAfterPossibleThrottling(): void {
    if (disposed || !hud) return;

    // The sleep setTimeout may have been due minutes ago and simply never
    // fired. Don't wait for it — if it's overdue, act now.
    if (
      !hudAsleep &&
      sleepDelayMs !== null &&
      Date.now() - lastActivityAt >= sleepDelayMs
    ) {
      void sleepHud();
    }

    // The periodic refresh may have been silently skipped or delayed —
    // opportunistically refresh rather than only trusting its own cadence.
    void hud.refreshAll();
  }

  // ── Menu ordering ───────────────────────────────────────────────────────

  /**
   * (Re)builds the `MenuSystem` from `allMenuEntries`, applying the wearer's
   * saved order (`STORAGE_KEYS.MENU_ORDER`). Called once in `start()` and
   * again whenever the phone webapp saves a new order. Replacing the
   * instance (rather than mutating entries in place) is safe because
   * `MenuSystem` never rebuilds the page — it only re-writes the `menu`
   * container's content, exactly like any other `textContainerUpgrade`.
   */
  async function rebuildMenu(): Promise<void> {
    const order =
      storage.get<MenuOrder>(STORAGE_KEYS.MENU_ORDER) ?? DEFAULT_MENU_ORDER;
    const ordered = applyMenuOrder(allMenuEntries, order);

    const wasVisible = menu?.isVisible ?? false;
    if (menu) {
      await menu.hide();
      menu.dispose();
    }
    menu = createMenuSystem(bridge, ordered);
    if (wasVisible) await menu.show();
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
  //
  // Every gesture goes through the ONE pure router, `routeGesture`
  // (`gesture-router.ts`, task 13.3). It owns the priority order — banner,
  // Notification_Center, menu, active sub-app, bare HUD — and this module only
  // executes the target it returns. Do not add a competing `if (menu?.isVisible)`
  // ladder back in here: the two drifting apart is exactly what this replaced.
  //
  // Two things routeGesture deliberately does not model, handled here:
  //
  //   - **Sleep.** `AppState` has no "asleep" flag, because sleep is a
  //     HUD-level concern: it blanks the HUD columns and nothing else, so a
  //     menu or center that is up stays readable and keeps its gestures. Only
  //     the three HUD-level targets are gated on it (see `wakeInstead`).
  //   - **`hold`.** Reachable in principle, not in practice: per
  //     `press-adapter.ts`'s documented fallback (Requirements 10.1–10.3) the
  //     current SDK event surface exposes no touch-down signal, so
  //     `classifyPress` never returns `"hold"` yet. The path is complete end
  //     to end, ready for real press/release signals.

  /** Forwards a gesture to the active sub-app, if any. Returns true if consumed. */
  function forwardToSubApp(type: GestureType): boolean {
    if (!subAppContainer?.activeApp) return false;
    subAppContainer.handleGesture({ type, timestamp: Date.now() });
    return true;
  }

  function currentAppState(overrides?: Partial<AppState>): AppState {
    return {
      bannerVisible: notifications?.isVisible ?? false,
      menuVisible: menu?.isVisible ?? false,
      subAppActive: subAppContainer?.activeApp != null,
      notificationCenterVisible: notifications?.isCenterVisible ?? false,
      ...overrides,
    };
  }

  /**
   * A HUD-level gesture arriving on a sleeping HUD wakes it instead of acting.
   * Opening a menu — or a Notification_Center — on a display the wearer cannot
   * see is disorienting; the second gesture, now against a visible HUD, acts.
   */
  function wakeInstead(): boolean {
    if (!hudAsleep) return false;
    void wakeHud();
    return true;
  }

  function dispatchGesture(type: GestureType): void {
    noteActivity();

    // Preserved from the pre-`routeGesture` handlers: a double-tap over a
    // banner clears it and then acts on whatever is underneath. `routeGesture`
    // has no banner+double-tap case (it falls through), so the banner is
    // dismissed here and routing proceeds as though it were already gone.
    // `handleSwipeDismiss` archives, which awaits a storage write before
    // committing, so `isVisible` does not flip synchronously — hence the
    // explicit override rather than re-reading it.
    let bannerJustDismissed = false;
    if (type === "double-tap" && notifications?.isVisible) {
      notifications.handleSwipeDismiss();
      log("NOTIFICATION: DISMISS");
      bannerJustDismissed = true;
    }

    const { target } = routeGesture(
      currentAppState(bannerJustDismissed ? { bannerVisible: false } : undefined),
      type,
    );

    switch (target) {
      // Requirement 8.1: a tap on a visible banner EXPANDS it; the tap on the
      // expanded view is what dismisses it. The state machine owns that
      // two-step, so both taps go to the same call. (The target is named
      // `banner-dismiss` for pre-NotificationSystem callers — see its note in
      // `gesture-router.ts`.)
      case "banner-dismiss":
        notifications?.handleTap();
        log("NOTIFICATION: TAP");
        break;

      // Requirement 8.3: a swipe dismisses outright, with no expand step.
      case "banner-forward":
        notifications?.handleSwipeDismiss();
        log("NOTIFICATION: DISMISS");
        break;

      case "notification-center-nav":
        notifications?.handleCenterNav(type === "swipe-up" ? "up" : "down");
        break;

      // `routeGesture` sees only "the center is open" — `AppState` carries no
      // sub-phase — so the split between "select an entry" and "confirm the
      // clear-all prompt" is made here, against the phase the wearer is
      // actually looking at. Requirement 9.10: the prompt reads "Tap to
      // confirm", and `handleCenterSelect` no-ops in that phase, so without
      // this branch the prompt would be a dead end that only a double-tap
      // could escape and clear-all could never be confirmed at all.
      case "notification-center-select":
        if (notifications?.state.phase === "center-confirm-clear") {
          notifications.confirmClearHistory();
          log("NOTIFICATION CENTER: CLEAR ALL");
          break;
        }
        notifications?.handleCenterSelect();
        log("NOTIFICATION CENTER: SELECT");
        break;

      case "notification-center-close":
        notifications?.handleCenterClose();
        log("NOTIFICATION CENTER: CLOSE");
        break;

      // Requirement 9.9: hold opens the confirm-clear prompt.
      case "notification-center-hold":
        notifications?.handleHold();
        log("NOTIFICATION CENTER: HOLD");
        break;

      case "menu-nav":
        if (type === "swipe-up") menu?.moveUp();
        else menu?.moveDown();
        break;

      case "menu-select":
        void menu?.select();
        log("MENU: SELECT");
        break;

      case "menu-dismiss":
        void menu?.hide();
        log("MENU: CLOSE");
        break;

      // Double-tap is the way out of a sub-app: `SubAppContainer` intercepts
      // it rather than forwarding it (see `docs/SUBAPP_GUIDE.md` §4).
      case "subapp-deactivate":
        void subAppContainer?.deactivate();
        log("SUBAPP: CLOSE");
        break;

      case "subapp-forward":
        forwardToSubApp(type);
        break;

      case "open-menu":
        if (wakeInstead()) break;
        void menu?.show();
        log("MENU: OPEN");
        break;

      // Requirement 10.1: swipe-down on the bare HUD opens the
      // Notification_Center.
      case "open-notification-center":
        if (wakeInstead()) break;
        notifications?.openCenter();
        log("NOTIFICATION CENTER: OPEN");
        break;

      // Nothing is listening for this gesture in this state. A sleeping HUD
      // still wakes on it — "any gesture wakes it", per the inactivity timer.
      case "none":
        wakeInstead();
        break;
    }
  }

  // The five public gesture entry points. Each is a thin adapter from the
  // input router's vocabulary to a `GestureType`; all real decisions live in
  // `dispatchGesture` above.

  function handleTap(): void {
    dispatchGesture("single-tap");
  }

  function handleDoubleTap(): void {
    dispatchGesture("double-tap");
  }

  function handleScrollUp(): void {
    dispatchGesture("swipe-up");
  }

  function handleScrollDown(): void {
    dispatchGesture("swipe-down");
  }

  function handleHold(): void {
    dispatchGesture("hold");
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
      case STORAGE_KEYS.WEATHER_CACHE:
      case STORAGE_KEYS.CLOCK_CONFIG:
      case STORAGE_KEYS.REMINDERS:
        void hud?.refreshAll();
        break;

      case STORAGE_KEYS.MENU_ORDER:
        void rebuildMenu();
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

      notifications = createNotificationSystem(bridge, storage, {
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
        // Reminder banners keep the push shape they had under `BannerSystem`,
        // now carrying the source fields `NotificationEntry` added so the
        // expanded view and history can attribute them. Duration is left
        // unset so the system falls back to the user's `BANNER_CONFIG`
        // value, exactly as before.
        notifications?.push({
          id: `reminder-${Date.now()}`,
          sourceAppId: "tasks",
          sourceAppName: "Reminders",
          text: title,
          timestamp: Date.now(),
        });
        // A notification is worth waking for — but not via wakeHud(), which
        // races NotificationSystem's own HUD-blanking. See
        // noteHudActivityForNotification's doc comment.
        noteHudActivityForNotification();
      });

      // The page was just rebuilt, so any memoized container content is stale.
      hud.invalidate();
      await hud.init(bridge, currentLayout());

      // ── Sub-apps ────────────────────────────────────────────────────────
      // SmarterEveryday registers with `SubAppRegistry` at boot exactly as a
      // third-party sub-app would (Requirement 12.2, `docs/SUBAPP_GUIDE.md`
      // §2), and every registered sub-app is surfaced as a menu entry that
      // delegates to the shared `SubAppContainer`.
      subAppContainer = createSubAppContainer(bridge);
      const container = subAppContainer;
      const topicManager = createTopicManager(storage);

      if (!subApps.register(createSmarterEverydayApp(topicManager))) {
        log("SUBAPP: REGISTER FAILED (smarter-everyday)");
      }
      if (!subApps.register(createRemindersApp(storage))) {
        log("SUBAPP: REGISTER FAILED (reminders)");
      }

      const subAppEntries: MenuEntry[] = subApps.getAll().map((app) => ({
        id: app.id,
        name: app.name,
        activate: () => container.activate(app),
        cleanup: () => container.deactivate(),
      }));

      allMenuEntries = [
        ...(deps.extraMenuEntries ?? []),
        ...subAppEntries,
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
      ];
      await rebuildMenu();

      // SmarterEveryday's Scheduler (design.md Architecture decision 1,
      // Requirement 2.5): created and started here, alongside
      // `HudManager`/`MenuSystem` above, rather than inside
      // `SubApp.activate()`. `HudManager`/`MenuSystem` are instantiated in
      // this factory (`createHomeScreen`), not literally inside
      // `runtime.ts`'s `startHome()` — `startHome()` only calls
      // `createHomeScreen({...})` and `home.start()` — so this is the level
      // "alongside HudManager/MenuSystem" actually refers to. This makes
      // Content_Delivery fire on a 60-second tick loop regardless of
      // whether the SmarterEveryday SubApp is currently activated from the
      // menu, independent of the `SubAppContainer` lifecycle (task 12's
      // `createSmarterEverydayApp` only renders the on-glasses topic-list
      // view when opened; it does not own the scheduler). `topicManager` is
      // the same instance the registered SubApp reads from, created just above.
      const contentGenerator = createContentGenerator(
        createPlaceholderLlmClient(),
        createStorageShownContentLogAccessor(storage),
        (notification: DeliveryNotification) => {
          // Requirements 7.2/7.3: SmarterEveryday popups use their own
          // configured duration (10–120s, default 60), passed as the
          // per-notification override rather than the framework-wide banner
          // duration. The value is already clamped to that range by the
          // config form before it is stored.
          const settings =
            storage.get<SmarterEverydaySettings>(
              STORAGE_KEYS.SMARTER_EVERYDAY_SETTINGS,
            ) ?? DEFAULT_SMARTER_EVERYDAY_SETTINGS;

          notifications?.push({
            id: `smarter-everyday-${notification.topicId}-${Date.now()}`,
            sourceAppId: "smarter-everyday",
            sourceAppName: "SmarterEveryday",
            text: `${notification.topicDescription}: ${notification.content}`,
            duration: settings.popupDisplayDurationSeconds,
            timestamp: Date.now(),
          });
          noteHudActivityForNotification();
        },
        storage,
      );
      scheduler = createScheduler(topicManager, storage);
      scheduler.start(async (topic) => {
        await contentGenerator.deliver(topic);
      });

      applySleepSettings();
      log("HOME: READY");
    },

    handleTap,
    handleDoubleTap,
    handleScrollUp,
    handleScrollDown,
    handleHold,
    applyConfigChange,

    pushDebugNotification(text: string): void {
      notifications?.push({
        id: `debug-${Date.now()}`,
        sourceAppId: "debug",
        sourceAppName: "Debug",
        text,
        timestamp: Date.now(),
      });
      noteHudActivityForNotification();
    },

    catchUpAfterPossibleThrottling,

    dispose(): void {
      disposed = true;
      clearSleepTimer();
      scheduler?.stop();
      menu?.dispose();
      notifications?.dispose();
      void subAppContainer?.deactivate();
      hud?.dispose();
      scheduler = null;
      menu = null;
      notifications = null;
      subAppContainer = null;
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
