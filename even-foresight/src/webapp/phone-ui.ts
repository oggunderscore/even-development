/**
 * Phone UI — the DOM half of the app: auth screens plus the post-login
 * webapp shell (profile header, tab bar, view router).
 *
 * Auth is a local stand-in. It accepts any credentials and stores a profile
 * so the glasses side can leave onboarding; there is no server and nothing
 * is verified. Replacing it with a real provider means changing only
 * `authenticate()` below.
 */

import { createProfileHeader, type ProfileHeader } from "./profile-header";
import { createNavigationBar, type NavigationBar } from "./navigation-bar";
import { createViewRouter, type ViewRouter } from "./view-router";
import { createAppsView } from "./apps-view";
import { createAssistantConfigForm } from "./assistant-config-form";
import { createSettingsView } from "./settings-view";
import { createDebugPanel } from "./debug-panel";
import { createMarketplaceView } from "./marketplace-view";
import { createWeatherConfigForm } from "./weather-config-form";
import { createClockConfigForm } from "./clock-config-form";
import { createTasksConfigForm } from "./tasks-config-form";
import { DEFAULT_APPS } from "./types";
import { STORAGE_KEYS } from "../storage/schemas";

type AuthView = "login" | "register" | "forgot";

const AUTH_VIEWS: AuthView[] = ["login", "register", "forgot"];

/** Which app id opens which config route. */
const APP_ROUTES: Record<string, string> = {
  assistant: "assistant",
  weather: "weather-config",
  clock: "clock-config",
  tasks: "tasks-config",
};

interface StoredProfile {
  username: string;
  email: string;
  createdAt: number;
  onboardingComplete: boolean;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showAuthView(view: AuthView): void {
  for (const name of AUTH_VIEWS) {
    el(`view-${name}`)?.classList.toggle("active", name === view);
  }
}

export interface PhoneUI {
  dispose(): void;
}

export function mountPhoneUI(bridge: any | null): PhoneUI {
  el("phone-ui")?.classList.add("active");

  const loginBtn = el<HTMLButtonElement>("login-btn");
  const registerBtn = el<HTMLButtonElement>("register-btn");
  const forgotBtn = el<HTMLButtonElement>("forgot-btn");

  // Nothing to wire in a stripped-down DOM (e.g. unit tests).
  if (!loginBtn || !registerBtn || !forgotBtn) {
    return { dispose: () => {} };
  }

  const webappContainer = el("webapp-container");
  const webappProfileHeader = el("webapp-profile-header");
  const webappNavBar = el("webapp-nav-bar");
  const webappContent = el("webapp-content");

  let profileHeader: ProfileHeader | null = null;
  let navigationBar: NavigationBar | null = null;
  let router: ViewRouter | null = null;

  // ── Profile persistence ─────────────────────────────────────────────────

  async function saveProfile(username: string, email: string): Promise<void> {
    const profile: StoredProfile = {
      username,
      email,
      createdAt: Date.now(),
      onboardingComplete: false,
    };
    const json = JSON.stringify(profile);

    // localStorage first so the profile survives even if the bridge rejects.
    try {
      localStorage.setItem(STORAGE_KEYS.USER_PROFILE, json);
    } catch {
      /* private mode / quota — the bridge write below may still succeed */
    }
    if (bridge) {
      try {
        await bridge.setLocalStorage(STORAGE_KEYS.USER_PROFILE, json);
      } catch (err) {
        console.warn("[Foresight] Could not sync profile to glasses:", err);
      }
    }
  }

  async function clearProfile(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
    } catch {
      /* ignore */
    }
    if (bridge) {
      try {
        await bridge.setLocalStorage(STORAGE_KEYS.USER_PROFILE, "");
      } catch {
        /* ignore */
      }
    }
  }

