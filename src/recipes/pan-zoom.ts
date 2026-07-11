import { easeInOutCubic } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

const ZOOM_AMOUNT = 0.15;
const DRIFT_AMOUNT = 0.02; // fraction of frame width

/**
 * The Ken Burns treatment: a slow scale-up with a slight horizontal drift
 * across the whole beat. This is the recipe the "spatial" capability was
 * renamed for — the *asset* has extent beyond a single view; expressing
 * that as a 2D drift is this recipe's choice, not the asset's property.
 * Progress is proportional to the beat, so the move always completes
 * exactly at the beat's last frame regardless of duration.
 */
export const panZoom: Recipe = {
  name: "pan-zoom",
  requiredCapabilities: ["spatial", "scalable"],
  minDurationInFrames: 30,
  sample(ctx) {
    const t =
      ctx.durationInFrames > 1 ? ctx.frame / (ctx.durationInFrames - 1) : 1;
    const p = easeInOutCubic(t);
    return {
      ...NEUTRAL_FRAME_PROPS,
      scale: 1 + ZOOM_AMOUNT * p,
      offsetX: -DRIFT_AMOUNT * p,
    };
  },
};
