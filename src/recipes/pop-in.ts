import { clamp01, easeOutBack } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

const POP_FRAMES = 12;

/**
 * Scale up from nothing with a small overshoot past full size, settle,
 * hold. Requires "scalable": the pop IS a scale animation, so an asset
 * with a fixed native-size constraint can't perform it.
 */
export const popIn: Recipe = {
  name: "pop-in",
  requiredCapabilities: ["scalable"],
  minDurationInFrames: POP_FRAMES,
  sample(ctx) {
    return {
      ...NEUTRAL_FRAME_PROPS,
      scale: easeOutBack(clamp01(ctx.frame / POP_FRAMES)),
      opacity: clamp01(ctx.frame / (POP_FRAMES / 2)),
    };
  },
};
