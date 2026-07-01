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
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { createUserStore } from "./user/user-store";
import { createWelcomeScreen, type WelcomeScreen } from "./screens/welcome";
import { createStorageManager } from "./storage/storage-manager";
import { createHudManager } from "./hud/hud-manager";
import {
  STORAGE_KEYS,
  DEFAULT_HUD_LAYOUT,
  type HudLayoutConfig,
} from "./storage/schemas";
import type { HudComponentType, HudManager } from "./hud/types";

// Type for the webapp grid format stored in bridge localStorage
type HudGridPlacement = { widgetId: string; col: number; row: number };

/**
 * Convert the webapp's HudGrid (WidgetPlacement[]) format to the
 * HudLayoutConfig format expected by HudManager.
 */
function hudGridToLayoutConfig(grid: HudGridPlacement[]): HudLayoutConfig {
  const validTypes: Set<string> = new Set(["clock", "weather", "reminders"]);
  const slots: HudLayoutConfig["slots"] = [];

  for (const placement of grid) {
    if (validTypes.has(placement.widgetId)) {
      slots.push({
        row: placement.row as 0 | 1,
        col: placement.col as 0 | 1 | 2 | 3 | 4,
        componentType: placement.widgetId as HudComponentType,
      });
    }
  }

  // If no valid components, return default (all null slots)
  if (slots.length === 0) {
    return DEFAULT_HUD_LAYOUT;
  }

  return { slots };
}

// Webapp UI imports
import { createViewRouter } from "./webapp/view-router";
import { createProfileHeader } from "./webapp/profile-header";
import { createNavigationBar } from "./webapp/navigation-bar";
import { createAppsView } from "./webapp/apps-view";
import { createAssistantConfigForm } from "./webapp/assistant-config-form";
import { createSettingsView } from "./webapp/settings-view";
import { createDebugPanel } from "./webapp/debug-panel";
import { createMarketplaceView } from "./webapp/marketplace-view";
import { createWeatherConfigForm } from "./webapp/weather-config-form";
import { createClockConfigForm } from "./webapp/clock-config-form";
import { createTasksConfigForm } from "./webapp/tasks-config-form";
import { DEFAULT_APPS } from "./webapp/types";
import type { ViewRouter } from "./webapp/view-router";
import type { ProfileHeader } from "./webapp/profile-header";
import type { NavigationBar } from "./webapp/navigation-bar";

function isEvenAppEnvironment(): boolean {
  return typeof (window as any).flutter_inappwebview !== "undefined";
}

// ── Phone Setup UI ────────────────────────────────────────────────────────────

type PhoneView = "login" | "register" | "forgot" | "profile";

function showView(view: PhoneView): void {
  const views = ["login", "register", "forgot", "profile"];
  for (const v of views) {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      el.classList.toggle("active", v === view);
    }
  }
}

