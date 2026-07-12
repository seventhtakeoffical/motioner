import { clamp01, easeOutCubic } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";
import { SLIDE_VECTORS } from "./slide-in";

export const EXIT_SLIDE_RECIPE_NAME = "exit-slide";
export const EXIT_SLIDE_FRAMES = 12;
const EXIT_DISTANCE = 0.2; // fraction of frame width/height

/**
 * An exit WITH motion (M15): the asset slides off toward a direction while
 * fading, then stays gone for the remainder of the window. Production
 * evidence: the deleted-photos script's catalog card is "ripped out" — a
 * removal that IS the story's key action deserves more than a dissolve.
 * Selected per beat via the Bible's `exitRecipeName`; the default exit
 * remains exit-fade.
 */
export const exitSlide: Recipe = {
  name: EXIT_SLIDE_RECIPE_NAME,
  requiredCapabilities: [],
  minDurationInFrames: EXIT_SLIDE_FRAMES,
  params: {
    direction: {
      kind: "enum",
      values: Object.keys(SLIDE_VECTORS),
      default: "right",
      description: "which edge the asset slides out toward",
    },
  },
  sample(ctx) {
    const direction = String(ctx.params?.direction ?? "right");
    const vector = SLIDE_VECTORS[direction] ?? SLIDE_VECTORS.right;
    const p = easeOutCubic(clamp01(ctx.frame / EXIT_SLIDE_FRAMES));
    return {
      ...NEUTRAL_FRAME_PROPS,
      offsetX: vector.x * EXIT_DISTANCE * p,
      offsetY: vector.y * EXIT_DISTANCE * p,
      opacity: 1 - clamp01(ctx.frame / EXIT_SLIDE_FRAMES),
    };
  },
};
