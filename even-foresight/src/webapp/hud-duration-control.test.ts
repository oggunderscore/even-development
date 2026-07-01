// @vitest-environment jsdom

// Feature: hud-settings-refinement
// Unit tests for HudDurationControl — dropdown + mode toggle.
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 7.1, 7.3, 7.5

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHudDurationControl } from "./hud-duration-control";
import { STORAGE_KEYS } from "./types";

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

function createFailingBridge() {
  return {
    getLocalStorage: vi.fn(async () => ""),
    setLocalStorage: vi.fn(async () => {
      throw new Error("Bridge unavailable");
    }),
  };
}

describe("HudDurationControl", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("Rendering", () => {
    it("dropdown renders with 5 options: 3, 5, 8, 10, 15 seconds", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const select = container.querySelector(
        ".hud-duration-select",
      ) as HTMLSelectElement;
      expect(select).not.toBeNull();

      const options = select.querySelectorAll("option");
      expect(options.length).toBe(5);

      const values = Array.from(options).map((o) => Number(o.value));
      expect(values).toEqual([3, 5, 8, 10, 15]);

      control.unmount();
    });

    it("mode toggle renders with 'Always On' and 'Hidden' buttons", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const buttons = container.querySelectorAll(".hud-mode-btn");
      expect(buttons.length).toBe(2);

      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toContain("Always On");
      expect(labels).toContain("Hidden");

      control.unmount();
    });

    it("explanatory text is present", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const explanation = container.querySelector(".hud-duration-explanation");
      expect(explanation).not.toBeNull();
      expect(explanation!.textContent).toContain(
        "Controls how long the HUD appears",
      );

      control.unmount();
    });
  });

  describe("Default values", () => {
    it("default mode is 'always-on'", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      expect(control.getMode()).toBe("always-on");

      control.unmount();
    });

    it("default duration is 5 seconds", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      expect(control.getValue()).toBe(5);

      control.unmount();
    });

    it("getValue() returns 5", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      expect(control.getValue()).toBe(5);

      control.unmount();
    });

    it("getMode() returns 'always-on'", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      expect(control.getMode()).toBe("always-on");

      control.unmount();
    });
  });

  describe("Mode toggle", () => {
    it("clicking 'Hidden' sets mode to 'hidden'", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;

      hiddenBtn.click();

      expect(control.getMode()).toBe("hidden");

      control.unmount();
    });

    it("clicking 'Always On' sets mode back to 'always-on'", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      // First switch to hidden
      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;
      hiddenBtn.click();
      expect(control.getMode()).toBe("hidden");

      // Switch back to always-on
      const alwaysOnBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Always On") as HTMLButtonElement;
      alwaysOnBtn.click();

      expect(control.getMode()).toBe("always-on");

      control.unmount();
    });

    it("mode change persists to STORAGE_KEYS.HUD_MODE", async () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;
      hiddenBtn.click();

      // Wait for async persist call
      await vi.waitFor(() => {
        expect(bridge.setLocalStorage).toHaveBeenCalledWith(
          STORAGE_KEYS.HUD_MODE,
          JSON.stringify({ mode: "hidden" }),
        );
      });

      control.unmount();
    });
  });

  describe("Dropdown behavior", () => {
    it("dropdown is disabled when mode is 'always-on'", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const select = container.querySelector(
        ".hud-duration-select",
      ) as HTMLSelectElement;
      expect(select.disabled).toBe(true);

      control.unmount();
    });

    it("dropdown is enabled when mode is 'hidden'", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      // Switch to hidden mode
      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;
      hiddenBtn.click();

      const select = container.querySelector(
        ".hud-duration-select",
      ) as HTMLSelectElement;
      expect(select.disabled).toBe(false);

      control.unmount();
    });

    it("selecting a value persists to STORAGE_KEYS.HUD_DURATION", async () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      // Switch to hidden mode first so dropdown is enabled
      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;
      hiddenBtn.click();

      const select = container.querySelector(
        ".hud-duration-select",
      ) as HTMLSelectElement;
      select.value = "10";
      select.dispatchEvent(new Event("change"));

      await vi.waitFor(() => {
        expect(bridge.setLocalStorage).toHaveBeenCalledWith(
          STORAGE_KEYS.HUD_DURATION,
          JSON.stringify({ displayDurationSeconds: 10 }),
        );
      });

      control.unmount();
    });

    it("info label visible when always-on, hidden when in hidden mode", () => {
      const bridge = createMockBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      const infoLabel = container.querySelector(
        ".hud-duration-info-label",
      ) as HTMLElement;

      // In always-on mode (default), info label is visible
      expect(infoLabel.style.display).toBe("block");

      // Switch to hidden mode
      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;
      hiddenBtn.click();

      // Info label should be hidden
      expect(infoLabel.style.display).toBe("none");

      control.unmount();
    });
  });

  describe("Error handling", () => {
    it("when bridge save fails, error message is displayed", async () => {
      const bridge = createFailingBridge();
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      // Click hidden to trigger a mode persist
      const hiddenBtn = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).find((b) => b.textContent === "Hidden") as HTMLButtonElement;
      hiddenBtn.click();

      // Wait for the async save to fail and error to appear
      await vi.waitFor(() => {
        const errorEl = container.querySelector(
          ".hud-duration-error",
        ) as HTMLElement;
        expect(errorEl.style.display).toBe("block");
        expect(errorEl.textContent).toBeTruthy();
      });

      control.unmount();
    });
  });
});