async function initPhoneUI(bridge: EvenAppBridge | null): Promise<void> {
  const phoneUI = document.getElementById("phone-ui");
  if (phoneUI) phoneUI.classList.add("active");

  // ── Elements ──
  const loginEmail = document.getElementById("login-email") as HTMLInputElement;
  const loginPassword = document.getElementById(
    "login-password",
  ) as HTMLInputElement;
  const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
  const loginStatus = document.getElementById("login-status") as HTMLElement;
  const forgotLink = document.getElementById("forgot-link") as HTMLElement;
  const registerLink = document.getElementById("register-link") as HTMLElement;

  const registerUsername = document.getElementById(
    "register-username",
  ) as HTMLInputElement;
  const registerEmail = document.getElementById(
    "register-email",
  ) as HTMLInputElement;
  const registerPassword = document.getElementById(
    "register-password",
  ) as HTMLInputElement;
  const registerBtn = document.getElementById(
    "register-btn",
  ) as HTMLButtonElement;
  const registerStatus = document.getElementById(
    "register-status",
  ) as HTMLElement;
  const backToLoginFromRegister = document.getElementById(
    "back-to-login-from-register",
  ) as HTMLElement;

  const forgotEmail = document.getElementById(
    "forgot-email",
  ) as HTMLInputElement;
  const forgotBtn = document.getElementById("forgot-btn") as HTMLButtonElement;
  const forgotStatus = document.getElementById("forgot-status") as HTMLElement;
  const backToLoginFromForgot = document.getElementById(
    "back-to-login-from-forgot",
  ) as HTMLElement;

  const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;

  // Webapp container elements
  const webappContainer = document.getElementById("webapp-container");
  const webappProfileHeader = document.getElementById("webapp-profile-header");
  const webappNavBar = document.getElementById("webapp-nav-bar");
  const webappContent = document.getElementById("webapp-content");

  // Guard against missing elements (test environments)
  if (!loginBtn || !registerBtn || !forgotBtn) return;

  // ── Webapp state ──
  let profileHeader: ProfileHeader | null = null;
  let navigationBar: NavigationBar | null = null;
  let router: ViewRouter | null = null;

  // ── Helper: save profile and sync to glasses ──
  async function saveProfile(username: string, email: string): Promise<void> {
    const profile = {
      username,
      email,
      createdAt: Date.now(),
      onboardingComplete: false,
    };
    const json = JSON.stringify(profile);

    if (bridge) {
      await bridge.setLocalStorage("foresight-user-profile-v1", json);
    }
    localStorage.setItem("foresight-user-profile-v1", json);
  }

  // ── Show webapp (post-auth UI) ──
  function showWebapp(username: string, email: string): void {
    // Guard against double-mount: clean up if already shown
    if (router) {
      hideWebapp();
    }

    // Hide auth views
    const views = ["login", "register", "forgot", "profile"];
    for (const v of views) {
      const el = document.getElementById(`view-${v}`);
      if (el) {
        el.classList.remove("active");
      }
    }

    // Show webapp container
    if (webappContainer) {
      webappContainer.classList.add("active");
    }

    // Create ProfileHeader
    if (webappProfileHeader) {
      profileHeader = createProfileHeader({
        container: webappProfileHeader,
        username,
        email,
        avatarUrl: null,
      });
      profileHeader.render();
    }

    // Create NavigationBar
    if (webappNavBar && webappContent) {
      navigationBar = createNavigationBar();

      // Create ViewRouter
      router = createViewRouter(webappContent);

      // Register all views
      const appsView = createAppsView({
        apps: DEFAULT_APPS,
        onAppSelect: (id: string) => {
          if (id === "assistant") {
            router!.navigate("assistant");
          } else if (id === "weather") {
            router!.navigate("weather-config");
          } else if (id === "clock") {
            router!.navigate("clock-config");
          } else if (id === "tasks") {
            router!.navigate("tasks-config");
          }
        },
        onBrowseMarketplace: () => {
          router!.navigate("marketplace");
        },
      });

      const assistantView = createAssistantConfigForm({
        bridge,
        onBack: () => router!.navigate("apps"),
      });
      const weatherConfigView = createWeatherConfigForm({
        bridge,
        onBack: () => router!.navigate("apps"),
      });
      const clockConfigView = createClockConfigForm({
        bridge,
        onBack: () => router!.navigate("apps"),
      });
      const tasksConfigView = createTasksConfigForm({
        bridge,
        onBack: () => router!.navigate("apps"),
      });
      const settingsView = createSettingsView({ bridge });
      const debugView = createDebugPanel({ bridge });
      const marketplaceView = createMarketplaceView({
        apps: [],
        onBack: () => {
          router!.navigate("apps");
        },
      });

      router.register(appsView);
      router.register(assistantView);
      router.register(weatherConfigView);
      router.register(clockConfigView);
      router.register(tasksConfigView);
      router.register(settingsView);
      router.register(debugView);
      router.register(marketplaceView);

      // Initialize NavigationBar with 4 tabs
      const tabs = [
        { id: "apps", label: "Apps" },
        { id: "assistant", label: "Assistant" },
        { id: "settings", label: "Settings" },
        { id: "debug", label: "Debug" },
      ];

      navigationBar.init(webappNavBar, tabs, (id: string) => {
        router!.navigate(id);
      });

      navigationBar.show();
      navigationBar.setActive("apps");

      // Navigate to apps as default
      router.navigate("apps");
    }
  }

  // ── Hide webapp (on logout) ──
  function hideWebapp(): void {
    // Dispose ProfileHeader and NavigationBar
    if (profileHeader) {
      profileHeader.dispose();
      profileHeader = null;
    }
    if (navigationBar) {
      navigationBar.dispose();
      navigationBar = null;
    }
    router = null;

    // Clear webapp content
    if (webappContent) {
      webappContent.innerHTML = "";
    }

    // Remove active class from webapp container
    if (webappContainer) {
      webappContainer.classList.remove("active");
    }

    // Show login view
    showView("login");
  }

  // ── Navigation ──
  if (forgotLink)
    forgotLink.addEventListener("click", () => showView("forgot"));
  if (registerLink)
    registerLink.addEventListener("click", () => showView("register"));
  if (backToLoginFromRegister)
    backToLoginFromRegister.addEventListener("click", () => showView("login"));
  if (backToLoginFromForgot)
    backToLoginFromForgot.addEventListener("click", () => showView("login"));

  // ── Login ──
  loginBtn.addEventListener("click", async () => {
    const email = loginEmail?.value.trim() || "";
    const password = loginPassword?.value || "";

    if (!email || !password) {
      if (loginStatus) {
        loginStatus.textContent = "Please enter email and password.";
        loginStatus.className = "status error";
      }
      return;
    }

    // Dummy auth: accept any credentials, use "Tester123" as default username
    // TODO: Replace with Firebase Authentication
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in...";

    // Simulate network delay
    await new Promise((r) => setTimeout(r, 600));

    const username = "Tester123";
    await saveProfile(username, email);

    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
    showWebapp(username, email);
  });

  // ── Register ──
  registerBtn.addEventListener("click", async () => {
    const username = registerUsername?.value.trim() || "";
    const email = registerEmail?.value.trim() || "";
    const password = registerPassword?.value || "";

    if (!username || !email || !password) {
      if (registerStatus) {
        registerStatus.textContent = "Please fill in all fields.";
        registerStatus.className = "status error";
      }
      return;
    }

    // Dummy auth: accept any input
    // TODO: Replace with Firebase Authentication
    registerBtn.disabled = true;
    registerBtn.textContent = "Creating account...";

    await new Promise((r) => setTimeout(r, 600));

    await saveProfile(username, email);

    registerBtn.disabled = false;
    registerBtn.textContent = "Create Account";
    showWebapp(username, email);
  });

  // ── Forgot Password ──
  forgotBtn.addEventListener("click", async () => {
    const email = forgotEmail?.value.trim() || "";

    if (!email) {
      if (forgotStatus) {
        forgotStatus.textContent = "Please enter your email.";
        forgotStatus.className = "status error";
      }
      return;
    }

    // Dummy: always succeed
    // TODO: Replace with Firebase Auth password reset
    forgotBtn.disabled = true;
    forgotBtn.textContent = "Sending...";

    await new Promise((r) => setTimeout(r, 600));

    forgotBtn.disabled = false;
    forgotBtn.textContent = "Send Reset Link";
    if (forgotStatus) {
      forgotStatus.textContent = `✓ Reset link sent to ${email}`;
      forgotStatus.className = "status";
    }
  });

  // ── Logout ──
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (bridge) {
        await bridge.setLocalStorage("foresight-user-profile-v1", "");
      }
      localStorage.removeItem("foresight-user-profile-v1");
      hideWebapp();
    });
  }

  // ── Check for existing session ──
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
        showWebapp(profile.username, profile.email || "");
      }
    }
  } catch {
    // No existing profile — stay on login view
  }
}

