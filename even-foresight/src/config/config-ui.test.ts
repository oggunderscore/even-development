// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { initConfigUI } from "./config-ui";

/**
 * Creates a mock bridge backed by a Map for localStorage simulation.
 */
function createMockBridge() {
  const store = new Map<string, string | null>();
  return {
    async getLocalStorage(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    setLocalStorage: async (
      key: string,
      value: string | null,
    ): Promise<void> => {
      if (value === null) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
    store,
  };
}

describe("initConfigUI", () => {
  let rootElement: HTMLElement;

  beforeEach(() => {
    rootElement = document.createElement("div");
  });

  it("initializes with a connected bridge", async () => {
    const bridge = createMockBridge();

    const controller = await initConfigUI({ bridge, rootElement });

    expect(controller.connected).toBe(true);
    expect(controller.storage).not.toBeNull();
    expect(controller.gridEditor).toBeDefined();
  });

  it("shows connection error when bridge is null", async () => {
    const controller = await initConfigUI({ bridge: null, rootElement });

    expect(controller.connected).toBe(false);
    expect(controller.storage).toBeNull();

    const errorDiv = rootElement.querySelector(
      "#connection-error",
    ) as HTMLElement;
    expect(errorDiv).not.toBeNull();
    expect(errorDiv.style.display).toBe("block");
    expect(errorDiv.textContent).toContain("Connection unavailable");
  });

  it("mounts the grid editor container in the root element", async () => {
    const bridge = createMockBridge();

    await initConfigUI({ bridge, rootElement });

    const gridContainer = rootElement.querySelector("#hud-grid-editor");
    expect(gridContainer).not.toBeNull();
  });

  it("loads persisted config from bridge storage on init", async () => {
    const bridge = createMockBridge();
    const layout = {
      slots: Array.from({ length: 10 }, (_, i) => ({
        row: Math.floor(i / 5),
        col: i % 5,
        componentType: i === 0 ? "clock" : null,
      })),
    };
    bridge.store.set("foresight-hud-layout-v1", JSON.stringify(layout));

    const controller = await initConfigUI({ bridge, rootElement });
    controller.gridEditor.loadConfig();

    const config = controller.gridEditor.getConfig();
    expect(config.slots[0].componentType).toBe("clock");
  });

  it("retains grid editor functionality when bridge is unavailable (Req 9.8)", async () => {
    const controller = await initConfigUI({ bridge: null, rootElement });

    // User can still interact with grid editor using fallback storage
    controller.gridEditor.setSlot(0, 0, "weather");

    const config = controller.gridEditor.getConfig();
    expect(
      config.slots.find((s) => s.row === 0 && s.col === 0)?.componentType,
    ).toBe("weather");
  });
});
