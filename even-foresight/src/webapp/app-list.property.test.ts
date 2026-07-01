import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { sortApps, truncateDescription, getSourceLabel } from "./apps-view";
import type { AppEntry } from "./types";

/**
 * Feature: foresight-webapp-ui, Properties 3–5: App List
 *
 * Property 3: App list alphabetical ordering
 * Property 4: App description display truncation
 * Property 5: App source label correctness
 *
 * Validates: Requirements 3.1, 3.2, 3.4
 */

// Generator for AppEntry objects
const appEntryArb: fc.Arbitrary<AppEntry> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.string({ minLength: 0, maxLength: 200 }),
  source: fc.constantFrom("pre-installed" as const, "marketplace" as const),
  hasConfig: fc.boolean(),
});

// Feature: foresight-webapp-ui, Property 3: App list alphabetical ordering
describe("Feature: foresight-webapp-ui, Property 3: App list alphabetical ordering", () => {
  it("for any list of AppEntry items, sortApps returns them in case-insensitive alphabetical order by name", () => {
    fc.assert(
      fc.property(
        fc.array(appEntryArb, { minLength: 0, maxLength: 30 }),
        (apps) => {
          const sorted = sortApps(apps);

          // Length is preserved
          expect(sorted.length).toBe(apps.length);

          // Each consecutive pair is in order
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(
              sorted[i].name
                .toLowerCase()
                .localeCompare(sorted[i + 1].name.toLowerCase()),
            ).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sortApps preserves all original elements (no additions or removals)", () => {
    fc.assert(
      fc.property(
        fc.array(appEntryArb, { minLength: 0, maxLength: 30 }),
        (apps) => {
          const sorted = sortApps(apps);
          const originalIds = apps.map((a) => a.id).sort();
          const sortedIds = sorted.map((a) => a.id).sort();
          expect(sortedIds).toEqual(originalIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: foresight-webapp-ui, Property 4: App description display truncation
describe("Feature: foresight-webapp-ui, Property 4: App description display truncation", () => {
  it("for any string desc, truncateDescription(desc).length <= 80", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (desc) => {
        const result = truncateDescription(desc);
        expect(result.length).toBeLessThanOrEqual(80);
      }),
      { numRuns: 100 },
    );
  });

  it("if desc.length > 80, the result ends with '...'", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 81, maxLength: 300 }), (desc) => {
        const result = truncateDescription(desc);
        expect(result).toMatch(/\.\.\.$/);
      }),
      { numRuns: 100 },
    );
  });

  it("if desc.length <= 80, the result equals the original string", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 80 }), (desc) => {
        const result = truncateDescription(desc);
        expect(result).toBe(desc);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: foresight-webapp-ui, Property 5: App source label correctness
describe("Feature: foresight-webapp-ui, Property 5: App source label correctness", () => {
  it("source 'pre-installed' maps to label 'Pre-installed'", () => {
    const result = getSourceLabel("pre-installed");
    expect(result).toBe("Pre-installed");
  });

  it("source 'marketplace' maps to label 'Marketplace'", () => {
    const result = getSourceLabel("marketplace");
    expect(result).toBe("Marketplace");
  });

  it("for any AppEntry, getSourceLabel returns the correct label matching the source field", () => {
    fc.assert(
      fc.property(appEntryArb, (app) => {
        const label = getSourceLabel(app.source);
        if (app.source === "pre-installed") {
          expect(label).toBe("Pre-installed");
        } else {
          expect(label).toBe("Marketplace");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("getSourceLabel only returns 'Pre-installed' or 'Marketplace'", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("pre-installed" as const, "marketplace" as const),
        (source) => {
          const label = getSourceLabel(source);
          expect(["Pre-installed", "Marketplace"]).toContain(label);
        },
      ),
      { numRuns: 100 },
    );
  });
});
