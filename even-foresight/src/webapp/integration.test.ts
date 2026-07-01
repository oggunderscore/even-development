// @vitest-environment jsdom
// Feature: foresight-webapp-ui
// Integration tests for view navigation and bridge round-trips.
// Validates: Requirements 2.1, 2.3, 9.4

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createViewRouter } from "./view-router";
import { createNavigationBar } from "./navigation-bar";
import { loadConfig, saveConfig } from "./storage-helpers";
import { createGeneralSettingsForm } from "./general-settings-form";
import type { ViewRoute, NavTab, GeneralSettings } from "./types";
import { STORAGE_KEYS, DEFAULT_GENERAL_SETTINGS } from "./types";

// --- Mock Bridge ---

function createMockBridge(storage: Record<string, string> = {}) {
  return {
    getLocalStorage: vi.fn(async (key: string) => storage[key] ?? ""),
    setLocalStorage: vi.fn(async (key: string, value: string) => {
      storage[key] = value;
      return true;
    }),
  };
}

// --- Mock ViewRoute helper ---

interface MockViewRoute extends ViewRoute {
  mount: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
}

function createMockRoute(id: string, label?: string): MockViewRoute {
  return {
    id,
    label: label ?? id,
    mount: vi.fn(),
    unmount: vi.fn(),
  };
}

// --- Integration Tests ---

describe("Integration: ViewRouter mount/unmount lifecycle", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("registers 2 routes, navigates to first, verifies mount called", () => {
    const router = createViewRouter(container);
    const routeA = createMockRoute("apps", "Apps");
    const routeB = createMockRoute("settings", "Settings");
    router.register(routeA);
    router.register(routeB);

    router.navigate("apps");

    expect(routeA.mount).toHaveBeenCalledTimes(1);
    expect(routeA.mount).toHaveBeenCalledWith(container);
    expect(router.getActiveId()).toBe("apps");
  });

  it("navigates to second route: first unmounts, second mounts", () => {
    const router = createViewRouter(container);
    const routeA = createMockRoute("apps", "Apps");
    const routeB = createMockRoute("settings", "Settings");
    router.register(routeA);
    router.register(routeB);

    router.navigate("apps");
    router.navigate("settings");

    expect(routeA.unmount).toHaveBeenCalledTimes(1);
    expect(routeB.mount).toHaveBeenCalledTimes(1);
    expect(routeB.mount).toHaveBeenCalledWith(container);
    expect(router.getActiveId()).toBe("settings");
  });

  it("navigating to the same route is a no-op", () => {
    const router = createViewRouter(container);
    const routeA = createMockRoute("apps", "Apps");
    router.register(routeA);

    router.navigate("apps");
    routeA.mount.mockClear();
    routeA.unmount.mockClear();

    router.navigate("apps");

    expect(routeA.mount).not.toHaveBeenCalled();
    expect(routeA.unmount).not.toHaveBeenCalled();
    expect(router.getActiveId()).toBe("apps");
  });
});

