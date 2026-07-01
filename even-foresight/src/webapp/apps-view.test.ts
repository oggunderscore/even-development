// @vitest-environment jsdom
// Feature: foresight-webapp-ui
// Unit tests for AppsView — sorting, truncation, source labels, mount/unmount, and interactions.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAppsView,
  sortApps,
  truncateDescription,
  getSourceLabel,
} from "./apps-view";
import type { AppEntry } from "./types";

describe("sortApps", () => {
  it("sorts apps alphabetically case-insensitive", () => {
    const apps: AppEntry[] = [
      {
        id: "z",
        name: "Zebra",
        description: "",
        source: "pre-installed",
        hasConfig: false,
      },
      {
        id: "a",
        name: "alpha",
        description: "",
        source: "marketplace",
        hasConfig: true,
      },
      {
        id: "b",
        name: "Beta",
        description: "",
        source: "pre-installed",
        hasConfig: true,
      },
    ];
    const sorted = sortApps(apps);
    expect(sorted.map((a) => a.name)).toEqual(["alpha", "Beta", "Zebra"]);
  });

  it("returns empty array for empty input", () => {
    expect(sortApps([])).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const apps: AppEntry[] = [
      {
        id: "b",
        name: "Bravo",
        description: "",
        source: "pre-installed",
        hasConfig: false,
      },
      {
        id: "a",
        name: "Alpha",
        description: "",
        source: "pre-installed",
        hasConfig: true,
      },
    ];
    const original = [...apps];
    sortApps(apps);
    expect(apps).toEqual(original);
  });
});

describe("truncateDescription", () => {
  it("returns the description unchanged when ≤ 80 chars", () => {
    const desc = "Short description";
    expect(truncateDescription(desc)).toBe(desc);
  });

  it("returns the description unchanged at exactly 80 chars", () => {
    const desc = "a".repeat(80);
    expect(truncateDescription(desc)).toBe(desc);
  });

  it("truncates and appends ellipsis when > 80 chars", () => {
    const desc = "a".repeat(100);
    const result = truncateDescription(desc);
    expect(result.length).toBe(80);
    expect(result.endsWith("...")).toBe(true);
  });

  it("respects custom maxLen parameter", () => {
    const desc = "Hello, World! This is a test.";
    const result = truncateDescription(desc, 10);
    expect(result).toBe("Hello, ...");
    expect(result.length).toBe(10);
  });

  it("handles empty string", () => {
    expect(truncateDescription("")).toBe("");
  });
});

describe("getSourceLabel", () => {
  it("returns 'Pre-installed' for pre-installed source", () => {
    expect(getSourceLabel("pre-installed")).toBe("Pre-installed");
  });

  it("returns 'Marketplace' for marketplace source", () => {
    expect(getSourceLabel("marketplace")).toBe("Marketplace");
  });
});

describe("createAppsView", () => {
  let container: HTMLElement;
  const mockApps: AppEntry[] = [
    {
      id: "weather",
      name: "Weather",
      description: "Weather forecast and current conditions widget",
      source: "pre-installed",
      hasConfig: true,
    },
    {
      id: "clock",
      name: "Clock",
      description: "Digital clock widget for the HUD home page",
      source: "pre-installed",
      hasConfig: true,
    },
    {
      id: "tasks",
      name: "Tasks",
      description: "Task and reminder management for quick reference",
      source: "pre-installed",
      hasConfig: false,
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("mounts the app list into the container", () => {
    const view = createAppsView({
      apps: mockApps,
      onAppSelect: vi.fn(),
      onBrowseMarketplace: vi.fn(),
    });

    view.mount(container);
    expect(container.querySelector(".apps-view-container")).not.toBeNull();
  });

  it("unmounts and removes DOM from container", () => {
    const view = createAppsView({
      apps: mockApps,
      onAppSelect: vi.fn(),
      onBrowseMarketplace: vi.fn(),
    });

    view.mount(container);
    view.unmount();
    expect(container.querySelector(".apps-view-container")).toBeNull();
  });

  it("renders apps sorted alphabetically", () => {
    const view = createAppsView({
      apps: mockApps,
      onAppSelect: vi.fn(),
      onBrowseMarketplace: vi.fn(),
    });

    view.mount(container);
    const items = container.querySelectorAll(".apps-view-item-name");
    expect(items[0].textContent).toBe("Clock");
    expect(items[1].textContent).toBe("Tasks");
    expect(items[2].textContent).toBe("Weather");
  });

  it("displays source labels for each app", () => {
    const view = createAppsView({
      apps: mockApps,
      onAppSelect: vi.fn(),
      onBrowseMarketplace: vi.fn(),
    });

    view.mount(container);
    const sources = container.querySelectorAll(".apps-view-item-source");
    // All are pre-installed in mockApps
    sources.forEach((el) => {
      expect(el.textContent).toBe("Pre-installed");
    });
  });

  it("calls onAppSelect when clicking an app with hasConfig", () => {
    const onAppSelect = vi.fn();
    const view = createAppsView({
      apps: mockApps,
      onAppSelect,
      onBrowseMarketplace: vi.fn(),
    });

    view.mount(container);
    // Clock has hasConfig: true, and is first after sort
    const clockItem = container.querySelector(
      '[data-app-id="clock"]',
    ) as HTMLElement;
    clockItem.click();
    expect(onAppSelect).toHaveBeenCalledWith("clock");
  });

  it("shows 'no config' message when clicking an app without config", () => {
    const onAppSelect = vi.fn();
    const view = createAppsView({
      apps: mockApps,
      onAppSelect,
      onBrowseMarketplace: vi.fn(),
    });

    view.mount(container);
    const tasksItem = container.querySelector(
      '[data-app-id="tasks"]',
    ) as HTMLElement;
    tasksItem.click();
    expect(onAppSelect).not.toHaveBeenCalled();
    const msg = container.querySelector(".apps-view-no-config");
    expect(msg).not.toBeNull();
    expect(msg!.textContent).toContain("No configuration options available");
  });

  it("calls onBrowseMarketplace when Browse Marketplace button is clicked", () => {
    const onBrowseMarketplace = vi.fn();
    const view = createAppsView({
      apps: mockApps,
      onAppSelect: vi.fn(),
      onBrowseMarketplace,
    });

    view.mount(container);
    const btn = container.querySelector(
      ".apps-view-marketplace-btn",
    ) as HTMLElement;
    btn.click();
    expect(onBrowseMarketplace).toHaveBeenCalled();
  });

  it("has correct id and label", () => {
    const view = createAppsView({
      apps: mockApps,
      onAppSelect: vi.fn(),
      onBrowseMarketplace: vi.fn(),
    });

    expect(view.id).toBe("apps");
    expect(view.label).toBe("Apps");
  });
});
