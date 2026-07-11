import type { Asset } from "../assets";
import type { StagePlacement, StageTheme } from "../stage";

/**
 * The Render Plan is the typed IR the compiler emits and the renderer
 * consumes — the deterministic boundary between "deciding what happens"
 * and "painting it". Two properties define it:
 *
 * 1. It is FULLY RESOLVED. Assets are embedded whole, placements and
 *    themes are snapshotted values, every timing is an absolute frame
 *    number. The renderer performs no lookups, no defaulting, and no
 *    decisions — it only interprets.
 *
 * 2. It is PURE JSON by construction: no functions, no Dates, no Maps,
 *    no undefined. That is what makes M6's determinism guarantee testable
 *    as literal byte equality of JSON.stringify output. The one exception
 *    to full resolution — recipes are referenced by `recipeName`, not
 *    embedded — exists precisely because recipes are functions, and
 *    functions aren't data. Compiler and renderer agree on what a name
 *    means by sharing the same recipe registry (src/recipes/library.ts).
 */

export interface RenderPlanItem {
  /**
   * Deterministic identity, `${sceneId}/${beatId}`. The compiler rejects
   * Bibles that would produce duplicates, so renderers may use this as a
   * stable React key.
   */
  id: string;

  /** Absolute frame (0-based, in the whole video) at which this item begins. */
  startFrame: number;

  durationInFrames: number;

  /** Looked up in the shared recipe registry at render time. */
  recipeName: string;

  /** The bound asset, embedded whole — see module comment. */
  asset: Asset;

  /**
   * Snapshot of the Stage's placement for this asset during this beat.
   * A recipe's per-frame output composes onto this: offsets add to x/y,
   * recipe scale multiplies placement scale.
   */
  placement: StagePlacement;

  /** Snapshot of the active theme during this beat. */
  theme: StageTheme;
}

export interface RenderPlan {
  fps: number;
  width: number;
  height: number;

  /** Sum of all beat durations; the video's total length. */
  totalDurationInFrames: number;

  /**
   * In timeline order (startFrame strictly increasing). The compiler emits
   * exactly one item per beat.
   */
  items: readonly RenderPlanItem[];
}
