import { describe, it, expect } from "vitest";
import { createSubAppRegistry, canRegister } from "./sub-app-registry";
import { SubApp, SubAppContext } from "./types";

function createMockSubApp(id: string, name?: string): SubApp {
  return {
    id,
    name: name ?? `App ${id}`,
    async activate(_context: SubAppContext): Promise<void> {},
    handleGesture(): void {},
    async cleanup(): Promise<void> {},
  };
}

describe("canRegister", () => {
  it("returns true when count is 0", () => {
    expect(canRegister(0)).toBe(true);
  });

  it("returns true when count is 9", () => {
    expect(canRegister(9)).toBe(true);
  });

  it("returns false when count is 10", () => {
    expect(canRegister(10)).toBe(false);
  });

  it("returns false when count is above 10", () => {
    expect(canRegister(11)).toBe(false);
  });
});

describe("createSubAppRegistry", () => {
  describe("register", () => {
    it("registers a sub-app and returns true", () => {
      const registry = createSubAppRegistry();
      const app = createMockSubApp("app-1");

      expect(registry.register(app)).toBe(true);
      expect(registry.count).toBe(1);
    });

    it("registers up to 10 sub-apps", () => {
      const registry = createSubAppRegistry();

      for (let i = 0; i < 10; i++) {
        const result = registry.register(createMockSubApp(`app-${i}`));
        expect(result).toBe(true);
      }

      expect(registry.count).toBe(10);
    });

    it("rejects registration when 10 apps are already registered", () => {
      const registry = createSubAppRegistry();

      for (let i = 0; i < 10; i++) {
        registry.register(createMockSubApp(`app-${i}`));
      }

      const result = registry.register(createMockSubApp("app-overflow"));
      expect(result).toBe(false);
      expect(registry.count).toBe(10);
    });

    it("rejects duplicate registration by ID", () => {
      const registry = createSubAppRegistry();
      const app = createMockSubApp("app-1");

      expect(registry.register(app)).toBe(true);
      expect(registry.register(app)).toBe(false);
      expect(registry.count).toBe(1);
    });
  });

  describe("unregister", () => {
    it("removes a registered app by ID", () => {
      const registry = createSubAppRegistry();
      const app = createMockSubApp("app-1");

      registry.register(app);
      registry.unregister("app-1");

      expect(registry.count).toBe(0);
      expect(registry.getById("app-1")).toBeNull();
    });

    it("does nothing when ID is not found", () => {
      const registry = createSubAppRegistry();
      registry.register(createMockSubApp("app-1"));

      registry.unregister("nonexistent");
      expect(registry.count).toBe(1);
    });

    it("allows re-registration after unregister", () => {
      const registry = createSubAppRegistry();
      const app = createMockSubApp("app-1");

      registry.register(app);
      registry.unregister("app-1");
      expect(registry.register(app)).toBe(true);
      expect(registry.count).toBe(1);
    });
  });

  describe("getAll", () => {
    it("returns empty array when no apps registered", () => {
      const registry = createSubAppRegistry();
      expect(registry.getAll()).toEqual([]);
    });

    it("returns all registered apps in registration order", () => {
      const registry = createSubAppRegistry();
      const app1 = createMockSubApp("app-1", "First");
      const app2 = createMockSubApp("app-2", "Second");
      const app3 = createMockSubApp("app-3", "Third");

      registry.register(app1);
      registry.register(app2);
      registry.register(app3);

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe("app-1");
      expect(all[1].id).toBe("app-2");
      expect(all[2].id).toBe("app-3");
    });

    it("returns a copy (mutations do not affect internal state)", () => {
      const registry = createSubAppRegistry();
      registry.register(createMockSubApp("app-1"));

      const all = registry.getAll();
      all.pop();

      expect(registry.count).toBe(1);
    });
  });

  describe("getById", () => {
    it("returns the app when found", () => {
      const registry = createSubAppRegistry();
      const app = createMockSubApp("app-1", "Test App");

      registry.register(app);

      const result = registry.getById("app-1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Test App");
    });

    it("returns null when not found", () => {
      const registry = createSubAppRegistry();
      expect(registry.getById("nonexistent")).toBeNull();
    });
  });

  describe("count", () => {
    it("starts at 0", () => {
      const registry = createSubAppRegistry();
      expect(registry.count).toBe(0);
    });

    it("increments on registration", () => {
      const registry = createSubAppRegistry();
      registry.register(createMockSubApp("app-1"));
      expect(registry.count).toBe(1);
    });

    it("decrements on unregistration", () => {
      const registry = createSubAppRegistry();
      registry.register(createMockSubApp("app-1"));
      registry.unregister("app-1");
      expect(registry.count).toBe(0);
    });
  });
});
