import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createSubAppRegistry, canRegister } from "./sub-app-registry";
import type { SubApp, SubAppContext } from "./types";
import { MENU_MAX_ENTRIES } from "../constants";

/**
 * Feature: even-hub, Property 15: Sub-App Registry Capacity
 *
 * Validates: Requirements 7.6
 */

// --- Arbitraries ---

// Defined for future use in prefix-based registration tests
// const arbSubApp = (idPrefix: string): fc.Arbitrary<SubApp> =>
//   fc
//     .record({
//       id: fc
//         .string({ minLength: 1, maxLength: 20 })
//         .map((s) => `${idPrefix}-${s}`),
//       name: fc.string({ minLength: 1, maxLength: 20 }),
//     })
//     .map(({ id, name }) => ({
//       id,
//       name,
//       activate: async (_context: SubAppContext) => {},
//       handleGesture: () => {},
//       cleanup: async () => {},
//     }));

/** Generate a SubApp with a guaranteed unique id (for new registration attempts) */
const arbNewSubApp: fc.Arbitrary<SubApp> = fc
  .record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 20 }),
  })
  .map(({ id, name }) => ({
    id,
    name,
    activate: async (_context: SubAppContext) => {},
    handleGesture: () => {},
    cleanup: async () => {},
  }));

// --- Property 15: Sub-App Registry Capacity ---

describe("Feature: even-hub, Property 15: Sub-App Registry Capacity", () => {
  it("canRegister returns false when currentCount is 10 or more", () => {
    fc.assert(
      fc.property(fc.integer({ min: MENU_MAX_ENTRIES, max: 100 }), (count) => {
        expect(canRegister(count)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("canRegister returns true when currentCount is less than 10", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MENU_MAX_ENTRIES - 1 }),
        (count) => {
          expect(canRegister(count)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects registration when registry has exactly 10 entries and preserves existing entries", () => {
    fc.assert(
      fc.property(arbNewSubApp, (newApp) => {
        // Create a registry and fill it to capacity with 10 unique apps
        const registry = createSubAppRegistry();
        const existingApps: SubApp[] = [];

        for (let i = 0; i < MENU_MAX_ENTRIES; i++) {
          const app: SubApp = {
            id: `existing-app-${i}`,
            name: `App ${i}`,
            activate: async () => {},
            handleGesture: () => {},
            cleanup: async () => {},
          };
          const registered = registry.register(app);
          expect(registered).toBe(true);
          existingApps.push(app);
        }

        // Verify registry is at capacity
        expect(registry.count).toBe(MENU_MAX_ENTRIES);

        // Attempt to register a new app — should be rejected
        const result = registry.register(newApp);
        expect(result).toBe(false);

        // Count remains unchanged
        expect(registry.count).toBe(MENU_MAX_ENTRIES);

        // All original entries are preserved
        const allApps = registry.getAll();
        expect(allApps).toHaveLength(MENU_MAX_ENTRIES);
        for (const existing of existingApps) {
          expect(registry.getById(existing.id)).not.toBeNull();
          expect(registry.getById(existing.id)!.id).toBe(existing.id);
          expect(registry.getById(existing.id)!.name).toBe(existing.name);
        }
      }),
      { numRuns: 100 },
    );
  });
});
