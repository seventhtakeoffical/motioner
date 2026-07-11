import { describe, expect, it } from "vitest";
import { demoBible } from "../bible/demo";
import type { Bible } from "../bible/schema";
import { createDefaultRecipeRegistry } from "../recipes";
import { DEFAULT_STAGE_THEME } from "../stage";
import { compileBible } from "./compile";

/**
 * M6: the determinism guarantee, made executable. The core promise of the
 * whole architecture is that an approved Bible compiles to exactly one
 * possible Render Plan — so these tests assert byte-identical JSON across
 * repeated runs, not just deep equality. Binding-validation tests follow:
 * they pin down the compiler's other job, refusing Bibles whose bindings
 * don't hold.
 */

const RUNS = 25;

// Every test builds its Bible fresh via structuredClone so tests cannot
// contaminate each other through shared references.
function bible(mutate?: (b: Bible) => void): Bible {
  const b = structuredClone(demoBible);
  mutate?.(b);
  return b;
}

function compile(b: Bible) {
  return compileBible(b, createDefaultRecipeRegistry());
}

describe("determinism (M6)", () => {
  it(`produces byte-identical output across ${RUNS} runs on the same Bible`, () => {
    const input = bible();
    const first = JSON.stringify(compile(input));
    for (let i = 1; i < RUNS; i++) {
      expect(JSON.stringify(compile(input))).toBe(first);
    }
  });

  it("produces byte-identical output for distinct but equal Bible objects", () => {
    // Guards against output depending on object identity (caching,
    // WeakMaps, reference equality) rather than value.
    expect(JSON.stringify(compile(bible()))).toBe(
      JSON.stringify(compile(bible())),
    );
  });

  it("never mutates its input Bible", () => {
    const input = bible();
    const snapshot = structuredClone(input);
    compile(input);
    expect(input).toEqual(snapshot);
  });

  it("emits pure JSON: the plan survives a stringify/parse round-trip intact", () => {
    // If the plan ever grows a Date, Map, undefined, or function, the
    // round-trip diverges and byte-comparison stops being meaningful.
    const plan = compile(bible());
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe("value isolation (staff-review issue #1)", () => {
  it("shares no references with the input Bible, stage defaults, or other plans", () => {
    const input = bible();
    const plan = compile(input);
    const beat = plan.beats[0];
    const layer = beat.layers[0];

    // Direct proof of no aliasing: these were the actual leaks — the asset
    // was the Bible's own object, the theme was the module constant.
    expect(layer.asset).not.toBe(input.assets[0]);
    expect(beat.theme).not.toBe(DEFAULT_STAGE_THEME);
    expect(layer.placement).not.toBe(input.scenes[0].beats[0].placement);

    // Two compilations share nothing with each other either.
    const other = compile(input);
    expect(other.beats[0].layers[0].asset).not.toBe(layer.asset);
    expect(other.beats[0].theme).not.toBe(beat.theme);
  });

  it("is deeply frozen: every object in the plan rejects mutation", () => {
    const plan = compile(bible());
    const beat = plan.beats[0];
    const layer = beat.layers[0];
    for (const obj of [
      plan,
      plan.beats,
      beat,
      beat.camera,
      beat.theme,
      beat.layers,
      layer,
      layer.asset,
      layer.placement,
    ]) {
      expect(Object.isFrozen(obj)).toBe(true);
    }
  });

  it("mutation attempts on the plan throw and leave the Bible and shared constants untouched", () => {
    const input = bible();
    const inputSnapshot = structuredClone(input);
    const themeSnapshot = structuredClone(DEFAULT_STAGE_THEME);
    const plan = compile(input);
    const beat = plan.beats[0];

    // Frozen objects throw on write in strict mode (ESM is always strict).
    expect(() => {
      (beat.theme as { backgroundColor: string }).backgroundColor = "#ff0000";
    }).toThrow(TypeError);
    expect(() => {
      (beat.layers[0].asset as { id: string }).id = "hijacked";
    }).toThrow(TypeError);
    expect(() => {
      (plan.beats as unknown[]).push("junk");
    }).toThrow(TypeError);

    // And regardless of the throws, nothing upstream moved.
    expect(input).toEqual(inputSnapshot);
    expect(DEFAULT_STAGE_THEME).toEqual(themeSnapshot);
  });
});

describe("compilation output (M5, reshaped at M10)", () => {
  it("compiles the demo Bible into the expected plan shape", () => {
    const plan = compile(bible());
    expect(plan.fps).toBe(30);
    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(720);
    expect(plan.totalDurationInFrames).toBe(90);
    expect(plan.beats).toHaveLength(1);

    const beat = plan.beats[0];
    expect(beat.id).toBe("scene-opening/beat-hello");
    expect(beat.startFrame).toBe(0);
    expect(beat.durationInFrames).toBe(90);
    // Default carried state: centered camera, default theme.
    expect(beat.camera).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(beat.theme).toEqual({
      backgroundColor: "#111111",
      foregroundColor: "#ffffff",
    });

    expect(beat.layers).toHaveLength(1);
    const layer = beat.layers[0];
    expect(layer.entityId).toBe("headline");
    expect(layer.role).toBe("enter");
    expect(layer.recipeName).toBe("static-fade");
    expect(layer.asset.id).toBe("headline");
    expect(layer.placement).toEqual({
      assetId: "headline",
      x: 0.5,
      y: 0.5,
      scale: 1,
      zIndex: 0,
    });
  });

  it("lays out consecutive beats back-to-back on the frame cursor", () => {
    const plan = compile(
      bible((b) => {
        const beat = b.scenes[0].beats[0];
        b.scenes[0].beats.push({
          ...structuredClone(beat),
          id: "beat-second",
          durationInFrames: 45,
        });
      }),
    );
    expect(plan.beats.map((w) => w.startFrame)).toEqual([0, 90]);
    expect(plan.totalDurationInFrames).toBe(135);
  });
});

describe("binding validation (M5)", () => {
  it("rejects a beat referencing an undeclared asset", () => {
    expect(() =>
      compile(bible((b) => (b.scenes[0].beats[0].assetId = "ghost"))),
    ).toThrow(/asset "ghost".*not declared/);
  });

  it("rejects a beat referencing an unregistered recipe", () => {
    expect(() =>
      compile(bible((b) => (b.scenes[0].beats[0].recipeName = "nonexistent"))),
    ).toThrow(/recipe "nonexistent"/);
  });

  it("rejects a binding whose asset lacks a required capability", () => {
    // A registry with a recipe demanding "textual", bound to an audio asset.
    const registry = createDefaultRecipeRegistry();
    registry.register({
      name: "needs-text",
      requiredCapabilities: ["textual"],
      minDurationInFrames: 1,
      sample: () => ({ opacity: 1, offsetX: 0, offsetY: 0, scale: 1 }),
    });
    const b = bible((b) => {
      b.assets.push({
        kind: "audio",
        id: "voiceover",
        src: "vo.mp3",
        durationInSeconds: 3,
      });
      b.scenes[0].beats[0].assetId = "voiceover";
      b.scenes[0].beats[0].recipeName = "needs-text";
    });
    expect(() => compileBible(b, registry)).toThrow(
      /requires capability "textual"/,
    );
  });

  it("rejects a beat shorter than its recipe's minimum duration", () => {
    expect(() =>
      compile(bible((b) => (b.scenes[0].beats[0].durationInFrames = 10))),
    ).toThrow(/10 frames.*at least 15/);
  });

  it("rejects duplicate scene/beat id pairs", () => {
    expect(() =>
      compile(
        bible((b) => {
          b.scenes[0].beats.push(structuredClone(b.scenes[0].beats[0]));
        }),
      ),
    ).toThrow(/duplicate scene\/beat id/);
  });

  it("rejects duplicate asset declarations", () => {
    expect(() =>
      compile(bible((b) => b.assets.push(structuredClone(b.assets[0])))),
    ).toThrow(/already registered/);
  });

  it("rejects a real library recipe on an incapable asset (typewriter on image)", () => {
    const b = bible((beat) => {
      beat.assets.push({
        kind: "image",
        id: "photo",
        src: "photo.png",
        intrinsicWidth: 100,
        intrinsicHeight: 100,
      });
      beat.scenes[0].beats[0].assetId = "photo";
      beat.scenes[0].beats[0].recipeName = "typewriter";
    });
    expect(() => compile(b)).toThrow(/requires capability "textual"/);
  });
});
