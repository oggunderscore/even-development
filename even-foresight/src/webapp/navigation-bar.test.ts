// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createNavigationBar } from "./navigation-bar";
import type { NavTab } from "./types";

const TABS: NavTab[] = [
  { id: "apps", label: "Apps" },
  { id: "assistant", label: "Assistant" },
  { id: "settings", label: "Settings" },
  { id: "debug", label: "Debug" },
];

describe("NavigationBar", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("renders all 4 tabs with correct labels", () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});

    const buttons = container.querySelectorAll(".nav-bar-tab");
    expect(buttons.length).toBe(4);
    expect(buttons[0].textContent).toBe("Apps");
    expect(buttons[1].textContent).toBe("Assistant");
    expect(buttons[2].textContent).toBe("Settings");
    expect(buttons[3].textContent).toBe("Debug");

    nav.dispose();
  });

  it('active tab has correct aria-selected="true"', () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});
    nav.setActive("assistant");

    const buttons = container.querySelectorAll(".nav-bar-tab");
    expect(buttons[1].getAttribute("aria-selected")).toBe("true");
    expect(buttons[0].getAttribute("aria-selected")).toBe("false");
    expect(buttons[2].getAttribute("aria-selected")).toBe("false");
    expect(buttons[3].getAttribute("aria-selected")).toBe("false");

    nav.dispose();
  });

  it("clicking a tab calls onTabChange callback with the tab id", () => {
    const onTabChange = vi.fn();
    const nav = createNavigationBar();
    nav.init(container, TABS, onTabChange);
    nav.setActive("apps");

    const settingsTab = container.querySelector(
      '[data-tab-id="settings"]',
    ) as HTMLElement;
    settingsTab.click();

    expect(onTabChange).toHaveBeenCalledWith("settings");

    nav.dispose();
  });

  it("clicking the already-active tab does not call onTabChange", () => {
    const onTabChange = vi.fn();
    const nav = createNavigationBar();
    nav.init(container, TABS, onTabChange);
    nav.setActive("apps");

    const appsTab = container.querySelector(
      '[data-tab-id="apps"]',
    ) as HTMLElement;
    appsTab.click();

    expect(onTabChange).not.toHaveBeenCalled();

    nav.dispose();
  });

  it("setActive updates styling (aria-selected)", () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});

    nav.setActive("debug");

    const debugTab = container.querySelector(
      '[data-tab-id="debug"]',
    ) as HTMLElement;
    expect(debugTab.getAttribute("aria-selected")).toBe("true");

    nav.setActive("apps");

    expect(debugTab.getAttribute("aria-selected")).toBe("false");
    const appsTab = container.querySelector(
      '[data-tab-id="apps"]',
    ) as HTMLElement;
    expect(appsTab.getAttribute("aria-selected")).toBe("true");

    nav.dispose();
  });

  it("hide() sets display to none", () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});
    nav.show(); // ensure visible first

    nav.hide();

    const navEl = container.querySelector(".nav-bar") as HTMLElement;
    expect(navEl.style.display).toBe("none");

    nav.dispose();
  });

  it("show() sets display to flex", () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});

    nav.show();

    const navEl = container.querySelector(".nav-bar") as HTMLElement;
    expect(navEl.style.display).toBe("flex");

    nav.dispose();
  });

  it("initially hidden (display none) before show() is called", () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});

    const navEl = container.querySelector(".nav-bar") as HTMLElement;
    expect(navEl.style.display).toBe("none");

    nav.dispose();
  });

  it("dispose() removes the nav element from DOM", () => {
    const nav = createNavigationBar();
    nav.init(container, TABS, () => {});

    expect(container.querySelector(".nav-bar")).not.toBeNull();

    nav.dispose();

    expect(container.querySelector(".nav-bar")).toBeNull();
  });
});
