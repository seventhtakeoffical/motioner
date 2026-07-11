import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

/**
 * The deliberately trivial placeholder recipe called for by M3: fade the
 * bound asset in over the first FADE_IN_FRAMES of the beat, then hold it
 * steady. It exists so the Recipe contract has one concrete instance to be
 * exercised against before the real recipe library arrives in M9.
 */

const FADE_IN_FRAMES = 15;

export const staticFade: Recipe = {
  name: "static-fade",

  // A fade only manipulates opacity, which every visual asset supports
  // implicitly — so this recipe demands nothing of its asset. It doubles
  // as the proof that an empty capability requirement is a valid binding.
  requiredCapabilities: [],

  // The beat must at least be long enough for the fade-in to complete;
  // otherwise the asset never reaches full visibility.
  minDurationInFrames: FADE_IN_FRAMES,

  sample(ctx) {
    const opacity =
      ctx.frame >= FADE_IN_FRAMES ? 1 : ctx.frame / FADE_IN_FRAMES;
    return { ...NEUTRAL_FRAME_PROPS, opacity };
  },
};
