import { describe, expect, it } from "vitest";
import type { TextAsset } from "../assets";
import { drawOn } from "./draw-on";
import { exitFade } from "./exit-fade";
import { hold } from "./hold";
import { createDefaultRecipeRegistry } from "./library";
import { panZoom } from "./pan-zoom";
import { popIn } from "./pop-in";
import type { Recipe, RecipeContext } from "./recipe";
import { slideIn } from "./slide-in";
import { staticFade } from "./static-fade";
import { typewriter } from "./typewriter";

/**
 * M9 golden-sample tests. The determinism suite (M6) covers the compiler;
 * this covers the other half of the deterministic boundary — recipe frame
 * functions, which run at render time. Every recipe must be a pure
 * function of its context, defined and finite over its whole domain.
 */

// Entrances settle at full visibility; the continuity recipes (M10) have
// different end states (hold never moves, exit-fade ends invisible), so
// they share the purity/finiteness suite but not the "settled" invariant.
const ENTRANCE_RECIPES: Recipe[] = [
  staticFade,
  slideIn,
  panZoom,
  typewriter,
  drawOn,
  popIn,
];

const ALL_RECIPES: Recipe[] = [...ENTRANCE_RECIPES, hold, exitFade];

const textAsset: TextAsset = { kind: "text", id: "t", content: "Hello" };

function ctx(frame: number, durationInFrames = 60): RecipeContext {
  return { frame, durationInFrames, asset: textAsset };
}

describe("every recipe", () => {
  for (const recipe of ALL_RECIPES) {
    describe(recipe.name, () => {
      it("samples deterministically (same context, byte-identical output)", () => {
        for (const frame of [0, 1, 7, 30, 59]) {
          expect(JSON.stringify(recipe.sample(ctx(frame)))).toBe(
            JSON.stringify(recipe.sample(ctx(frame))),
          );
        }
      });

      it("stays finite and in-range over its whole domain", () => {
        const duration = Math.max(recipe.minDurationInFrames, 60);
        for (let frame = 0; frame < duration; frame++) {
          const props = recipe.sample(ctx(frame, duration));
          for (const value of Object.values(props)) {
            expect(Number.isFinite(value)).toBe(true);
          }
          expect(props.opacity).toBeGreaterThanOrEqual(0);
          expect(props.opacity).toBeLessThanOrEqual(1);
          if (props.reveal !== undefined) {
            expect(props.reveal).toBeGreaterThanOrEqual(0);
            expect(props.reveal).toBeLessThanOrEqual(1);
          }
        }
      });

    });
  }
});

describe("entrance recipes settle", () => {
  for (const recipe of ENTRANCE_RECIPES) {
    it(`${recipe.name} has settled by the last frame of a generous beat`, () => {
      const duration = Math.max(recipe.minDurationInFrames, 90);
      const end = recipe.sample(ctx(duration - 1, duration));
      expect(end.opacity).toBe(1);
      expect(end.reveal ?? 1).toBe(1);
    });
  }
});

describe("continuity recipes (M10)", () => {
  it("hold is the identity: neutral props at every frame", () => {
    for (const frame of [0, 30, 89]) {
      expect(hold.sample(ctx(frame, 90))).toEqual({
        opacity: 1,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        reveal: 1,
      });
    }
  });

  it("exit-fade starts fully visible and is gone by frame 12, staying gone", () => {
    expect(exitFade.sample(ctx(0)).opacity).toBe(1);
    expect(exitFade.sample(ctx(6)).opacity).toBeCloseTo(0.5);
    expect(exitFade.sample(ctx(12)).opacity).toBe(0);
    expect(exitFade.sample(ctx(50)).opacity).toBe(0);
  });
});

describe("golden values", () => {
  it("static-fade: invisible at frame 0, fully visible after 15", () => {
    expect(staticFade.sample(ctx(0)).opacity).toBe(0);
    expect(staticFade.sample(ctx(15)).opacity).toBe(1);
  });

  it("typewriter: nothing typed at frame 0, everything by 60% of the beat", () => {
    expect(typewriter.sample(ctx(0, 100)).reveal).toBe(0);
    expect(typewriter.sample(ctx(60, 100)).reveal).toBe(1);
    expect(typewriter.sample(ctx(30, 100)).reveal).toBeCloseTo(0.5);
  });

  it("slide-in: starts offset left, lands exactly on placement", () => {
    expect(slideIn.sample(ctx(0)).offsetX).toBeCloseTo(-0.12);
    expect(slideIn.sample(ctx(18)).offsetX).toBe(-0);
  });

  it("pan-zoom: starts at rest, ends at full zoom exactly on the last frame", () => {
    const first = panZoom.sample(ctx(0, 90));
    const last = panZoom.sample(ctx(89, 90));
    expect(first.scale).toBe(1);
    expect(last.scale).toBeCloseTo(1.15);
    expect(last.offsetX).toBeCloseTo(-0.02);
  });

  it("pop-in: overshoots past full size mid-pop, settles at exactly 1", () => {
    const samples = Array.from({ length: 13 }, (_, f) =>
      popIn.sample(ctx(f)),
    );
    expect(Math.max(...samples.map((s) => s.scale))).toBeGreaterThan(1);
    expect(samples[12].scale).toBe(1);
  });

  it("draw-on: reveal is monotonic from 0 to 1", () => {
    let prev = -1;
    for (let f = 0; f < 60; f++) {
      const reveal = drawOn.sample(ctx(f, 60)).reveal ?? 0;
      expect(reveal).toBeGreaterThanOrEqual(prev);
      prev = reveal;
    }
    expect(prev).toBe(1);
  });
});

describe("library registry", () => {
  it("registers every recipe under its frozen name", () => {
    const registry = createDefaultRecipeRegistry();
    for (const name of [
      "static-fade",
      "slide-in",
      "pan-zoom",
      "typewriter",
      "draw-on",
      "pop-in",
      "hold",
      "exit-fade",
    ]) {
      expect(registry.has(name)).toBe(true);
    }
  });
});
