/**
 * Glasses runtime bootstrap.
 *
 * Sequence:
 *   1. Paint a one-container splash so the wearer sees something immediately.
 *   2. Hydrate the storage cache (bridge reads are async, `get()` is not).
 *   3. Either run onboarding or go straight to the home screen.
 *   4. Wire input, config-change, and lifecycle events.
 */

import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
} from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { createUserStore } from "../user/user-store";
import { createWelcomeScreen, type WelcomeScreen } from "../screens/welcome";
import { createStorageManager } from "../storage/storage-manager";
import { STORAGE_KEYS } from "../storage/schemas";
import { createHomeScreen, type HomeScreen } from "./home-screen";
import { createInputRouter, type Gesture } from "./input-router";
import { createPressAdapter } from "../press-adapter";
import { CONTAINER, CONTAINER_NAME } from "../constants";

/** Keys the glasses side reads synchronously and must hydrate up front. */
const HYDRATED_KEYS: string[] = [
  STORAGE_KEYS.HUD_LAYOUT,
  STORAGE_KEYS.CLOCK_CONFIG,
  STORAGE_KEYS.WEATHER_CONFIG,
  STORAGE_KEYS.WEATHER_CACHE,
  STORAGE_KEYS.WEATHER_LOCATION,
  STORAGE_KEYS.REMINDERS,
  // Read synchronously in `home-screen.ts#rebuildMenu()`, called once at boot
  // and again on every MENU_ORDER config change — without hydrating it here
  // the first menu built each session would ignore a saved order.
  STORAGE_KEYS.MENU_ORDER,
  STORAGE_KEYS.BANNER_CONFIG,
  STORAGE_KEYS.HUD_SLEEP,
  STORAGE_KEYS.HUD_SLEEP_DELAY,
  STORAGE_KEYS.DOUBLE_TAP_DELAY,
  // SmarterEveryday's Scheduler/TopicManager/ContentGenerator now start at
  // boot (task 13.1), independent of whether the SubApp is on-screen, and
  // all three read these keys synchronously via `storage.get()`
  // (`createTopicManager.list()`, the scheduler's own topics-store read/
  // write, and `createContentGenerator.deliver`'s Assistant_App config
  // check) — without hydrating them here, the first tick after boot would
  // see empty/null stores until some *other* code path happened to call
  // `loadKey` for them.
  STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
  STORAGE_KEYS.SMARTER_EVERYDAY_LOGS,
  STORAGE_KEYS.SMARTER_EVERYDAY_SETTINGS,
  STORAGE_KEYS.ASSISTANT_CONFIG,
  // `createNotificationSystem` (task 13.2) seeds its state machine from the
  // persisted Notification_History synchronously at construction, so without
  // this the Notification_Center would come up empty after every restart even
  // though the entries are on disk.
  STORAGE_KEYS.NOTIFICATION_HISTORY,
];

/** Container used for the splash and onboarding, before the home page exists. */
const SPLASH_CONTAINER_ID = CONTAINER.HUD_COL_BASE;
const SPLASH_CONTAINER_NAME = CONTAINER_NAME.hudCol(0);

export interface GlassesRuntime {
  dispose(): void;
}

export interface GlassesRuntimeDeps {
  bridge: EvenAppBridge;
  /** Diagnostic sink shown in the phone UI's debug log. */
  log?: (message: string) => void;
}

