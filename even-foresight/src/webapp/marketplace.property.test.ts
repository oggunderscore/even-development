import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { filterByCategory } from "./marketplace-view";
import type { MarketplaceApp, MarketplaceCategory } from "./types";

// Feature: foresight-webapp-ui, Property 6: Marketplace category filter exclusion

/**
 * Property 6: Marketplace category filter exclusion
 *
 * For any list of MarketplaceApp items and any selected category,
 * every app displayed in the filtered listing SHALL have its `category`
 * field equal to the selected category, and no app matching that category
 * SHALL be omitted.
 *
 * Validates: Requirements 4.3
 */

// --- Arbitraries ---

const arbCategory: fc.Arbitrary<MarketplaceCategory> = fc.constantFrom(
  "productivity",
  "social",
  "health",
  "entertainment",
  "utilities",
);

const arbMarketplaceApp: fc.Arbitrary<MarketplaceApp> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.string({ minLength: 0, maxLength: 200 }),
  category: arbCategory,
  author: fc.string({ minLength: 1, maxLength: 30 }),
});

const arbMarketplaceAppList = fc.array(arbMarketplaceApp, {
  minLength: 0,
  maxLength: 30,
});

// --- Property Tests ---

describe("Feature: foresight-webapp-ui, Property 6: Marketplace category filter exclusion", () => {
  it("every app in filtered result has category equal to selected category", () => {
    fc.assert(
      fc.property(arbMarketplaceAppList, arbCategory, (apps, category) => {
        const filtered = filterByCategory(apps, category);

        for (const app of filtered) {
          expect(app.category).toBe(category);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("no matching app from the original list is omitted from the filtered result", () => {
    fc.assert(
      fc.property(arbMarketplaceAppList, arbCategory, (apps, category) => {
        const filtered = filterByCategory(apps, category);
        const expected = apps.filter((app) => app.category === category);

        // Every app in the original list with matching category appears in result
        for (const app of expected) {
          expect(filtered).toContainEqual(app);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("filtered result length equals count of apps with matching category in original list", () => {
    fc.assert(
      fc.property(arbMarketplaceAppList, arbCategory, (apps, category) => {
        const filtered = filterByCategory(apps, category);
        const expectedCount = apps.filter(
          (app) => app.category === category,
        ).length;

        expect(filtered.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });
});
