import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createApproval,
  hashBible,
  parseApproval,
  verifyApproval,
} from "./approval";
import { demoApproval, demoBible } from "./demo";
import type { Bible } from "./schema";
import { parseBible } from "./validate";

function bible(mutate?: (b: Bible) => void): Bible {
  const b = structuredClone(demoBible);
  mutate?.(b);
  return b;
}

describe("canonical JSON", () => {
  it("is independent of object key insertion order", () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("preserves array order (arrays are sequences, not sets)", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("hashBible", () => {
  it("is deterministic across repeated calls", () => {
    expect(hashBible(bible())).toBe(hashBible(bible()));
  });

  it("is a function of value, not key order", () => {
    // Same Bible rebuilt with a different top-level key order.
    const b = bible();
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(b).reverse())),
    ) as Bible;
    expect(hashBible(reordered)).toBe(hashBible(b));
  });

  it("changes when any content changes", () => {
    const original = hashBible(bible());
    const edited = hashBible(
      bible((b) => (b.scenes[0].beats[0].narration += "!")),
    );
    expect(edited).not.toBe(original);
  });
});

describe("approval lifecycle", () => {
  it("createApproval → verifyApproval round-trips", () => {
    const b = bible();
    const approval = createApproval(b, "reviewer", "2026-07-11T12:00:00.000Z");
    expect(() => verifyApproval(b, approval)).not.toThrow();
  });

  it("rejects a Bible edited after approval", () => {
    const edited = bible((b) => (b.title = "Retitled after review"));
    expect(() => verifyApproval(edited, demoApproval)).toThrow(
      /changed since it was approved/,
    );
  });

  it("rejects an approval issued for a different Bible", () => {
    const other = bible((b) => (b.id = "some-other-bible"));
    expect(() => verifyApproval(other, demoApproval)).toThrow(
      /Approval is for Bible/,
    );
  });

  it("parseApproval rejects malformed records with readable errors", () => {
    expect(() => parseApproval({ bibleId: "x" })).toThrow(
      /Invalid Bible approval/,
    );
    expect(() =>
      parseApproval({ ...demoApproval, bibleHash: "not-a-hash" }),
    ).toThrow(/bibleHash/);
    expect(() =>
      parseApproval({ ...demoApproval, extraField: true }),
    ).toThrow(/Invalid Bible approval/);
  });
});

describe("parseBible (M7 validation gate)", () => {
  it("accepts the demo Bible via a JSON round-trip (the real input path)", () => {
    const parsed = parseBible(JSON.parse(JSON.stringify(demoBible)));
    expect(parsed).toEqual(demoBible);
  });

  it("rejects non-Bible input with the failing paths named", () => {
    expect(() => parseBible({ id: "x" })).toThrow(/Invalid Production Bible/);
    expect(() => parseBible({ id: "x" })).toThrow(/scenes/);
  });

  it("rejects unknown keys instead of silently stripping them", () => {
    const withTypo = {
      ...structuredClone(demoBible),
      sceness: [],
    };
    expect(() => parseBible(withTypo)).toThrow(/sceness|unrecognized/i);
  });

  it("rejects a wrong schemaVersion", () => {
    const wrong = { ...structuredClone(demoBible), schemaVersion: "2" };
    expect(() => parseBible(wrong)).toThrow(/schemaVersion/);
  });
});
