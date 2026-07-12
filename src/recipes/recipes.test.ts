import { describe, expect, it } from "vitest";
import type { TextAsset } from "../assets";
import { drawOn } from "./draw-on";
import { exitFade } from "./exit-fade";
import { exitSlide } from "./exit-slide";
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

const ALL_RECIPES: Recipe[] = [...ENTRANCE_RECIPES, hold, exitFade, exitSlide];

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

describe("recipe parameters (M15)", () => {
  it("slide-in honors direction and defaults to left", () => {
    const base = ctx(0);
    // Default (no params) and explicit left agree: comes from the left.
    expect(slideIn.sample(base).offsetX).toBeCloseTo(-0.12);
    expect(slideIn.sample(base).offsetY).toBe(0);
    const top = slideIn.sample({ ...base, params: { direction: "top" } });
    expect(top.offsetX).toBe(0);
    expect(top.offsetY).toBeCloseTo(-0.12);
    const bottom = slideIn.sample({ ...base, params: { direction: "bottom" } });
    expect(bottom.offsetY).toBeCloseTo(0.12);
    // Every direction lands exactly on the placement.
    for (const direction of ["left", "right", "top", "bottom"]) {
      const end = slideIn.sample({ ...ctx(18), params: { direction } });
      expect(end.offsetX).toBeCloseTo(0);
      expect(end.offsetY).toBeCloseTo(0);
    }
  });

  it("exit-slide moves out toward its direction while fading, then stays gone", () => {
    const start = exitSlide.sample({ ...ctx(0), params: { direction: "top" } });
    expect(start.opacity).toBe(1);
    expect(start.offsetY).toBeCloseTo(0);
    const mid = exitSlide.sample({ ...ctx(6), params: { direction: "top" } });
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(mid.offsetY).toBeLessThan(0); // moving up and out
    const end = exitSlide.sample({ ...ctx(12), params: { direction: "top" } });
    expect(end.opacity).toBe(0);
    expect(exitSlide.sample({ ...ctx(50), params: { direction: "top" } }).opacity).toBe(0);
  });

  it("declared param specs carry defaults inside their own values", () => {
    for (const recipe of [slideIn, exitSlide]) {
      const spec = recipe.params?.direction;
      expect(spec?.kind).toBe("enum");
      if (spec?.kind === "enum") {
        expect(spec.values).toContain(spec.default);
      }
    }
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
      "exit-slide",
    ]) {
      expect(registry.has(name)).toBe(true);
    }
  });
});
