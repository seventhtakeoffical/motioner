import { clamp01, easeOutCubic } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

const SLIDE_FRAMES = 18;
const SLIDE_DISTANCE = 0.12; // fraction of frame width

/**
 * Enter from the left: the asset travels a short normalized distance into
 * its stage placement while fading in, then holds. Demands nothing of the
 * asset — any visual can be offset and faded.
 */
export const slideIn: Recipe = {
  name: "slide-in",
  requiredCapabilities: [],
  minDurationInFrames: SLIDE_FRAMES,
  sample(ctx) {
    const p = easeOutCubic(clamp01(ctx.frame / SLIDE_FRAMES));
    return {
      ...NEUTRAL_FRAME_PROPS,
      offsetX: -SLIDE_DISTANCE * (1 - p),
      opacity: clamp01(ctx.frame / (SLIDE_FRAMES * 0.66)),
    };
  },
};
