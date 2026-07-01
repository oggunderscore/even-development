// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createViewRouter } from "./view-router";
import type { ViewRoute } from "./types";

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

describe("ViewRouter", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("getActiveId returns empty string when no view is active", () => {
    const router = createViewRouter(container);
    expect(router.getActiveId()).toBe("");
  });

  it("navigates to a registered route and mounts it", () => {
    const router = createViewRouter(container);
    const route = createMockRoute("apps", "Apps");
    router.register(route);

    router.navigate("apps");

    expect(route.mount).toHaveBeenCalledWith(container);
    expect(router.getActiveId()).toBe("apps");
  });

  it("unmounts the current view when navigating to a new one", () => {
    const router = createViewRouter(container);
    const routeA = createMockRoute("apps");
    const routeB = createMockRoute("settings");
    router.register(routeA);
    router.register(routeB);

    router.navigate("apps");
    router.navigate("settings");

    expect(routeA.unmount).toHaveBeenCalled();
    expect(routeB.mount).toHaveBeenCalledWith(container);
    expect(router.getActiveId()).toBe("settings");
  });

  it("is a no-op when navigating to the already active view", () => {
    const router = createViewRouter(container);
    const route = createMockRoute("apps");
    router.register(route);

    router.navigate("apps");
    route.mount.mockClear();
    route.unmount.mockClear();

    router.navigate("apps");

    expect(route.mount).not.toHaveBeenCalled();
    expect(route.unmount).not.toHaveBeenCalled();
    expect(router.getActiveId()).toBe("apps");
  });

  it("is a no-op when navigating to an unknown route id", () => {
    const router = createViewRouter(container);
    const route = createMockRoute("apps");
    router.register(route);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    router.navigate("apps");
    router.navigate("unknown");

    expect(route.unmount).not.toHaveBeenCalled();
    expect(router.getActiveId()).toBe("apps");
    expect(warnSpy).toHaveBeenCalledWith(
      '[ViewRouter] Unknown route: "unknown"',
    );

    warnSpy.mockRestore();
  });

  it("warns but does not throw when navigating to unknown route with no active view", () => {
    const router = createViewRouter(container);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    router.navigate("nonexistent");

    expect(router.getActiveId()).toBe("");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("supports registering multiple routes", () => {
    const router = createViewRouter(container);
    const routes = ["apps", "assistant", "settings", "debug"].map((id) =>
      createMockRoute(id),
    );
    for (const route of routes) {
      router.register(route);
    }

    router.navigate("debug");
    expect(routes[3].mount).toHaveBeenCalledWith(container);
    expect(router.getActiveId()).toBe("debug");

    router.navigate("assistant");
    expect(routes[3].unmount).toHaveBeenCalled();
    expect(routes[1].mount).toHaveBeenCalledWith(container);
    expect(router.getActiveId()).toBe("assistant");
  });
});
