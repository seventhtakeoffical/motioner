import { describe, expect, it } from "vitest";
import { createApproval } from "../bible/approval";
import { demoApproval, demoBible } from "../bible/demo";
import { showcaseApproval, showcaseBible } from "../bible/showcase";
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

  it("compiles the continuity showcase end-to-end through the gate", () => {
    const plan = compileApprovedBible(
      JSON.parse(JSON.stringify(showcaseBible)),
      JSON.parse(JSON.stringify(showcaseApproval)),
      registry(),
    );
    expect(plan.beats).toHaveLength(5);
    expect(plan.totalDurationInFrames).toBe(75 + 90 + 60 + 45 + 90);

    // The stage accumulates, clears with exits, and closes on one entity.
    expect(plan.beats.map((b) => b.layers.length)).toEqual([1, 2, 3, 4, 2]);

    // Beat 3: caption enters above the held headline and chart.
    expect(plan.beats[2].layers.map((l) => [l.entityId, l.role])).toEqual([
      ["adoption-chart", "hold"],
      ["headline", "hold"],
      ["tagline", "enter"],
    ]);

    // Beat 4 opens scene 2: the boundary strikes the composed trio (M11's
    // auto-strike — the Bible has no exit directives at all) under a
    // camera push-in; beat 5 opens scene 3, striking the bolt and
    // resetting the camera.
    expect(
      plan.beats[3].layers.filter((l) => l.role === "exit"),
    ).toHaveLength(3);
    expect(plan.beats[3].camera.zoom).toBe(1.25);
    expect(plan.beats[4].camera.zoom).toBe(1);
    expect(plan.beats[4].layers.map((l) => [l.entityId, l.role])).toEqual([
      ["bolt", "exit"],
      ["mountains", "enter"],
    ]);

    // Video-level artifacts: scene map with absolute timing, and the
    // preload manifest naming the one external media source.
    expect(plan.scenes.map((s) => [s.id, s.startFrame, s.durationInFrames])).toEqual([
      ["scene-data-story", 0, 225],
      ["scene-punctuation", 225, 45],
      ["scene-closing", 270, 90],
    ]);
    expect(plan.manifest).toEqual([
      { kind: "image", src: "sample-image.svg" },
    ]);
  });

  it("refuses malformed approval input", () => {
    expect(() =>
      compileApprovedBible(demoBible, { approved: "yes" }, registry()),
    ).toThrow(/Invalid Bible approval/);
  });
});
