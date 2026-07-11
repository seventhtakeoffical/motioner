import { clamp01 } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

export const EXIT_FADE_RECIPE_NAME = "exit-fade";
export const EXIT_FADE_FRAMES = 12;

/**
 * The exit transition (M10): applied by the compiler to every asset struck
 * from the stage by a beat's `exit` directive. Fades out over the first
 * EXIT_FADE_FRAMES of the beat, then stays invisible for the remainder of
 * the window — the layer occupies the whole beat (windows are the plan's
 * unit of time) but contributes no pixels after the fade completes.
 */
export const exitFade: Recipe = {
  name: EXIT_FADE_RECIPE_NAME,
  requiredCapabilities: [],
  minDurationInFrames: EXIT_FADE_FRAMES,
  sample(ctx) {
    return {
      ...NEUTRAL_FRAME_PROPS,
      opacity: 1 - clamp01(ctx.frame / EXIT_FADE_FRAMES),
    };
  },
};
