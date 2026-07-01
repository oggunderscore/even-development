import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadConfig, saveConfig } from "./storage-helpers";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

function createMockBridge(storage: Record<string, string> = {}) {
  return {
    getLocalStorage: vi.fn(async (key: string) => storage[key] ?? ""),
    setLocalStorage: vi.fn(async (_key: string, _value: string) => true),
  };
}

describe("storage-helpers", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("loadConfig", () => {
    it("returns value from bridge when available", async () => {
      const bridge = createMockBridge({
        "test-key": JSON.stringify({ foo: "bar" }),
      });

      const result = await loadConfig(bridge, "test-key", { foo: "default" });

      expect(result).toEqual({ foo: "bar" });
      expect(bridge.getLocalStorage).toHaveBeenCalledWith("test-key");
    });

    it("falls back to localStorage when bridge is null", async () => {
      localStorageMock.setItem("test-key", JSON.stringify({ x: 42 }));

      const result = await loadConfig(null, "test-key", { x: 0 });

      expect(result).toEqual({ x: 42 });
    });

    it("falls back to localStorage when bridge throws", async () => {
      const bridge = {
        getLocalStorage: vi.fn(async () => {
          throw new Error("Bridge error");
        }),
      };
      localStorageMock.setItem("test-key", JSON.stringify("fallback"));

      const result = await loadConfig(bridge, "test-key", "default");

      expect(result).toBe("fallback");
    });

    it("returns defaultValue when both bridge and localStorage have nothing", async () => {
      const bridge = createMockBridge({});

      const result = await loadConfig(bridge, "missing-key", 99);

      expect(result).toBe(99);
    });

    it("returns defaultValue when bridge returns empty string and localStorage has nothing", async () => {
      const bridge = createMockBridge({ "test-key": "" });

      const result = await loadConfig(bridge, "test-key", "default");

      expect(result).toBe("default");
    });

    it("returns defaultValue when stored value is unparseable JSON", async () => {
      const bridge = createMockBridge({ "test-key": "not-json{{{" });

      const result = await loadConfig(bridge, "test-key", "safe-default");

      // Bridge parse fails, falls through to localStorage
      // localStorage also has nothing, so returns default
      expect(result).toBe("safe-default");
    });

    it("falls back to localStorage when bridge returns unparseable data", async () => {
      const bridge = createMockBridge({ "test-key": "{invalid" });
      localStorageMock.setItem("test-key", JSON.stringify("local-value"));

      const result = await loadConfig(bridge, "test-key", "default");

      expect(result).toBe("local-value");
    });
  });

  describe("saveConfig", () => {
    it("writes to both localStorage and bridge on success", async () => {
      const bridge = createMockBridge();

      const result = await saveConfig(bridge, "my-key", { a: 1 });

      expect(result).toEqual({ success: true });
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "my-key",
        JSON.stringify({ a: 1 }),
      );
      expect(bridge.setLocalStorage).toHaveBeenCalledWith(
        "my-key",
        JSON.stringify({ a: 1 }),
      );
    });

    it("returns error when bridge is null", async () => {
      const result = await saveConfig(null, "my-key", "value");

      expect(result).toEqual({ success: false, error: "Bridge unavailable" });
      // Still writes to localStorage
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "my-key",
        JSON.stringify("value"),
      );
    });

    it("returns error when bridge.setLocalStorage throws", async () => {
      const bridge = {
        setLocalStorage: vi.fn(async () => {
          throw new Error("write failed");
        }),
      };

      const result = await saveConfig(bridge, "my-key", [1, 2, 3]);

      expect(result).toEqual({ success: false, error: "Bridge unavailable" });
      // localStorage still written
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "my-key",
        JSON.stringify([1, 2, 3]),
      );
    });

    it("never throws even if both localStorage and bridge fail", async () => {
      // Make localStorage throw
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error("quota exceeded");
      });
      const bridge = {
        setLocalStorage: vi.fn(async () => {
          throw new Error("offline");
        }),
      };

      const result = await saveConfig(bridge, "key", "val");

      expect(result).toEqual({ success: false, error: "Bridge unavailable" });
    });
  });
});
