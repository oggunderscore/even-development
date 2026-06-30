// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GridEditor } from "./grid-editor";
import { STORAGE_KEYS, DEFAULT_HUD_LAYOUT } from "../storage/schemas";
import type { StorageManager } from "../storage/storage-manager";
import type { HudLayoutConfig } from "../storage/schemas";

/**
 * Creates a mock StorageManager backed by a simple Map.
 */
function createMockStorage(
  initialData?: Record<string, unknown>,
): StorageManager & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(
    initialData ? Object.entries(initialData) : [],
  );
  return {
    data,
    get<T>(key: string): T | null {
      const value = data.get(key);
      return value !== undefined ? (value as T) : null;
    },
    set: vi.fn(async <T>(key: string, value: T): Promise<void> => {
      data.set(key, value);
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      data.delete(key);
    }),
    onChange: vi.fn(
      (_key: string, _callback: (value: unknown) => void): (() => void) => {
        return () => {};
      },
    ),
    loadKey: vi.fn(async (_key: string): Promise<void> => {}),
    loadKeys: vi.fn(async (_keys: string[]): Promise<void> => {}),
  };
}

/**
 * Creates a minimal DOM container for testing.
 */
function createContainer(): HTMLElement {
  const el = document.createElement("div");
  return el;
}

describe("GridEditor", () => {
  let editor: GridEditor;
  let container: HTMLElement;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    editor = new GridEditor();
    container = createContainer();
    storage = createMockStorage();
  });

  describe("init", () => {
    it("renders a 2x5 grid into the container", () => {
      editor.init(container, storage);

      const grid = container.querySelector('[role="grid"]');
      expect(grid).not.toBeNull();

      const cells = container.querySelectorAll('[role="gridcell"]');
      expect(cells.length).toBe(10); // 2 rows × 5 cols
    });

    it("renders all slots as Empty by default", () => {
      editor.init(container, storage);

      const cells = container.querySelectorAll('[role="gridcell"]');
      cells.forEach((cell) => {
        expect(cell.textContent).toBe("Empty");
      });
    });
  });

  describe("loadConfig", () => {
    it("loads stored config and renders component names", () => {
      const storedConfig: HudLayoutConfig = {
        slots: DEFAULT_HUD_LAYOUT.slots.map((s) => ({ ...s })),
      };
      storedConfig.slots[0].componentType = "clock";
      storedConfig.slots[3].componentType = "weather";
      storedConfig.slots[7].componentType = "reminders";

      storage.data.set(STORAGE_KEYS.HUD_LAYOUT, storedConfig);

      editor.init(container, storage);
      editor.loadConfig();

      const cells = container.querySelectorAll('[role="gridcell"]');
      expect(cells[0].textContent).toBe("Clock");
      expect(cells[3].textContent).toBe("Weather");
      expect(cells[7].textContent).toBe("Reminders");
      expect(cells[1].textContent).toBe("Empty");
    });

    it("falls back to default layout when storage has no config", () => {
      editor.init(container, storage);
      editor.loadConfig();

      const config = editor.getConfig();
      expect(config.slots.length).toBe(10);
      config.slots.forEach((slot) => {
        expect(slot.componentType).toBeNull();
      });
    });

    it("falls back to default layout when stored data is malformed", () => {
      storage.data.set(STORAGE_KEYS.HUD_LAYOUT, { slots: "not-an-array" });

      editor.init(container, storage);
      editor.loadConfig();

      const config = editor.getConfig();
      expect(config.slots.length).toBe(10);
      config.slots.forEach((slot) => {
        expect(slot.componentType).toBeNull();
      });
    });
  });

  describe("setSlot", () => {
    it("assigns a component type to a specific slot", () => {
      editor.init(container, storage);

      editor.setSlot(0, 2, "clock");

      const config = editor.getConfig();
      const slot = config.slots.find((s) => s.row === 0 && s.col === 2);
      expect(slot?.componentType).toBe("clock");
    });

    it("clears a slot when componentType is null", () => {
      editor.init(container, storage);

      editor.setSlot(1, 3, "weather");
      editor.setSlot(1, 3, null);

      const config = editor.getConfig();
      const slot = config.slots.find((s) => s.row === 1 && s.col === 3);
      expect(slot?.componentType).toBeNull();
    });

    it("allows the same component type in multiple slots (Req 9.9)", () => {
      editor.init(container, storage);

      editor.setSlot(0, 0, "clock");
      editor.setSlot(0, 1, "clock");
      editor.setSlot(1, 4, "clock");

      const config = editor.getConfig();
      const clockSlots = config.slots.filter(
        (s) => s.componentType === "clock",
      );
      expect(clockSlots.length).toBe(3);
    });

    it("updates the DOM rendering after setSlot", () => {
      editor.init(container, storage);

      editor.setSlot(0, 0, "weather");

      const cells = container.querySelectorAll('[role="gridcell"]');
      expect(cells[0].textContent).toBe("Weather");
    });
  });

  describe("getConfig", () => {
    it("returns a deep copy (mutations do not affect internal state)", () => {
      editor.init(container, storage);
      editor.setSlot(0, 0, "clock");

      const config = editor.getConfig();
      config.slots[0].componentType = "weather";

      const config2 = editor.getConfig();
      expect(config2.slots[0].componentType).toBe("clock");
    });

    it("returns all 10 slots with correct row/col positions", () => {
      editor.init(container, storage);

      const config = editor.getConfig();
      expect(config.slots.length).toBe(10);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 5; col++) {
          const slot = config.slots.find((s) => s.row === row && s.col === col);
          expect(slot).toBeDefined();
        }
      }
    });
  });

  describe("save", () => {
    it("persists the current config to storage", async () => {
      editor.init(container, storage);
      editor.setSlot(0, 0, "clock");
      editor.setSlot(1, 2, "reminders");

      await editor.save();

      expect(storage.set).toHaveBeenCalledWith(
        STORAGE_KEYS.HUD_LAYOUT,
        expect.objectContaining({
          slots: expect.arrayContaining([
            expect.objectContaining({
              row: 0,
              col: 0,
              componentType: "clock",
            }),
            expect.objectContaining({
              row: 1,
              col: 2,
              componentType: "reminders",
            }),
          ]),
        }),
      );
    });

    it("throws if storage is not initialized", async () => {
      // Editor created but init not called
      const rawEditor = new GridEditor();
      await expect(rawEditor.save()).rejects.toThrow("Storage not initialized");
    });
  });
});