  async function readProfile(): Promise<StoredProfile | null> {
    let raw: string | null = null;
    if (bridge) {
      try {
        raw = await bridge.getLocalStorage(STORAGE_KEYS.USER_PROFILE);
      } catch {
        /* fall through to localStorage */
      }
    }
    if (!raw) {
      try {
        raw = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
      } catch {
        return null;
      }
    }
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as StoredProfile;
      return parsed?.username ? parsed : null;
    } catch {
      return null;
    }
  }

  // ── Webapp shell ────────────────────────────────────────────────────────

  function showWebapp(username: string, email: string): void {
    if (router) hideWebapp();

    for (const name of AUTH_VIEWS) {
      el(`view-${name}`)?.classList.remove("active");
    }
    webappContainer?.classList.add("active");

    if (webappProfileHeader) {
      profileHeader = createProfileHeader({
        container: webappProfileHeader,
        username,
        email,
        avatarUrl: null,
        onSignOut: () => {
          void handleSignOut();
        },
      });
      profileHeader.render();
    }

    if (!webappNavBar || !webappContent) return;

    navigationBar = createNavigationBar();
    router = createViewRouter(webappContent);
    const navigate = (id: string) => router?.navigate(id);

    router.register(
      createAppsView({
        apps: DEFAULT_APPS,
        onAppSelect: (id: string) => {
          const route = APP_ROUTES[id];
          if (route) navigate(route);
        },
        onBrowseMarketplace: () => navigate("marketplace"),
      }),
    );
    router.register(
      createAssistantConfigForm({ bridge, onBack: () => navigate("apps") }),
    );
    router.register(
      createWeatherConfigForm({ bridge, onBack: () => navigate("apps") }),
    );
    router.register(
      createClockConfigForm({ bridge, onBack: () => navigate("apps") }),
    );
    router.register(
      createTasksConfigForm({ bridge, onBack: () => navigate("apps") }),
    );
    router.register(createSettingsView({ bridge }));
    router.register(createDebugPanel({ bridge }));
    router.register(
      createMarketplaceView({ apps: [], onBack: () => navigate("apps") }),
    );

    navigationBar.init(
      webappNavBar,
      [
        { id: "apps", label: "Apps" },
        { id: "assistant", label: "Assistant" },
        { id: "settings", label: "Settings" },
        { id: "debug", label: "Debug" },
      ],
      (id: string) => navigate(id),
    );
    navigationBar.show();
    navigationBar.setActive("apps");
    router.navigate("apps");
  }

  function hideWebapp(): void {
    profileHeader?.dispose();
    profileHeader = null;
    navigationBar?.dispose();
    navigationBar = null;
    router?.reset();
    router = null;

    if (webappContent) webappContent.replaceChildren();
    webappContainer?.classList.remove("active");
    showAuthView("login");
  }

  async function handleSignOut(): Promise<void> {
    await clearProfile();
    hideWebapp();
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  function setStatus(
    element: HTMLElement | null,
    message: string,
    kind: "success" | "error",
  ): void {
    if (!element) return;
    element.textContent = message;
    element.className = kind === "error" ? "status error" : "status";
  }

  /**
   * Runs `action` with the button disabled and a pending label, then always
   * restores the original label — including on failure, which the previous
   * inline version got wrong by hard-coding a different label back.
   */
  async function withPending<T>(
    button: HTMLButtonElement,
    pendingLabel: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = pendingLabel;
    try {
      return await action();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  /** Local stand-in for a real auth call. */
  async function authenticate(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  el("forgot-link")?.addEventListener("click", () => showAuthView("forgot"));
  el("register-link")?.addEventListener("click", () =>
    showAuthView("register"),
  );
  el("back-to-login-from-register")?.addEventListener("click", () =>
    showAuthView("login"),
  );
  el("back-to-login-from-forgot")?.addEventListener("click", () =>
    showAuthView("login"),
  );

  loginBtn.addEventListener("click", () => {
    const email = el<HTMLInputElement>("login-email")?.value.trim() ?? "";
    const password = el<HTMLInputElement>("login-password")?.value ?? "";
    const status = el("login-status");

    if (!email || !password) {
      setStatus(status, "Please enter email and password.", "error");
      return;
    }

    void withPending(loginBtn, "Signing in...", async () => {
      await authenticate();
      const username = email.split("@")[0] || "User";
      await saveProfile(username, email);
      showWebapp(username, email);
    });
  });

  registerBtn.addEventListener("click", () => {
    const username = el<HTMLInputElement>("register-username")?.value.trim() ?? "";
    const email = el<HTMLInputElement>("register-email")?.value.trim() ?? "";
    const password = el<HTMLInputElement>("register-password")?.value ?? "";
    const status = el("register-status");

    if (!username || !email || !password) {
      setStatus(status, "Please fill in all fields.", "error");
      return;
    }

    void withPending(registerBtn, "Creating account...", async () => {
      await authenticate();
      await saveProfile(username, email);
      showWebapp(username, email);
    });
  });

  forgotBtn.addEventListener("click", () => {
    const email = el<HTMLInputElement>("forgot-email")?.value.trim() ?? "";
    const status = el("forgot-status");

    if (!email) {
      setStatus(status, "Please enter your email.", "error");
      return;
    }

    void withPending(forgotBtn, "Sending...", async () => {
      await authenticate();
      setStatus(status, `Reset link sent to ${email}`, "success");
    });
  });

  // ── Resume an existing session ──────────────────────────────────────────
  void readProfile().then((profile) => {
    if (profile) showWebapp(profile.username, profile.email || "");
  });

  return {
    dispose(): void {
      hideWebapp();
    },
  };
}
