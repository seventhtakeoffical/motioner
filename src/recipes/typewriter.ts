import { clamp01 } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

const TYPE_PORTION = 0.6; // typing occupies the first 60% of the beat

/**
 * Types the content out character by character, then holds. The first
 * consumer of the M9 `reveal` channel: this recipe emits only a semantic
 * progress fraction — how the renderer maps 0.5 onto "half the characters"
 * is not its business. Typing speed is therefore proportional: the Bible
 * paces the effect through the beat's duration, keeping pacing an authored
 * fact rather than a recipe constant.
 */
export const typewriter: Recipe = {
  name: "typewriter",
  requiredCapabilities: ["textual", "revealable"],
  minDurationInFrames: 10,
  sample(ctx) {
    return {
      ...NEUTRAL_FRAME_PROPS,
      reveal: clamp01(ctx.frame / (ctx.durationInFrames * TYPE_PORTION)),
    };
  },
};
