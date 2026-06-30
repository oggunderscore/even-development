import { describe, it, expect, vi } from "vitest";
import { createStorageManager } from "./storage-manager";

function createMockBridge() {
  const store = new Map<string, string | null>();
  return {
    store,
    getLocalStorage: vi.fn(async (key: string) => store.get(key) ?? null),
    setLocalStorage: vi.fn(async (key: string, value: string | null) => {
      if (value === null || value === "") {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return true;
    }),
  };
}

describe("StorageManager", () => {
  describe("get (from cache)", () => {
    it("returns null for non-existent key", () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);

      expect(sm.get("missing-key")).toBeNull();
    });

    it("returns deserialized value after loadKey", async () => {
      const bridge = createMockBridge();
      bridge.store.set("test-key", JSON.stringify({ foo: "bar" }));
      const sm = createStorageManager(bridge);

      await sm.loadKey("test-key");
      expect(sm.get("test-key")).toEqual({ foo: "bar" });
    });

    it("returns null for corrupt JSON data after loadKey", async () => {
      const bridge = createMockBridge();
      bridge.store.set("corrupt-key", "not valid json {{{");
      const sm = createStorageManager(bridge);

      await sm.loadKey("corrupt-key");
      expect(sm.get("corrupt-key")).toBeNull();
    });

    it("returns null when bridge returns null for key", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);

      await sm.loadKey("any-key");
      expect(sm.get("any-key")).toBeNull();
    });

    it("correctly deserializes primitive values", async () => {
      const bridge = createMockBridge();
      bridge.store.set("num", "42");
      bridge.store.set("str", '"hello"');
      bridge.store.set("bool", "true");
      const sm = createStorageManager(bridge);

      await sm.loadKeys(["num", "str", "bool"]);
      expect(sm.get<number>("num")).toBe(42);
      expect(sm.get<string>("str")).toBe("hello");
      expect(sm.get<boolean>("bool")).toBe(true);
    });

    it("correctly deserializes arrays", async () => {
      const bridge = createMockBridge();
      bridge.store.set("arr", JSON.stringify([1, 2, 3]));
      const sm = createStorageManager(bridge);

      await sm.loadKey("arr");
      expect(sm.get<number[]>("arr")).toEqual([1, 2, 3]);
    });
  });

  describe("set", () => {
    it("serializes and stores value via bridge", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);

      await sm.set("my-key", { x: 1, y: "two" });

      expect(bridge.setLocalStorage).toHaveBeenCalledWith(
        "my-key",
        JSON.stringify({ x: 1, y: "two" }),
      );
      expect(bridge.store.get("my-key")).toBe('{"x":1,"y":"two"}');
    });

    it("overwrites existing values", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);

      await sm.set("key", "first");
      await sm.set("key", "second");

      expect(sm.get("key")).toBe("second");
    });

    it("value is immediately available in cache after set", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);

      await sm.set("key", { data: 42 });
      expect(sm.get("key")).toEqual({ data: 42 });
    });
  });

  describe("remove", () => {
    it("removes key from cache and bridge", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);

      await sm.set("key", "value");
      await sm.remove("key");

      expect(bridge.setLocalStorage).toHaveBeenCalledWith("key", "");
      expect(sm.get("key")).toBeNull();
    });
  });

  describe("onChange", () => {
    it("notifies listener when key is set", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);
      const callback = vi.fn();

      sm.onChange("my-key", callback);
      await sm.set("my-key", { hello: "world" });

      expect(callback).toHaveBeenCalledWith({ hello: "world" });
    });

    it("notifies listener with null when key is removed", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);
      const callback = vi.fn();

      await sm.set("my-key", "value");
      sm.onChange("my-key", callback);
      await sm.remove("my-key");

      expect(callback).toHaveBeenCalledWith(null);
    });

    it("does not notify after unsubscribe", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);
      const callback = vi.fn();

      const unsubscribe = sm.onChange("my-key", callback);
      unsubscribe();
      await sm.set("my-key", "new-value");

      expect(callback).not.toHaveBeenCalled();
    });

    it("supports multiple listeners on the same key", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      sm.onChange("key", cb1);
      sm.onChange("key", cb2);
      await sm.set("key", 123);

      expect(cb1).toHaveBeenCalledWith(123);
      expect(cb2).toHaveBeenCalledWith(123);
    });

    it("does not notify listeners for other keys", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);
      const callback = vi.fn();

      sm.onChange("key-a", callback);
      await sm.set("key-b", "value");

      expect(callback).not.toHaveBeenCalled();
    });

    it("unsubscribing one listener does not affect others", async () => {
      const bridge = createMockBridge();
      const sm = createStorageManager(bridge);
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const unsub1 = sm.onChange("key", cb1);
      sm.onChange("key", cb2);

      unsub1();
      await sm.set("key", "value");

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledWith("value");
    });
  });

  describe("loadKey / loadKeys", () => {
    it("hydrates cache from bridge storage", async () => {
      const bridge = createMockBridge();
      bridge.store.set("a", JSON.stringify({ val: 1 }));
      bridge.store.set("b", JSON.stringify("two"));
      const sm = createStorageManager(bridge);

      await sm.loadKeys(["a", "b"]);

      expect(sm.get("a")).toEqual({ val: 1 });
      expect(sm.get("b")).toBe("two");
    });

    it("handles bridge errors gracefully", async () => {
      const bridge = createMockBridge();
      bridge.getLocalStorage.mockRejectedValueOnce(new Error("bridge error"));
      const sm = createStorageManager(bridge);

      await sm.loadKey("error-key");
      expect(sm.get("error-key")).toBeNull();
    });
  });
});
