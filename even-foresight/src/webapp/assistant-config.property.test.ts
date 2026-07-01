// Feature: foresight-webapp-ui, Property 7: Assistant text field length validation
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateTextField } from "./assistant-config-form";

/**
 * Feature: foresight-webapp-ui, Property 7: Assistant text field length validation
 *
 * For any string input to the "About Me" or "Objectives/Goals" fields,
 * the validation function SHALL accept strings with length in [1, 500]
 * and reject strings with length 0 or > 500.
 *
 * Validates: Requirements 5.3, 5.7
 */

describe("Feature: foresight-webapp-ui, Property 7: Assistant text field length validation", () => {
  it("accepts strings with length in [1, 500]", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (text) => {
        expect(validateTextField(text)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects empty string (length 0)", () => {
    expect(validateTextField("")).toBe(false);
  });

  it("rejects strings with length > 500", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 501, maxLength: 1000 }), (text) => {
        expect(validateTextField(text)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
