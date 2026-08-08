import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { applyMenuOrder } from "./menu-order";
import type { MenuEntry } from "./types";

function makeEntry(id: string): MenuEntry {
  return {
    id,
    name: id,
    activate: async () => {},
    cleanup: async () => {},
  };
}

const arbIds = fc
  .uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 0, maxLength: 8 });

describe("Feature: foresight-menu-order, applyMenuOrder", () => {
  it("is a permutation of the input entries — same ids, same length, no duplicates", () => {
    fc.assert(
      fc.property(arbIds, arbIds, (entryIds, orderIds) => {
        const entries = entryIds.map(makeEntry);
        const result = applyMenuOrder(entries, orderIds);

        expect(result).toHaveLength(entries.length);
        expect(new Set(result.map((e) => e.id))).toEqual(new Set(entryIds));
      }),
      { numRuns: 100 },
    );
  });

  it("places every entry mentioned in order before every entry not mentioned, in order's sequence", () => {
    fc.assert(
      fc.property(arbIds, arbIds, (entryIds, orderIds) => {
        const entries = entryIds.map(makeEntry);
        const result = applyMenuOrder(entries, orderIds);

        const mentioned = orderIds.filter((id) => entryIds.includes(id));
        const resultIds = result.map((e) => e.id);
        const resultMentionedPrefix = resultIds.slice(0, mentioned.length);
        expect(resultMentionedPrefix).toEqual(mentioned);
      }),
      { numRuns: 100 },
    );
  });

  it("with an empty order, returns entries unchanged", () => {
    fc.assert(
      fc.property(arbIds, (entryIds) => {
        const entries = entryIds.map(makeEntry);
        expect(applyMenuOrder(entries, [])).toEqual(entries);
      }),
      { numRuns: 100 },
    );
  });

  it("ignores order ids that don't match any entry", () => {
    const entries = [makeEntry("a"), makeEntry("b")];
    const result = applyMenuOrder(entries, ["ghost", "b", "a"]);
    expect(result.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("appends unmentioned entries after mentioned ones, preserving their relative order", () => {
    const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")];
    const result = applyMenuOrder(entries, ["c"]);
    expect(result.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});
