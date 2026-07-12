import { clamp01, easeOutCubic } from "./easing";
import { NEUTRAL_FRAME_PROPS, type Recipe } from "./recipe";

const SLIDE_FRAMES = 18;
const SLIDE_DISTANCE = 0.12; // fraction of frame width/height

/** Unit vector for each slide direction: where the asset comes FROM. */
export const SLIDE_VECTORS: Record<string, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/**
 * Enter from a direction: the asset travels a short normalized distance
 * into its stage placement while fading in, then holds. Demands nothing of
 * the asset — any visual can be offset and faded.
 *
 * `direction` was the first recipe parameter ever added (M15): the
 * deleted-photos script's "a new file drops on top" needed a slide from
 * above, and the hardcoded from-the-left could not say it.
 */
export const slideIn: Recipe = {
  name: "slide-in",
  requiredCapabilities: [],
  minDurationInFrames: SLIDE_FRAMES,
  params: {
    direction: {
      kind: "enum",
      values: Object.keys(SLIDE_VECTORS),
      default: "left",
      description: "which edge the asset slides in from",
    },
  },
  sample(ctx) {
    const direction = String(ctx.params?.direction ?? "left");
    const vector = SLIDE_VECTORS[direction] ?? SLIDE_VECTORS.left;
    const p = easeOutCubic(clamp01(ctx.frame / SLIDE_FRAMES));
    const remaining = SLIDE_DISTANCE * (1 - p);
    return {
      ...NEUTRAL_FRAME_PROPS,
      offsetX: vector.x * remaining,
      offsetY: vector.y * remaining,
      opacity: clamp01(ctx.frame / (SLIDE_FRAMES * 0.66)),
    };
  },
};
