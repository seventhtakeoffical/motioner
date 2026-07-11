import { describe, expect, it } from "vitest";
import { demoBible } from "../bible/demo";
import type { Beat, Bible } from "../bible/schema";
import { showcaseBible } from "../bible/showcase";
import { createDefaultRecipeRegistry } from "../recipes";
import { compileBible } from "./compile";

/**
 * M10: stage continuity, observed through the compiled plan. Every test
 * here asserts on the Render Plan — continuity is the compiler's output,
 * not renderer behavior, so this is where it must be visible.
 */

function compile(b: Bible) {
  return compileBible(b, createDefaultRecipeRegistry());
}

/** demoBible extended with extra beats appended to its single scene. */
function multiBeatBible(...extraBeats: Partial<Beat>[]): Bible {
  const b = structuredClone(demoBible);
  b.assets.push({ kind: "text", id: "second", content: "Second" });
  for (const [i, patch] of extraBeats.entries()) {
    b.scenes[0].beats.push({
      id: `beat-extra-${i}`,
      narration: "More.",
      durationInFrames: 60,
      visualIntent: "More.",
      assetId: "second",
      recipeName: "static-fade",
      placement: { x: 0.5, y: 0.7, scale: 1, zIndex: 0 },
      ...patch,
    });
  }
  return b;
}

describe("persistence across beats", () => {
  it("an asset placed in beat 1 appears as a hold layer in beat 2", () => {
    const plan = compile(multiBeatBible({}));
    const [first, second] = plan.beats;

    expect(first.layers.map((l) => [l.entityId, l.role])).toEqual([
      ["headline", "enter"],
    ]);
    expect(second.layers.map((l) => [l.entityId, l.role])).toEqual([
      ["headline", "hold"],
      ["second", "enter"],
    ]);
    // The held layer keeps its original placement and gets the hold recipe.
    const held = second.layers[0];
    expect(held.recipeName).toBe("hold");
    expect(held.placement).toEqual({
      assetId: "headline",
      x: 0.5,
      y: 0.5,
      scale: 1,
      zIndex: 0,
    });
  });

  it("re-featuring an asset moves it: enter layer at the new placement, no duplicate", () => {
    const plan = compile(
      multiBeatBible({
        assetId: "headline",
        placement: { x: 0.2, y: 0.2, scale: 0.5, zIndex: 3 },
      }),
    );
    const second = plan.beats[1];
    expect(second.layers).toHaveLength(1);
    expect(second.layers[0].role).toBe("enter");
    expect(second.layers[0].placement.x).toBe(0.2);
  });
});

describe("exits", () => {
  it("an exited asset gets an exit-fade layer that beat and is gone the next", () => {
    const plan = compile(
      multiBeatBible({ exit: ["headline"] }, { assetId: "headline" }),
    );
    const [, second, third] = plan.beats;

    expect(second.layers.map((l) => [l.entityId, l.role])).toEqual([
      ["headline", "exit"],
      ["second", "enter"],
    ]);
    expect(second.layers[0].recipeName).toBe("exit-fade");

    // Beat 3 re-enters the headline fresh; "second" holds. The exited
    // entity did NOT persist.
    expect(third.layers.map((l) => [l.entityId, l.role])).toEqual([
      ["headline", "enter"],
      ["second", "hold"],
    ]);
  });

  it("strike-and-re-place emits both an exit and an enter layer for the same entity", () => {
    const plan = compile(
      multiBeatBible({
        assetId: "headline",
        exit: ["headline"],
        placement: { x: 0.8, y: 0.8, scale: 1, zIndex: 0 },
      }),
    );
    const second = plan.beats[1];
    expect(second.layers.map((l) => [l.entityId, l.role])).toEqual([
      ["headline", "exit"],
      ["headline", "enter"],
    ]);
    // Exit plays at the OLD placement, entrance at the new one.
    expect(second.layers[0].placement.x).toBe(0.5);
    expect(second.layers[1].placement.x).toBe(0.8);
  });

  it("rejects exiting an asset that is not on stage", () => {
    expect(() => compile(multiBeatBible({ exit: ["second"] }))).toThrow(
      /cannot exit asset "second".*not on stage/,
    );
  });

  it("rejects duplicate ids in one exit list", () => {
    expect(() =>
      compile(multiBeatBible({ exit: ["headline", "headline"] })),
    ).toThrow(/listed in exit more than once/);
  });

  it("rejects a beat too short for the exit transition", () => {
    // Featured recipe is "hold" (min 1 frame) so the exit-duration check
    // is what fires, not the featured recipe's own minimum.
    expect(() =>
      compile(
        multiBeatBible({
          exit: ["headline"],
          durationInFrames: 8,
          recipeName: "hold",
        }),
      ),
    ).toThrow(/exiting assets need at least 12/);
  });
});

describe("camera and theme carry", () => {
  it("camera cuts merge partially and persist until changed again", () => {
    const plan = compile(
      multiBeatBible({ camera: { zoom: 1.5, x: 0.3 } }, {}),
    );
    const [first, second, third] = plan.beats;
    expect(first.camera).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    // Partial merge: y was not restated and carries.
    expect(second.camera).toEqual({ x: 0.3, y: 0.5, zoom: 1.5 });
    // Nothing changed it, so it persists.
    expect(third.camera).toEqual({ x: 0.3, y: 0.5, zoom: 1.5 });
  });

  it("a theme set in one beat is carried by all later beats", () => {
    const newTheme = { backgroundColor: "#f4f1ea", foregroundColor: "#111111" };
    const plan = compile(multiBeatBible({ theme: newTheme }, {}));
    expect(plan.beats[0].theme.backgroundColor).toBe("#111111");
    expect(plan.beats[1].theme).toEqual(newTheme);
    expect(plan.beats[2].theme).toEqual(newTheme);
  });
});

describe("paint order", () => {
  it("sorts layers by zIndex, then entityId — computed by the compiler, not the renderer", () => {
    const b = structuredClone(demoBible);
    b.assets.push(
      { kind: "text", id: "aa-low", content: "low" },
      { kind: "text", id: "zz-low", content: "low too" },
      { kind: "text", id: "mm-high", content: "high" },
    );
    b.scenes[0].beats.push(
      {
        id: "b2",
        narration: "n",
        durationInFrames: 60,
        visualIntent: "v",
        assetId: "mm-high",
        recipeName: "static-fade",
        placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 5 },
      },
      {
        id: "b3",
        narration: "n",
        durationInFrames: 60,
        visualIntent: "v",
        assetId: "zz-low",
        recipeName: "static-fade",
        placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
      },
      {
        id: "b4",
        narration: "n",
        durationInFrames: 60,
        visualIntent: "v",
        assetId: "aa-low",
        recipeName: "static-fade",
        placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
      },
    );
    const last = compile(b).beats[3];
    expect(last.layers.map((l) => l.entityId)).toEqual([
      "aa-low", // z0, id ties broken lexicographically
      "headline", // z0
      "zz-low", // z0
      "mm-high", // z5 on top
    ]);
  });
});

describe("continuity determinism", () => {
  it("the continuity-heavy showcase compiles byte-identically across runs", () => {
    const first = JSON.stringify(compile(structuredClone(showcaseBible)));
    for (let i = 0; i < 10; i++) {
      expect(JSON.stringify(compile(structuredClone(showcaseBible)))).toBe(
        first,
      );
    }
  });
});
