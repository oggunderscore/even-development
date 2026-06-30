/**
 * Foresight — Entry Point
 *
 * In the Even app, this page is loaded in a WebView. The HTML UI is shown
 * to the user on their phone. The SDK bridge is available for localStorage
 * sync and (on glasses) for display rendering.
 *
 * On glasses: createStartUpPageContainer renders to the display.
 * On phone: the HTML DOM is what the user sees and interacts with.
 *
 * Both share localStorage via the bridge for profile sync.
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { createUserStore } from "./user/user-store";
import { createWelcomeScreen, type WelcomeScreen } from "./screens/welcome";
import { createHomeScreen, type HomeScreen } from "./screens/home";

function isEvenAppEnvironment(): boolean {
  return typeof (window as any).flutter_inappwebview !== "undefined";
}

// ── Phone Setup UI ────────────────────────────────────────────────────────────

async function initPhoneUI(bridge: EvenAppBridge | null): Promise<void> {
  const phoneUI = document.getElementById("phone-ui");
  if (phoneUI) phoneUI.classList.add("active");

  const input = document.getElementById("username-input") as HTMLInputElement;
  const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
  const statusMsg = document.getElementById("status-msg") as HTMLElement;

  if (!input || !saveBtn || !statusMsg) return;

  input.addEventListener("input", () => {
    saveBtn.disabled = input.value.trim().length === 0;
  });

  saveBtn.addEventListener("click", async () => {
    const username = input.value.trim();
    if (!username) return;

    const profile = {
      username,
      createdAt: Date.now(),
      onboardingComplete: false,
    };
    const json = JSON.stringify(profile);

    // Save via bridge if available (syncs to glasses)
    if (bridge) {
      await bridge.setLocalStorage("foresight-user-profile-v1", json);
    }
    // Also save to window localStorage as fallback
    localStorage.setItem("foresight-user-profile-v1", json);

    statusMsg.textContent = `✓ Welcome, ${username}! Open the app on your glasses.`;
    statusMsg.className = "status";
    saveBtn.textContent = "Saved ✓";
    saveBtn.disabled = true;
  });

  // Load existing profile
  try {
    let existing: string | null = null;
    if (bridge) {
      existing = await bridge.getLocalStorage("foresight-user-profile-v1");
    }
    if (!existing) {
      existing = localStorage.getItem("foresight-user-profile-v1");
    }
    if (existing) {
      const profile = JSON.parse(existing);
      if (profile.username) {
        input.value = profile.username;
        saveBtn.disabled = false;
        statusMsg.textContent = `Logged in as ${profile.username}`;
      }
    }
  } catch {
    // No existing profile
  }
}

// ── Glasses Display Logic ─────────────────────────────────────────────────────

type AppState = "welcome" | "home" | "menu";

async function initGlasses(bridge: EvenAppBridge): Promise<void> {
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 0,
          containerName: "display",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          content: "Foresight",
          isEventCapture: 1,
        }),
      ],
    }),
  );

  const userStore = createUserStore(bridge);
  await userStore.loadProfile();

  let state: AppState = "welcome";
  let welcome: WelcomeScreen | null = null;
  let homeScreen: HomeScreen | null = null;

  function startHome(): void {
    state = "home";
    welcome?.dispose();
    welcome = null;
    const username = userStore.getProfile()?.username || "User";
    homeScreen = createHomeScreen(bridge, username, () => {
      state = "menu";
      bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 0,
          containerName: "display",
          content:
            "[ Menu ]\n\nNo apps installed yet.\n\n[ double-tap → back ]",
        }),
      );
    });
    homeScreen.startRefresh();
  }

  bridge.onEvenHubEvent((event: any) => {
    const sysType = event.sysEvent?.eventType ?? -1;
    const textType = event.textEvent?.eventType ?? 0;

    if (
      sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      homeScreen?.stopRefresh();
      welcome?.dispose();
      bridge.shutDownPageContainer();
      return;
    }

    if (textType === OsEventTypeList.CLICK_EVENT) {
      if (state === "welcome") welcome?.handleTap();
      else if (state === "home") homeScreen?.handleTap();
    }

    if (textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (state === "home") homeScreen?.handleDoubleTap();
      else if (state === "menu") startHome();
    }
  });

  if (userStore.isOnboarded()) {
    startHome();
  } else {
    state = "welcome";
    welcome = createWelcomeScreen(bridge, userStore);
    welcome.onComplete(() => startHome());
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  if (!isEvenAppEnvironment()) {
    // Regular browser (not Even app) — show phone UI without bridge
    initPhoneUI(null);
    return;
  }

  // Even app environment — get the bridge
  const bridge = await waitForEvenAppBridge();

  // Always show the phone UI (the user sees this on their phone screen)
  await initPhoneUI(bridge);

  // Also try to init glasses display (works when running on glasses,
  // silently does nothing meaningful when on phone since the phone
  // doesn't have a 576x288 greyscale display)
  try {
    await initGlasses(bridge);
  } catch (err) {
    // Expected to fail or be ignored on phone — that's fine
    console.log("[Foresight] Glasses init skipped (phone context):", err);
  }
}

init();
