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
import { CONTAINER, CONTAINER_NAME } from "../constants";

/** Keys the glasses side reads synchronously and must hydrate up front. */
const HYDRATED_KEYS: string[] = [
  STORAGE_KEYS.HUD_LAYOUT,
  STORAGE_KEYS.CLOCK_CONFIG,
  STORAGE_KEYS.WEATHER_CONFIG,
  STORAGE_KEYS.WEATHER_CACHE,
  STORAGE_KEYS.WEATHER_LOCATION,
  STORAGE_KEYS.REMINDERS,
  STORAGE_KEYS.BANNER_CONFIG,
  STORAGE_KEYS.HUD_SLEEP,
  STORAGE_KEYS.HUD_SLEEP_DELAY,
  STORAGE_KEYS.DOUBLE_TAP_DELAY,
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

  const unsubscribeEvents = bridge.onEvenHubEvent((event: any) => {
    if (disposed) return;

    const sysType = event?.sysEvent?.eventType ?? -1;
    // Background/foreground transitions are lifecycle, not input.
    if (sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      home?.pause();
      return;
    }
    if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      home?.resume();
      return;
    }

    input.handleEvent(event);
  });

  const onBeforeUnload = (): void => dispose();
  window.addEventListener("beforeunload", onBeforeUnload);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("foresight-config-changed", onConfigChanged);
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
