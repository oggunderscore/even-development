import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatUsername, getAvatarInitial } from "./profile-header";

/**
 * Feature: foresight-webapp-ui, Property 1: Username display truncation
 *
 * For any username string, the formatted display is at most 20 characters.
 * If the original username exceeds 20 characters, the result is the first
 * 17 characters followed by "...".
 *
 * Validates: Requirements 1.1, 1.2
 */

/**
 * Feature: foresight-webapp-ui, Property 2: Fallback avatar initial derivation
 *
 * For any non-empty username, the fallback avatar initial is the uppercase
 * first character of the username.
 *
 * Validates: Requirements 1.1, 1.2
 */

// --- Property Tests ---

describe("Feature: foresight-webapp-ui, Property 1: Username display truncation", () => {
  it("formatted username is always at most 20 characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (username) => {
        const result = formatUsername(username);
        expect(result.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 100 },
    );
  });

  it("username <= 20 chars is returned unchanged", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (username) => {
        const result = formatUsername(username);
        expect(result).toBe(username);
      }),
      { numRuns: 100 },
    );
  });

  it("username > 20 chars is truncated to first 17 chars + '...'", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 21, maxLength: 200 }), (username) => {
        const result = formatUsername(username);
        expect(result).toBe(username.slice(0, 17) + "...");
        expect(result.length).toBe(20);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Feature: foresight-webapp-ui, Property 2: Fallback avatar initial derivation", () => {
  it("avatar initial is the uppercase first character of the username", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (username) => {
        const result = getAvatarInitial(username);
        expect(result).toBe(username.charAt(0).toUpperCase());
      }),
      { numRuns: 100 },
    );
  });

  it("avatar initial is always a single character", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (username) => {
        const result = getAvatarInitial(username);
        expect(result.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("avatar initial is always uppercase", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (username) => {
        const result = getAvatarInitial(username);
        expect(result).toBe(result.toUpperCase());
      }),
      { numRuns: 100 },
    );
  });
});