describe("Integration: Navigation bar → view switching", () => {
  let container: HTMLElement;

  const TABS: NavTab[] = [
    { id: "apps", label: "Apps" },
    { id: "assistant", label: "Assistant" },
    { id: "settings", label: "Settings" },
    { id: "debug", label: "Debug" },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("clicking a tab navigates the ViewRouter to that view", () => {
    const router = createViewRouter(container);
    const routeApps = createMockRoute("apps", "Apps");
    const routeSettings = createMockRoute("settings", "Settings");
    const routeAssistant = createMockRoute("assistant", "Assistant");
    const routeDebug = createMockRoute("debug", "Debug");

    router.register(routeApps);
    router.register(routeSettings);
    router.register(routeAssistant);
    router.register(routeDebug);

    const nav = createNavigationBar();
    nav.init(container, TABS, (id: string) => {
      router.navigate(id);
    });
    nav.show();
    nav.setActive("apps");
    router.navigate("apps");

    // Click the "settings" tab
    const settingsTab = container.querySelector(
      '[data-tab-id="settings"]',
    ) as HTMLElement;
    settingsTab.click();

    expect(router.getActiveId()).toBe("settings");
    expect(routeApps.unmount).toHaveBeenCalled();
    expect(routeSettings.mount).toHaveBeenCalledWith(container);

    nav.dispose();
  });

  it("active state updates correctly when switching tabs", () => {
    const router = createViewRouter(container);
    const routeApps = createMockRoute("apps");
    const routeDebug = createMockRoute("debug");
    router.register(routeApps);
    router.register(routeDebug);

    const nav = createNavigationBar();
    nav.init(container, TABS, (id: string) => {
      router.navigate(id);
    });
    nav.show();
    nav.setActive("apps");
    router.navigate("apps");

    // Click "debug" tab
    const debugTab = container.querySelector(
      '[data-tab-id="debug"]',
    ) as HTMLElement;
    debugTab.click();

    // Check aria-selected states
    const appsTabEl = container.querySelector(
      '[data-tab-id="apps"]',
    ) as HTMLElement;
    const debugTabEl = container.querySelector(
      '[data-tab-id="debug"]',
    ) as HTMLElement;

    expect(debugTabEl.getAttribute("aria-selected")).toBe("true");
    expect(appsTabEl.getAttribute("aria-selected")).toBe("false");
    expect(router.getActiveId()).toBe("debug");

    nav.dispose();
  });
});

describe("Integration: Bridge save/load round-trip", () => {
  it("saveConfig then loadConfig returns the same object", async () => {
    const storage: Record<string, string> = {};
    const bridge = createMockBridge(storage);

    const config: GeneralSettings = {
      clockFormat: "24h",
      temperatureUnit: "celsius",
      notificationDurationSeconds: 10,
    };

    await saveConfig(bridge, STORAGE_KEYS.GENERAL_SETTINGS, config);

    // Verify bridge was called with serialized data
    expect(bridge.setLocalStorage).toHaveBeenCalledWith(
      STORAGE_KEYS.GENERAL_SETTINGS,
      JSON.stringify(config),
    );

    // Load it back from the bridge
    const loaded = await loadConfig<GeneralSettings>(
      bridge,
      STORAGE_KEYS.GENERAL_SETTINGS,
      DEFAULT_GENERAL_SETTINGS,
    );

    expect(loaded).toEqual(config);
  });

  it("round-trip preserves complex nested object", async () => {
    const storage: Record<string, string> = {};
    const bridge = createMockBridge(storage);

    const assistantConfig = {
      sttProvider: "whisper",
      llmProvider: "anthropic" as const,
      conversationMemory: true,
      contextAwareness: false,
      aboutMe: "I am a developer who builds AR experiences",
      objectives: "Ship Foresight v1.0 by end of quarter",
    };

    await saveConfig(bridge, "foresight-assistant-config-v1", assistantConfig);

    const loaded = await loadConfig(
      bridge,
      "foresight-assistant-config-v1",
      null,
    );

    expect(loaded).toEqual(assistantConfig);
  });
});

describe("Integration: Settings page load populates from bridge within 3s", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("GeneralSettingsForm loads saved values from bridge on mount", async () => {
    const savedSettings: GeneralSettings = {
      clockFormat: "24h",
      temperatureUnit: "celsius",
      notificationDurationSeconds: 12,
    };

    const storage: Record<string, string> = {
      [STORAGE_KEYS.GENERAL_SETTINGS]: JSON.stringify(savedSettings),
    };
    const bridge = createMockBridge(storage);

    const form = createGeneralSettingsForm({ bridge });
    form.mount(container);

    // Wait for async loadSettings to complete (microtask)
    await vi.waitFor(
      () => {
        const settings = form.getSettings();
        expect(settings.clockFormat).toBe("24h");
        expect(settings.temperatureUnit).toBe("celsius");
        expect(settings.notificationDurationSeconds).toBe(12);
      },
      { timeout: 3000 },
    );

    // Verify bridge was called to load settings
    expect(bridge.getLocalStorage).toHaveBeenCalledWith(
      STORAGE_KEYS.GENERAL_SETTINGS,
    );

    form.unmount();
  });

  it("GeneralSettingsForm uses defaults when bridge has no saved data", async () => {
    const storage: Record<string, string> = {};
    const bridge = createMockBridge(storage);

    const form = createGeneralSettingsForm({ bridge });
    form.mount(container);

    // Wait for async load to complete
    await vi.waitFor(
      () => {
        const settings = form.getSettings();
        expect(settings.clockFormat).toBe("12h");
        expect(settings.temperatureUnit).toBe("fahrenheit");
        expect(settings.notificationDurationSeconds).toBe(5);
      },
      { timeout: 3000 },
    );

    form.unmount();
  });
});