export async function startGlassesRuntime(
  deps: GlassesRuntimeDeps,
): Promise<GlassesRuntime> {
  const { bridge } = deps;
  const log = deps.log ?? (() => {});

  // ── 1. Splash ───────────────────────────────────────────────────────────
  // createStartUpPageContainer may be called exactly once per app lifetime.
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: SPLASH_CONTAINER_ID,
          containerName: SPLASH_CONTAINER_NAME,
          xPosition: 80,
          yPosition: 80,
          width: 416,
          height: 180,
          paddingLength: 0,
          borderWidth: 0,
          content: "Foresight",
          isEventCapture: 1,
        }),
      ],
    }),
  );

  // ── 2. Hydrate ──────────────────────────────────────────────────────────
  const userStore = createUserStore(bridge);
  const storage = createStorageManager(bridge);
  await Promise.all([userStore.loadProfile(), storage.loadKeys(HYDRATED_KEYS)]);

  async function writeSplash(content: string): Promise<void> {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: SPLASH_CONTAINER_ID,
        containerName: SPLASH_CONTAINER_NAME,
        content,
      }),
    );
  }

  await writeSplash("");

  // ── 3. State ────────────────────────────────────────────────────────────
  let welcome: WelcomeScreen | null = null;
  let home: HomeScreen | null = null;
  let disposed = false;

  const input = createInputRouter({
    onGesture: (gesture: Gesture) => {
      if (disposed) return;

      // During onboarding the welcome screen owns every gesture.
      if (welcome) {
        if (gesture === "tap" || gesture === "double-tap") {
          welcome.handleTap();
        }
        return;
      }

      switch (gesture) {
        case "tap":
          home?.handleTap();
          break;
        case "double-tap":
          home?.handleDoubleTap();
          break;
        case "scroll-up":
          home?.handleScrollUp();
          break;
        case "scroll-down":
          home?.handleScrollDown();
          break;
      }
    },
    onExit: () => {
      dispose();
      void bridge.shutDownPageContainer();
    },
    onDiagnostic: log,
  });

  input.setDoubleTapWindow(storage.get<number>(STORAGE_KEYS.DOUBLE_TAP_DELAY));

  // Task 13.3: feeds the SAME raw events as `input` above through the
  // press/release adapter (task 2.3), so a Hold gesture has a complete code
  // path from raw SDK event through `classifyPress` to `home.handleHold()`.
  // Per the adapter's own documented fallback (Requirements 10.1–10.3), the
  // currently-documented SDK touchpad event surface gives no earlier
  // touch-down signal, so `resolvePressState` can only ever observe
  // `pressStartMs === releaseMs` and therefore always resolves `"released"`
  // — `onResolution` is never actually called with `"hold"` today. Wiring it
  // through anyway keeps this pipeline independent of and non-interfering
  // with `input`'s existing tap/double-tap/scroll classification, ready for
  // real press/release hardware signals without further changes here.
  const pressAdapter = createPressAdapter({
    onResolution: (resolution) => {
      if (disposed) return;
      if (resolution.classification !== "hold") {
        // "released" already falls through to `input`'s own
        // classifyEvent-based tap/double-tap path for the same raw event;
        // "pending" means still held and not yet resolved. Neither has a
        // gesture to emit yet.
        return;
      }
      if (welcome) return; // Onboarding does not define hold semantics.
      home?.handleHold();
    },
    onDiagnostic: log,
  });

  // ── 4. Wiring ───────────────────────────────────────────────────────────

  /**
   * The phone webapp and the glasses runtime share one page, so config saves
   * arrive as a same-document custom event rather than through the bridge.
   */
  const onConfigChanged = (event: Event): void => {
    if (disposed) return;
    const detail = (event as CustomEvent).detail as
      | { key?: string; value?: unknown }
      | undefined;
    if (!detail?.key) return;

    if (detail.key === STORAGE_KEYS.DOUBLE_TAP_DELAY) {
      input.setDoubleTapWindow(detail.value);
      return;
    }
    home?.applyConfigChange(detail.key, detail.value);
  };
  window.addEventListener("foresight-config-changed", onConfigChanged);

  /**
   * The Debug tab's "Notification" send button. Unlike config values, a
   * pushed notification isn't a stored setting to read back — it's a
   * one-off action — so it travels as its own same-document custom event
   * rather than through `foresight-config-changed`.
   */
  const onDebugNotification = (event: Event): void => {
    if (disposed) return;
    const detail = (event as CustomEvent).detail as { text?: string } | undefined;
    if (!detail?.text) return;
    home?.pushDebugNotification(detail.text);
  };
  window.addEventListener("foresight-debug-notification", onDebugNotification);

  const unsubscribeEvents = bridge.onEvenHubEvent((event: any) => {
    if (disposed) return;

    const sysType = event?.sysEvent?.eventType ?? -1;
    // FOREGROUND_EXIT/ENTER fire when the PHONE backgrounds or locks the
    // Even Realities host app (`../../even-realities-docs/build/
    // background-lifecycle.md`) — not when the wearer stops looking at the
    // glasses. The glasses' own display and BLE link stay up regardless of
    // the phone's screen state, so this used to call `home.pause()`, which
    // froze the HUD refresh loop *and* the inactivity-sleep timer, and
    // `home.resume()`, which restarted the sleep countdown from zero. Real
    // phones lock every 30-120s; the simulator's browser tab never fires
    // this event at all. That mismatch is why "Sleep After" (and the HUD
    // generally going stale) worked in the simulator but not on real
    // hardware: on-device, the countdown was being reset or frozen far more
    // often than it could ever reach its target. Per the docs, iOS keeps
    // running through a background with no special handling needed; Android
    // may suspend the WebView outright, which pausing here can't prevent —
    // if it happens, this handler doesn't run either. FOREGROUND_ENTER is
    // still useful, though: it's the moment we're guaranteed to be resuming
    // from whatever throttling happened, so catch up explicitly right here
    // (nothing else below would, since this branch returns before reaching
    // the general catch-up call).
    if (
      sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
      sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT
    ) {
      log(
        sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT
          ? "LIFECYCLE: PHONE BACKGROUND"
          : "LIFECYCLE: PHONE FOREGROUND",
      );
      home?.catchUpAfterPossibleThrottling();
      return;
    }

    input.handleEvent(event);
    pressAdapter.handleEvent(event);

    // Runs AFTER classification/dispatch, not before: a real gesture has
    // already called noteActivity() by this point (via dispatchGesture,
    // above), which resets the "last activity" clock to right now — so the
    // stale-sleep half of the catch-up below correctly sees nothing
    // overdue for the very gesture that's currently arriving, instead of
    // sleeping the HUD and then immediately waking it again one event
    // handler later. This call still matters for events that *don't*
    // produce a classified gesture (raw "unknown" events, of which there
    // can be several between real taps) and to opportunistically refresh
    // HUD content the scheduled interval may have missed. See
    // `home-screen.ts#catchUpAfterPossibleThrottling`'s doc comment for the
    // underlying "background WebViews throttle timers" issue this exists
    // to work around.
    home?.catchUpAfterPossibleThrottling();
  });

  const onBeforeUnload = (): void => dispose();
  window.addEventListener("beforeunload", onBeforeUnload);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("foresight-config-changed", onConfigChanged);
    window.removeEventListener(
      "foresight-debug-notification",
      onDebugNotification,
    );
    window.removeEventListener("beforeunload", onBeforeUnload);
    input.dispose();
    welcome?.dispose();
    welcome = null;
    home?.dispose();
    home = null;
    if (typeof unsubscribeEvents === "function") unsubscribeEvents();
  }

  // ── 5. Enter onboarding or home ─────────────────────────────────────────
  async function startHome(): Promise<void> {
    welcome?.dispose();
    welcome = null;
    if (disposed) return;

    home = createHomeScreen({ bridge, storage, log });
    await home.start();
  }

  const profile = userStore.getProfile();
  if (userStore.isOnboarded() || profile?.username) {
    // A profile with a username means the user logged in on the phone. Treat
    // that as onboarded even if they never tapped through the glasses
    // greeting, so they are not stuck on a screen they already passed.
    if (!userStore.isOnboarded() && profile) {
      await userStore.completeOnboarding();
    }
    await startHome();
  } else {
    welcome = createWelcomeScreen(bridge, userStore);
    welcome.onComplete(() => {
      void startHome();
    });
  }

  return { dispose };
}
