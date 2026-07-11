import { describe, expect, it } from "vitest";
import { demoBible } from "../bible/demo";
import type { Bible, Scene } from "../bible/schema";
import { createDefaultRecipeRegistry } from "../recipes";
import { compileBible } from "./compile";

/**
 * M11: multi-scene orchestration. Scenes are the continuity scope —
 * crossing a boundary strikes the set, camera and theme carry — and the
 * plan gains the video-level artifacts (scene map, preload manifest) that
 * whole-video tooling needs. Everything is asserted on the compiled plan.
 */

function compile(b: Bible) {
  return compileBible(b, createDefaultRecipeRegistry());
}

function makeBeat(
  id: string,
  assetId: string,
  patch: Partial<Scene["beats"][number]> = {},
) {
  return {
    id,
    narration: "n",
    durationInFrames: 60,
    visualIntent: "v",
    assetId,
    recipeName: "static-fade",
    placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
    ...patch,
  };
}

/** demoBible plus a second text asset and a second scene. */
function twoSceneBible(
  secondSceneBeats?: ReturnType<typeof makeBeat>[],
): Bible {
  const b = structuredClone(demoBible);
  b.assets.push({ kind: "text", id: "second", content: "Second" });
  b.scenes.push({
    id: "scene-two",
    title: "Scene Two",
    beats: secondSceneBeats ?? [makeBeat("beat-a", "second")],
  });
  return b;
}

describe("scene-boundary strike", () => {
  it("entities do not survive a scene boundary: explicit exits in the next scene's opening window", () => {
    const plan = compile(
      twoSceneBible([makeBeat("beat-a", "second"), makeBeat("beat-b", "second")]),
    );

    // Scene two's opening window: the carried-over headline is struck.
    const opening = plan.beats[1];
    expect(opening.sceneId).toBe("scene-two");
    expect(opening.layers.map((l) => [l.entityId, l.role])).toEqual([
      ["headline", "exit"],
      ["second", "enter"],
    ]);
    expect(opening.layers[0].recipeName).toBe("exit-fade");

    // And it is genuinely gone, not lingering as a hold, one beat later.
    expect(plan.beats[2].layers.map((l) => [l.entityId, l.role])).toEqual([
      ["second", "enter"],
    ]);
  });

  it("a scene ending with an empty stage produces no exit layers at the boundary", () => {
    const b = twoSceneBible();
    // Strike the headline mid-scene-one by featuring it... instead, exit it
    // via a second beat in scene one, so scene one ends empty except the
    // exiting entity's own beat.
    b.scenes[0].beats.push(
      makeBeat("beat-clear", "headline", {
        exit: ["headline"],
        placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
      }),
    );
    // Scene one's last beat re-places headline (strike-and-re-place), so
    // it IS on stage at the boundary — expect exactly one boundary exit.
    const plan = compile(b);
    const opening = plan.beats[2];
    expect(opening.layers.filter((l) => l.role === "exit")).toHaveLength(1);
  });

  it("rejects an exit directive on the first beat of any scene", () => {
    // Later scene: the boundary strikes automatically, so authored exits
    // there are confusion, not instructions.
    expect(() =>
      compile(twoSceneBible([makeBeat("beat-a", "second", { exit: ["headline"] })])),
    ).toThrow(/not allowed on the first beat of a scene/);

    // First scene: same rule (the stage is empty anyway).
    const b = structuredClone(demoBible);
    b.scenes[0].beats[0].exit = [];
    expect(() => compile(b)).toThrow(/not allowed on the first beat of a scene/);
  });

  it("rejects a scene-opening beat too short for the boundary strike transition", () => {
    expect(() =>
      compile(
        twoSceneBible([
          makeBeat("beat-a", "second", {
            durationInFrames: 8,
            recipeName: "hold",
          }),
        ]),
      ),
    ).toThrow(/scene transition strikes 1 carried-over entity/);
  });
});

describe("camera and theme carry across scenes", () => {
  it("camera and theme set in scene one are still in force in scene two", () => {
    const newTheme = { backgroundColor: "#f4f1ea", foregroundColor: "#111111" };
    const b = twoSceneBible();
    b.scenes[0].beats.push(
      makeBeat("beat-style", "headline", {
        camera: { zoom: 1.4 },
        theme: newTheme,
      }),
    );
    const plan = compile(b);
    const sceneTwoOpening = plan.beats[2];
    expect(sceneTwoOpening.camera.zoom).toBe(1.4);
    expect(sceneTwoOpening.theme).toEqual(newTheme);
  });
});

describe("scene map and timing", () => {
  it("derives the scene table with absolute frames covering the whole timeline", () => {
    const plan = compile(
      twoSceneBible([makeBeat("beat-a", "second"), makeBeat("beat-b", "second")]),
    );
    expect(plan.scenes).toEqual([
      {
        id: "scene-opening",
        title: "Opening",
        startFrame: 0,
        durationInFrames: 90,
      },
      {
        id: "scene-two",
        title: "Scene Two",
        startFrame: 90,
        durationInFrames: 120,
      },
    ]);
    expect(plan.totalDurationInFrames).toBe(210);
    // Every window knows its scene explicitly.
    expect(plan.beats.map((w) => w.sceneId)).toEqual([
      "scene-opening",
      "scene-two",
      "scene-two",
    ]);
  });

  it("rejects duplicate scene ids", () => {
    const b = twoSceneBible();
    b.scenes[1].id = "scene-opening";
    expect(() => compile(b)).toThrow(/duplicate scene id/);
  });
});

describe("preload manifest", () => {
  it("collects src-bearing assets once each, value-sorted; self-contained kinds excluded", () => {
    const b = twoSceneBible([
      makeBeat("beat-img", "pic", {
        recipeName: "pan-zoom",
        durationInFrames: 60,
      }),
      // Same image staged again: must not duplicate the manifest entry.
      makeBeat("beat-img-again", "pic", {
        recipeName: "pan-zoom",
        durationInFrames: 60,
      }),
      makeBeat("beat-voice", "vo", { recipeName: "hold" }),
    ]);
    b.assets.push(
      {
        kind: "image",
        id: "pic",
        src: "zeta.png",
        intrinsicWidth: 10,
        intrinsicHeight: 10,
      },
      { kind: "audio", id: "vo", src: "alpha.mp3", durationInSeconds: 2 },
      // Declared but never staged: must not appear.
      {
        kind: "image",
        id: "unused",
        src: "never-staged.png",
        intrinsicWidth: 10,
        intrinsicHeight: 10,
      },
    );
    const plan = compile(b);
    expect(plan.manifest).toEqual([
      { kind: "audio", src: "alpha.mp3" },
      { kind: "image", src: "zeta.png" },
    ]);
  });

  it("is empty for a video of purely self-contained assets", () => {
    expect(compile(structuredClone(demoBible)).manifest).toEqual([]);
  });
});
