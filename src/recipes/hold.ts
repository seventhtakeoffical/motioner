import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

export const HOLD_RECIPE_NAME = "hold";

/**
 * The continuity recipe (M10): applied by the compiler to every asset that
 * persists on stage through a beat it is not featured in. It does exactly
 * nothing — the asset sits at its stage placement, fully visible — which
 * is the point: "still there, undisturbed" is a choreographic statement
 * too, and making it an ordinary registry recipe means held layers flow
 * through the same validation and sampling path as everything else.
 */
export const hold: Recipe = {
  name: HOLD_RECIPE_NAME,
  requiredCapabilities: [],
  minDurationInFrames: 1,
  sample() {
    return { ...NEUTRAL_FRAME_PROPS };
  },
};
