// Unit tests for HudDurationControl — the HUD inactivity timer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHudDurationControl } from "./hud-duration-control";
import {
  STORAGE_KEYS,
  HUD_DURATION_MIN_S,
  HUD_DURATION_MAX_S,
} from "./types";

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

/** Finds a mode button by its visible label. */
function modeButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll(".hud-mode-btn")).find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`No mode button labelled "${label}"`);
  return button as HTMLButtonElement;
}

describe("HudDurationControl", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe("Rendering", () => {
    it("renders a number input bounded to the supported range", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      const input = container.querySelector(
        ".hud-duration-input",
      ) as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.type).toBe("number");
      expect(input.min).toBe(String(HUD_DURATION_MIN_S));
      expect(input.max).toBe(String(HUD_DURATION_MAX_S));

      control.unmount();
    });

    it("mode toggle renders 'Never Sleep' and 'Sleep After' buttons", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      const labels = Array.from(
        container.querySelectorAll(".hud-mode-btn"),
      ).map((b) => b.textContent);
      expect(labels).toEqual(["Never Sleep", "Sleep After"]);

      control.unmount();
    });

    it("explanatory text is present", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
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
    it("defaults to never sleeping", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      expect(control.getMode()).toBe("always-on");

      control.unmount();
    });

    it("defaults to a 15 second delay", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      expect(control.getValue()).toBe(15);

      control.unmount();
    });
  });

  describe("Mode toggle", () => {
    it("clicking 'Sleep After' switches to the inactivity timer", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      expect(control.getMode()).toBe("inactivity-timer");

      control.unmount();
    });

    it("clicking 'Never Sleep' switches back", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      modeButton(container, "Sleep After").click();
      modeButton(container, "Never Sleep").click();

      expect(control.getMode()).toBe("always-on");

      control.unmount();
    });

    it("reflects the active mode with aria-pressed", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      expect(
        modeButton(container, "Sleep After").getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        modeButton(container, "Never Sleep").getAttribute("aria-pressed"),
      ).toBe("false");

      control.unmount();
    });

    it("reflects the active mode with the 'active' CSS class the stylesheet targets", () => {
      // Regression test: this previously toggled "hud-mode-btn--active",
      // a class no rule in index.html matched, so the active mode was
      // visually indistinguishable from the inactive one.
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      expect(modeButton(container, "Never Sleep").classList.contains("active")).toBe(
        true,
      );
      expect(
        modeButton(container, "Sleep After").classList.contains("active"),
      ).toBe(false);

      modeButton(container, "Sleep After").click();

      expect(
        modeButton(container, "Sleep After").classList.contains("active"),
      ).toBe(true);
      expect(modeButton(container, "Never Sleep").classList.contains("active")).toBe(
        false,
      );

      control.unmount();
    });

    it("persists mode and delay together", async () => {
      const storage: Record<string, string> = {};
      const bridge = createMockBridge(storage);
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      await vi.waitFor(() => {
        expect(JSON.parse(storage[STORAGE_KEYS.HUD_MODE])).toEqual({
          mode: "inactivity-timer",
        });
        expect(
          JSON.parse(storage[STORAGE_KEYS.HUD_DURATION]).displayDurationSeconds,
        ).toBe(control.getValue());
      });

      control.unmount();
    });
  });

  describe("Duration input behavior", () => {
    it("input is disabled while the HUD never sleeps", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      const input = container.querySelector(
        ".hud-duration-input",
      ) as HTMLInputElement;
      expect(input.disabled).toBe(true);

      modeButton(container, "Sleep After").click();
      expect(input.disabled).toBe(false);

      control.unmount();
    });

    it("typing a value persists it", async () => {
      const storage: Record<string, string> = {};
      const bridge = createMockBridge(storage);
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      const input = container.querySelector(
        ".hud-duration-input",
      ) as HTMLInputElement;
      input.value = "45";
      input.dispatchEvent(new Event("change"));

      expect(control.getValue()).toBe(45);
      await vi.waitFor(() => {
        expect(
          JSON.parse(storage[STORAGE_KEYS.HUD_DURATION]).displayDurationSeconds,
        ).toBe(45);
      });

      control.unmount();
    });

    it("clamps a typed value to the supported range", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      const input = container.querySelector(
        ".hud-duration-input",
      ) as HTMLInputElement;

      input.value = String(HUD_DURATION_MAX_S + 1000);
      input.dispatchEvent(new Event("change"));
      expect(control.getValue()).toBe(HUD_DURATION_MAX_S);

      input.value = "0";
      input.dispatchEvent(new Event("change"));
      expect(control.getValue()).toBe(HUD_DURATION_MIN_S);

      control.unmount();
    });

    it("info label visible when never sleeping, hidden when a timer is set", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);

      const infoLabel = container.querySelector(
        ".hud-duration-info-label",
      ) as HTMLElement;
      expect(infoLabel.style.display).toBe("block");

      modeButton(container, "Sleep After").click();
      expect(infoLabel.style.display).toBe("none");

      control.unmount();
    });
  });

  describe("Loading saved values", () => {
    it("restores a saved inactivity timer", async () => {
      const bridge = createMockBridge({
        [STORAGE_KEYS.HUD_MODE]: JSON.stringify({ mode: "inactivity-timer" }),
        [STORAGE_KEYS.HUD_DURATION]: JSON.stringify({
          displayDurationSeconds: 30,
        }),
      });
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      await vi.waitFor(() => {
        expect(control.getMode()).toBe("inactivity-timer");
        expect(control.getValue()).toBe(30);
      });

      control.unmount();
    });

    it("migrates the legacy 'hidden' mode value", async () => {
      const bridge = createMockBridge({
        [STORAGE_KEYS.HUD_MODE]: JSON.stringify({ mode: "hidden" }),
      });
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      await vi.waitFor(() => {
        expect(control.getMode()).toBe("inactivity-timer");
      });

      control.unmount();
    });

    it("clamps a stored delay outside today's range", async () => {
      const bridge = createMockBridge({
        [STORAGE_KEYS.HUD_DURATION]: JSON.stringify({
          displayDurationSeconds: HUD_DURATION_MAX_S + 500,
        }),
      });
      const control = createHudDurationControl({ bridge });
      control.mount(container);

      await vi.waitFor(() => {
        expect(control.getValue()).toBe(HUD_DURATION_MAX_S);
      });

      control.unmount();
    });
  });

  describe("Error handling", () => {
    it("shows an error when the bridge save fails", async () => {
      const control = createHudDurationControl({
        bridge: createFailingBridge(),
      });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      await vi.waitFor(() => {
        const errorEl = container.querySelector(
          ".hud-duration-error",
        ) as HTMLElement;
        expect(errorEl.style.display).toBe("block");
        expect(errorEl.textContent).toBeTruthy();
      });

      control.unmount();
    });

    it("clears the error once a save succeeds", async () => {
      const storage: Record<string, string> = {};
      const control = createHudDurationControl({
        bridge: createMockBridge(storage),
      });
      control.mount(container);

      modeButton(container, "Sleep After").click();

      await vi.waitFor(() => {
        const errorEl = container.querySelector(
          ".hud-duration-error",
        ) as HTMLElement;
        expect(errorEl.style.display).toBe("none");
      });

      control.unmount();
    });
  });

  describe("unmount", () => {
    it("removes the rendered subtree", () => {
      const control = createHudDurationControl({ bridge: createMockBridge() });
      control.mount(container);
      expect(container.querySelector(".hud-duration-container")).not.toBeNull();

      control.unmount();
      expect(container.querySelector(".hud-duration-container")).toBeNull();
    });
  });
});