// ── Glasses Display Logic ─────────────────────────────────────────────────────

type AppState = "welcome" | "home" | "menu";

async function initGlasses(bridge: EvenAppBridge): Promise<void> {
  // ── Loading Screen ──
  // Show app name immediately while async loading happens.
  // This prevents the welcome animation from playing during load.
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 0,
          containerName: "display",
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

  const userStore = createUserStore(bridge);
  await userStore.loadProfile();

  const storage = createStorageManager(bridge);
  await storage.loadKeys([
    STORAGE_KEYS.HUD_LAYOUT,
    STORAGE_KEYS.CLOCK_CONFIG,
    STORAGE_KEYS.WEATHER_CONFIG,
    STORAGE_KEYS.WEATHER_CACHE,
    STORAGE_KEYS.REMINDERS,
    "foresight-weather-location-v1",
  ]);

  // ── Loading complete — clear splash before transitioning ──
  bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 0,
      containerName: "display",
      content: "",
    }),
  );

  let state: AppState = "welcome";
  let welcome: WelcomeScreen | null = null;
  let hudManager: HudManager | null = null;

  function startHome(): void {
    state = "home";
    welcome?.dispose();
    welcome = null;

    // Rebuild with 5 text containers — one per HUD column.
    // Each container is positioned at its pixel X coordinate so that
    // col 0 is at the left edge and col 4 is at the right edge.
    // Grid: 5 columns across 576px display, each 115px wide.
    const containers: InstanceType<typeof TextContainerProperty>[] = [];
    for (let col = 0; col < 5; col++) {
      containers.push(
        new TextContainerProperty({
          containerID: col,
          containerName: `hud-col-${col}`,
          xPosition: col * 115,
          yPosition: 0,
          width: 115,
          height: 96,
          paddingLength: 0,
          borderWidth: 0,
          content: "",
          isEventCapture: col === 0 ? 1 : 0,
        }),
      );
    }

    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 5,
        textObject: containers,
      }),
    );

    // Use HudManager driven by user's webview configuration.
    // If no slots are configured, nothing is displayed on the glasses.
    const layout = hudGridToLayoutConfig(
      storage.get<HudGridPlacement[]>(STORAGE_KEYS.HUD_LAYOUT) || [],
    );
    hudManager = createHudManager(storage);
    hudManager.init(bridge, layout);

    // Listen for layout changes from webview settings (same-page custom event).
    // The webview dispatches "foresight-config-changed" when saving any config.
    window.addEventListener("foresight-config-changed", ((
      event: CustomEvent,
    ) => {
      const { key, value } = event.detail;
      if (key === STORAGE_KEYS.HUD_LAYOUT) {
        const grid = (value as HudGridPlacement[]) || [];
        const newLayout = hudGridToLayoutConfig(grid);
        storage.set(STORAGE_KEYS.HUD_LAYOUT, grid);
        hudManager?.rebuild(newLayout);
      }
    }) as EventListener);
  }

  // ── Input debug log (shows on phone webview) ──
  const INPUT_LOG_MAX = 8;
  const inputLogEl = document.getElementById("input-debug-log");

  function logInput(label: string): void {
    if (!inputLogEl) return;
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    const entry = document.createElement("div");
    entry.textContent = `[${ts}] ${label}`;
    inputLogEl.appendChild(entry);
    // Keep only the last N entries
    while (inputLogEl.children.length > INPUT_LOG_MAX) {
      inputLogEl.removeChild(inputLogEl.firstChild!);
    }
    inputLogEl.scrollTop = inputLogEl.scrollHeight;
  }

  bridge.onEvenHubEvent((event: any) => {
    const sysType = event.sysEvent?.eventType ?? -1;
    const textType = event.textEvent?.eventType ?? -1;

    if (
      sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      hudManager?.dispose();
      welcome?.dispose();
      bridge.shutDownPageContainer();
      return;
    }

    // Log all recognized input events to the phone webview
    if (
      textType === OsEventTypeList.CLICK_EVENT ||
      textType === 0 ||
      event.textEvent?.eventType === undefined
    ) {
      logInput(`TAP (state: ${state})`);
      if (state === "welcome") welcome?.handleTap();
    } else if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      logInput("SWIPE UP");
    } else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      logInput("SWIPE DOWN");
    } else if (
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      sysType === 3
    ) {
      logInput("DOUBLE TAP");
    } else if (sysType >= 0 || textType >= 0) {
      logInput(`EVENT sys=${sysType} text=${textType}`);
    }
  });

  const profile = userStore.getProfile();
  if (userStore.isOnboarded() || (profile && profile.username)) {
    // If profile exists with a username, skip welcome even if onboarding
    // wasn't explicitly completed (e.g. user logged in but never tapped
    // through the greeting on glasses). Mark onboarding done.
    if (!userStore.isOnboarded() && profile) {
      userStore.completeOnboarding();
    }
    startHome();
  } else {
    state = "welcome";
    welcome = createWelcomeScreen(bridge, userStore);
    welcome.onComplete(() => startHome());
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

let _initCalled = false;

async function init(): Promise<void> {
  if (_initCalled) return;
  _initCalled = true;

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
