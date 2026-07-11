import { describe, expect, it } from "vitest";
import { createApproval } from "../bible/approval";
import { demoApproval, demoBible } from "../bible/demo";
import { createDefaultRecipeRegistry } from "../recipes";
import { compileBible } from "./compile";
import { compileApprovedBible } from "./gate";

const registry = () => createDefaultRecipeRegistry();

describe("compileApprovedBible (M7 gate)", () => {
  it("compiles an approved Bible to exactly what the pure core produces", () => {
    const gated = compileApprovedBible(
      // JSON round-trip: the gate's real input is parsed JSON, not our
      // in-memory fixture object.
      JSON.parse(JSON.stringify(demoBible)),
      JSON.parse(JSON.stringify(demoApproval)),
      registry(),
    );
    expect(JSON.stringify(gated)).toBe(
      JSON.stringify(compileBible(demoBible, registry())),
    );
  });

  it("refuses a Bible edited after its approval was issued", () => {
    const edited = structuredClone(demoBible);
    edited.scenes[0].beats[0].narration = "Sneaky post-approval edit.";
    expect(() => compileApprovedBible(edited, demoApproval, registry())).toThrow(
      /changed since it was approved/,
    );
  });

  it("refuses an approval that names a different Bible", () => {
    const other = structuredClone(demoBible);
    other.id = "another-bible";
    const otherApproval = createApproval(
      other,
      "reviewer",
      "2026-07-11T12:00:00.000Z",
    );
    expect(() =>
      compileApprovedBible(demoBible, otherApproval, registry()),
    ).toThrow(/Approval is for Bible/);
  });

  it("refuses malformed Bible input before ever looking at the approval", () => {
    expect(() =>
      compileApprovedBible({ nonsense: true }, demoApproval, registry()),
    ).toThrow(/Invalid Production Bible/);
  });

  it("refuses malformed approval input", () => {
    expect(() =>
      compileApprovedBible(demoBible, { approved: "yes" }, registry()),
    ).toThrow(/Invalid Bible approval/);
  });
});
