import { clamp01, easeInOutCubic } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

const DRAW_PORTION = 0.75; // drawing occupies the first 75% of the beat
const FADE_IN_FRAMES = 8;

/**
 * Progressively draws the asset's content on — bars growing up on a chart,
 * text being written — then holds. Binds against "revealable" alone: what
 * gets drawn is the renderer's per-kind interpretation of the same reveal
 * fraction. A quick opacity ramp keeps the first mark from popping in.
 */
export const drawOn: Recipe = {
  name: "draw-on",
  requiredCapabilities: ["revealable"],
  minDurationInFrames: 20,
  sample(ctx) {
    return {
      ...NEUTRAL_FRAME_PROPS,
      reveal: easeInOutCubic(
        clamp01(ctx.frame / (ctx.durationInFrames * DRAW_PORTION)),
      ),
      opacity: clamp01(ctx.frame / FADE_IN_FRAMES),
    };
  },
};
